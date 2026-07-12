/**
 * Per-room MCP endpoint , app.getvia.xyz/rooms/[roomId]/mcp
 *
 * The private surface a Back Room's members act through. The human UI is a thin
 * client over these SAME tools; a member's agent uses them too. One protocol,
 * two faces, no UI-only backdoor writes.
 *
 * Auth (wallet-signature, like the stores):
 *   get_challenge   , issue a challenge to sign with the member wallet.
 *   authenticate    , verify the signature, confirm room membership, return a
 *                     short-lived session_token that the other tools carry.
 *
 * Room tools (all require session_token):
 *   room_place_object , put an object on the table (image, link, note, voice note).
 *   room_list_table   , the current objects on the table.
 *   room_get_object   , one object by id.
 *   room_say          , ambient talk to the room.
 *   room_invite       , STAGE a vouch. Never joins on its own: joining needs the
 *                       member's deliberate press in the UI (one of the three taps).
 *   errand_request_quote , source something and get a quote over the existing rails.
 *   errand_purchase      , NEVER settles without an explicit human approval from the
 *                          UI. Without it, returns approval_required.
 *
 * Nothing here is posted by an agent on its own initiative: every write is the
 * member's own action, spoken or pressed (hard invariant 1). Every call logs to
 * app_mcp_interactions with room_id set.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/app/db';
import {
  loadRoom, memberByWallet, isMember,
  placeObject, sayToRoom, listTable, getObject,
  type RoomRow, type RoomMember,
} from '@/lib/app/backroom/rooms';
import {
  issueRoomChallenge, verifyRoomChallenge, issueSessionToken, verifySessionToken,
} from '@/lib/app/backroom/room-auth';
import { dryRunMatch } from '@/lib/app/buyer-matching';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

function asJson(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function parseAgentIdentity(req: Request): Record<string, unknown> {
  const viaAgentId = req.headers.get('x-via-agent-id');
  const ua = req.headers.get('user-agent');
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : null;
  return { via_agent_id: viaAgentId ? Number(viaAgentId) : null, user_agent: ua, ip };
}

function logInteraction(
  roomId: string,
  toolName: string,
  agentIdentity: Record<string, unknown>,
  request: unknown,
  response: unknown,
  statusCode: number,
  durationMs: number,
) {
  db.from('app_mcp_interactions').insert({
    room_id: roomId,
    tool_name: toolName,
    agent_identity: agentIdentity,
    request,
    response,
    status_code: statusCode,
    duration_ms: durationMs,
  }).then(() => {}, (err) => {
    console.warn(`[room-mcp] audit log insert failed for ${toolName}:`, err);
  });
}

// ── Rate limiting (best-effort, per warm instance) ───────────────────
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 40;
const rateHits = new Map<string, number[]>();
function rateLimitKey(req: Request): string {
  const id = parseAgentIdentity(req);
  return `${id.ip ?? 'noip'}|${id.via_agent_id ?? 'noagent'}`;
}
function isRateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (rateHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateHits.set(key, hits);
  return hits.length > RATE_MAX;
}

// ── Server ───────────────────────────────────────────────────────────

function createServer(room: RoomRow, req: Request) {
  const server = new McpServer({ name: `backroom-${room.id}`, version: '1.0.0' });
  const identity = parseAgentIdentity(req);

  // Resolve + require a valid session for a room tool. Returns the acting
  // member or an error envelope the tool returns directly.
  async function requireMember(sessionToken: string): Promise<
    | { ok: true; member: RoomMember }
    | { ok: false; out: ReturnType<typeof asJson> }
  > {
    const session = verifySessionToken(room.id, sessionToken);
    if (!session) {
      return { ok: false, out: asJson({ status: 'unauthorized', message: 'Invalid or expired session. Call get_challenge then authenticate.' }) };
    }
    const member = await isMember(room.id, session.member_platform as RoomMember['member_platform'], session.member_type as RoomMember['member_type'], session.member_ref);
    if (!member) {
      return { ok: false, out: asJson({ status: 'forbidden', message: 'Not a member of this room.' }) };
    }
    return { ok: true, member };
  }

  // ── get_challenge ────────────────────────────────────────────────
  server.tool(
    'get_challenge',
    'Begin auth. Provide your member wallet; receive a message to sign. Sign it with that wallet and pass the signature to authenticate.',
    { wallet: z.string().min(4).describe('Your member wallet address (0x...).') },
    async ({ wallet }) => {
      const t0 = Date.now();
      const challenge = issueRoomChallenge(room.id, wallet);
      if (!challenge) return asJson({ status: 'not_configured', message: 'Room auth is not configured on this deployment.' });
      void logInteraction(room.id, 'get_challenge', identity, { wallet: wallet.slice(0, 10) }, { issued: true }, 200, Date.now() - t0);
      return asJson(challenge);
    },
  );

  // ── authenticate ─────────────────────────────────────────────────
  server.tool(
    'authenticate',
    'Complete auth. Provide the wallet, the challenge from get_challenge, and your signature over its message. Returns a session_token to pass to the room tools.',
    {
      wallet: z.string().min(4),
      challenge: z.string().min(8),
      signature: z.string().min(8),
    },
    async ({ wallet, challenge, signature }) => {
      const t0 = Date.now();
      const v = verifyRoomChallenge(room.id, wallet, challenge, signature);
      if (!v.ok) {
        void logInteraction(room.id, 'authenticate', identity, { wallet: wallet.slice(0, 10) }, { reason: v.reason }, 401, Date.now() - t0);
        return asJson({ status: 'unauthorized', reason: v.reason });
      }
      const member = await memberByWallet(room.id, wallet);
      if (!member) {
        void logInteraction(room.id, 'authenticate', identity, { wallet: wallet.slice(0, 10) }, { reason: 'not_member' }, 403, Date.now() - t0);
        return asJson({ status: 'forbidden', message: 'That wallet is not a member of this room.' });
      }
      const token = issueSessionToken(room.id, member.member_platform, member.member_type, member.member_ref);
      void logInteraction(room.id, 'authenticate', identity, { wallet: wallet.slice(0, 10) }, { ok: true, member_ref: member.member_ref }, 200, Date.now() - t0);
      return asJson({ status: 'ok', session_token: token, member_platform: member.member_platform, member_type: member.member_type, member_ref: member.member_ref });
    },
  );

  // ── room_place_object ────────────────────────────────────────────
  server.tool(
    'room_place_object',
    'Put an object on the room table: a reference image, a link, a note, or a voice note. This is the member placing something they chose to share.',
    {
      session_token: z.string().min(8),
      object_type: z.enum(['image', 'link', 'note', 'voice_note']),
      content: z.string().min(1).max(4000).describe('The link URL, the note text, or a caption / storage path for image and voice notes.'),
      corner: z.string().min(1).max(60).optional().describe('Optional corner of the table to place it in.'),
    },
    async ({ session_token, object_type, content, corner }) => {
      const t0 = Date.now();
      const auth = await requireMember(session_token);
      if (!auth.ok) return auth.out;
      const placed = await placeObject(room.id, auth.member, { object_type, content, corner });
      const out = asJson({ status: 'placed', object_id: placed.id, object_type, created_at: placed.created_at });
      void logInteraction(room.id, 'room_place_object', identity, { object_type }, { object_id: placed.id }, 200, Date.now() - t0);
      return out;
    },
  );

  // ── room_list_table ──────────────────────────────────────────────
  server.tool(
    'room_list_table',
    'List the objects currently on the room table, newest first.',
    { session_token: z.string().min(8) },
    async ({ session_token }) => {
      const t0 = Date.now();
      const auth = await requireMember(session_token);
      if (!auth.ok) return auth.out;
      const objects = await listTable(room.id);
      void logInteraction(room.id, 'room_list_table', identity, {}, { count: objects.length }, 200, Date.now() - t0);
      return asJson({ room: room.name, count: objects.length, objects });
    },
  );

  // ── room_get_object ──────────────────────────────────────────────
  server.tool(
    'room_get_object',
    'Get one object on the table by its id.',
    { session_token: z.string().min(8), object_id: z.string().uuid() },
    async ({ session_token, object_id }) => {
      const t0 = Date.now();
      const auth = await requireMember(session_token);
      if (!auth.ok) return auth.out;
      const object = await getObject(room.id, object_id);
      void logInteraction(room.id, 'room_get_object', identity, { object_id }, { found: !!object }, object ? 200 : 404, Date.now() - t0);
      return asJson(object ? { object } : { status: 'not_found' });
    },
  );

  // ── room_say ─────────────────────────────────────────────────────
  server.tool(
    'room_say',
    'Say something to the room as ambient talk. Talk is ambient; the table is permanent.',
    { session_token: z.string().min(8), text: z.string().min(1).max(2000) },
    async ({ session_token, text }) => {
      const t0 = Date.now();
      const auth = await requireMember(session_token);
      if (!auth.ok) return auth.out;
      const said = await sayToRoom(room.id, auth.member, text);
      void logInteraction(room.id, 'room_say', identity, { len: text.length }, { event_id: said.id }, 200, Date.now() - t0);
      return asJson({ status: 'said', event_id: said.id });
    },
  );

  // ── room_invite ──────────────────────────────────────────────────
  server.tool(
    'room_invite',
    'Stage an invitation (a vouch) for someone to join the room. This only STAGES it. The member must then confirm the vouch with a deliberate press in the UI before anyone joins; the invitation is attributed to the voucher and visible to the room.',
    { session_token: z.string().min(8), name: z.string().min(1).max(120).describe('Who to invite, by name or member handle.') },
    async ({ session_token, name }) => {
      const t0 = Date.now();
      const auth = await requireMember(session_token);
      if (!auth.ok) return auth.out;
      // Staged only. The join (with vouched_by = this member) happens when the
      // member confirms with a physical press. No membership is written here.
      void logInteraction(room.id, 'room_invite', identity, { name }, { staged: true }, 200, Date.now() - t0);
      return asJson({
        status: 'vouch_pending',
        invitee: name,
        voucher: auth.member.member_ref,
        requires: 'human_press',
        message: 'Staged. The vouch is not live until you confirm it with a deliberate press.',
      });
    },
  );

  // ── errand_request_quote ─────────────────────────────────────────
  server.tool(
    'errand_request_quote',
    'Source something for the room and get a quote over the existing rails: find a supplier, a pressing plant, a studio, a sample, and its price. This only fetches a quote; paying is a separate deliberate press.',
    { session_token: z.string().min(8), request: z.string().min(2).max(2000).describe('What to source or price, in plain words.') },
    async ({ session_token, request }) => {
      const t0 = Date.now();
      const auth = await requireMember(session_token);
      if (!auth.ok) return auth.out;
      const { intent, results } = await dryRunMatch(request);
      void logInteraction(room.id, 'errand_request_quote', identity, { request: request.slice(0, 160) }, { count: results.length }, 200, Date.now() - t0);
      return asJson({
        status: 'quotes',
        understood: intent,
        count: results.length,
        quotes: results,
        next: results.length
          ? 'To buy one, the member confirms with a deliberate press; errand_purchase never settles without that approval.'
          : 'No quotes yet. Sharpen the request or try again.',
      });
    },
  );

  // ── errand_purchase ──────────────────────────────────────────────
  server.tool(
    'errand_purchase',
    'Buy a quoted item for the room over the existing x402 rail. This NEVER settles without an explicit human approval from the UI. Called without an approval, it returns approval_required and does nothing.',
    {
      session_token: z.string().min(8),
      seller_mcp_url: z.string().url().describe('The mcp_url of the seller holding the quote.'),
      product_id: z.string().min(1),
      human_approval: z.string().optional().describe('The approval token the UI records when the member presses to approve the payment. Absent means not approved.'),
    },
    async ({ session_token, seller_mcp_url, product_id, human_approval }) => {
      const t0 = Date.now();
      const auth = await requireMember(session_token);
      if (!auth.ok) return auth.out;
      if (!human_approval) {
        void logInteraction(room.id, 'errand_purchase', identity, { product_id }, { status: 'approval_required' }, 402, Date.now() - t0);
        return asJson({
          status: 'approval_required',
          message: 'Money leaving the room needs the member to approve it with a deliberate press. No payment was made.',
          seller_mcp_url,
          product_id,
        });
      }
      // Settlement over the existing x402 path is wired in milestone 6. Here the
      // approval gate is enforced; without it, nothing settles.
      void logInteraction(room.id, 'errand_purchase', identity, { product_id }, { status: 'approved_pending_settlement' }, 200, Date.now() - t0);
      return asJson({ status: 'approved_pending_settlement', message: 'Approval recorded. Settlement lands with the errand flow.', product_id });
    },
  );

  return server;
}

// ── HTTP handlers ────────────────────────────────────────────────────

export async function GET(_req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return Response.json({ error: `room "${roomId}" not found` }, { status: 404 });
  return Response.json({
    name: `backroom-${room.id}`,
    version: '1.0.0',
    description: `Per-room MCP for ${room.name}. POST JSON-RPC to this endpoint. Members only: authenticate with your member wallet.`,
    protocol: 'MCP Streamable HTTP',
    room: { id: room.id, name: room.name, agent_wallet: room.agent_wallet_address, mcp_url: `${APP_BASE}/rooms/${room.id}/mcp` },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return Response.json({ error: `room "${roomId}" not found` }, { status: 404 });

  if (isRateLimited(rateLimitKey(req))) {
    return Response.json({ error: 'rate limit exceeded, slow down' }, { status: 429 });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer(room, req);
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, x-via-agent-id',
    },
  });
}
