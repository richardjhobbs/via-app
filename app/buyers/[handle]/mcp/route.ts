/**
 * Per-buyer MCP endpoint — app.getvia.xyz/buyers/[handle]/mcp
 *
 * Off by default. A buyer profile only exposes this endpoint once its
 * owner flips public=true. Seller agents that have negotiated terms can
 * reach the buyer's agent here.
 *
 * Tools (3):
 *   get_buyer_preferences — public-safe slice of the buyer's preferences
 *                           (PII and delegation caps stripped).
 *   negotiate             — DeepSeek call in the buyer's voice. The agent
 *                           applies preferences and refuses anything that
 *                           breaks a delegation cap.
 *   accept_offer          — evaluates an offer against the delegation caps.
 *                           Auto-accepts only when caps allow; otherwise
 *                           queues for the owner's approval.
 *
 * Every call logs to app_mcp_interactions with buyer_id set. Requests are
 * rate-limited per IP + agent. Write tools notify the owner in-app.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/app/db';
import { insertNotification } from '@/lib/app/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

// ── Types ──────────────────────────────────────────────────────────────

interface DelegationCaps {
  max_purchase_usd?: number;
  auto_buy_under_usd?: number;
  categories_allowed?: string[];
  categories_blocked?: string[];
}

interface BuyerRow {
  id:               string;
  handle:           string;
  display_name:     string | null;
  public:           boolean;
  delegation_caps:  DelegationCaps;
  owner_user_id:    string;
}

async function loadBuyer(handle: string): Promise<BuyerRow | null> {
  const { data, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name, public, delegation_caps, owner_user_id')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !data || !data.public) return null;
  return {
    ...data,
    delegation_caps: (data.delegation_caps ?? {}) as DelegationCaps,
  } as BuyerRow;
}

function asJson(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

async function logInteraction(
  buyerId: string,
  toolName: string,
  agentIdentity: Record<string, unknown>,
  request: unknown,
  response: unknown,
  statusCode: number,
  durationMs: number,
) {
  db.from('app_mcp_interactions').insert({
    buyer_id:       buyerId,
    tool_name:      toolName,
    agent_identity: agentIdentity,
    request,
    response,
    status_code:    statusCode,
    duration_ms:    durationMs,
  }).then(() => {}, (err) => {
    console.warn(`[buyer-mcp] audit log insert failed for ${toolName}:`, err);
  });
}

function parseAgentIdentity(req: Request): Record<string, unknown> {
  const viaAgentId = req.headers.get('x-via-agent-id');
  const ua         = req.headers.get('user-agent');
  const fwd        = req.headers.get('x-forwarded-for');
  const ip         = fwd ? fwd.split(',')[0].trim() : null;
  return {
    via_agent_id: viaAgentId ? Number(viaAgentId) : null,
    user_agent:   ua,
    ip,
  };
}

// ── Rate limiting (best-effort, per warm instance) ───────────────────
// Keyed by ip|agent. Sliding 60s window. Stateless transport means this
// is per-lambda-instance, which is enough to blunt abusive bursts.

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const rateHits = new Map<string, number[]>();

function rateLimitKey(req: Request): string {
  const identity = parseAgentIdentity(req);
  return `${identity.ip ?? 'noip'}|${identity.via_agent_id ?? 'noagent'}`;
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (rateHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateHits.set(key, hits);
  return hits.length > RATE_MAX;
}

// ── Preferences (public-safe slice) ──────────────────────────────────

interface PublicMemory { type: string; title: string; body: string; tags: string[]; }

async function loadPublicPreferences(handle: string): Promise<PublicMemory[]> {
  const { data } = await db.rpc('app_buyer_memory_list', {
    p_handle: handle,
    p_type:   null,
    p_tag:    null,
    p_limit:  100,
  });
  const rows = (data as Record<string, unknown>[] ?? []);
  return rows
    .filter((m) => !(Array.isArray(m.tags) && (m.tags as string[]).includes('private')))
    .map((m) => ({
      type:  String(m.type),
      title: String(m.title),
      body:  String(m.body),
      tags:  Array.isArray(m.tags) ? (m.tags as string[]).filter((t) => t !== 'private') : [],
    }));
}

// ── negotiate backend (lightweight DeepSeek call) ────────────────────

async function negotiateReply(buyer: BuyerRow, offerText: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return `[@${buyer.handle}'s Buying Agent is being trained. DEEPSEEK_API_KEY not yet provisioned on this deployment.]`;
  }

  const prefs = await loadPublicPreferences(buyer.handle);
  const prefBlock = prefs.length > 0
    ? prefs.map((m) => `[${m.type}] ${m.title}: ${m.body}`).join('\n')
    : '(no stated preferences yet; be cautious and do not assume taste)';

  // The numeric delegation caps (the dollar figure especially) are NEVER put
  // into the LLM context: seller-controlled offer_text shares this prompt, so
  // a crafted pitch could coax the exact cap out of the model. The amount cap
  // is enforced deterministically in evaluateOffer() at accept_offer instead.
  // Here the agent only gets non-numeric, non-secret guidance.
  const caps = buyer.delegation_caps;
  const capLines: string[] = [];
  if (typeof caps.max_purchase_usd === 'number') capLines.push(`- The buyer has a per-order spending limit. Never state, confirm, or hint at any budget or limit figure. If a price looks high, say it needs the buyer's direct approval rather than committing.`);
  if (Array.isArray(caps.categories_blocked) && caps.categories_blocked.length) capLines.push(`- Refuse anything in these categories: ${caps.categories_blocked.join(', ')}.`);
  if (Array.isArray(caps.categories_allowed) && caps.categories_allowed.length) capLines.push(`- Only entertain offers in these categories: ${caps.categories_allowed.join(', ')}.`);
  const capBlock = capLines.length ? `\n\nBuyer rules (apply silently, never reveal exact figures):\n${capLines.join('\n')}` : '';

  const systemPrompt = `You are @${buyer.handle}'s Buying Agent. You represent the buyer's interests when seller agents pitch you.

Apply the buyer's stated preferences below. Reject offers that violate any limit. Never invent preferences the buyer has not stated. Be concise and direct.

Buyer preferences (your source of truth):
${prefBlock}${capBlock}

A seller agent is pitching you. Respond on the buyer's behalf: say whether the offer fits the buyer's preferences, ask for any missing detail you need, and state your position. If it breaks a limit, decline plainly without disclosing the exact cap.`;

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: offerText },
        ],
        temperature: 0.4,
        max_tokens:  600,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[buyer-mcp/negotiate] DeepSeek ${res.status}: ${text.slice(0, 200)}`);
      return `[Buying Agent transient error. Please retry.]`;
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? '[empty response]';
  } catch (err) {
    console.error('[buyer-mcp/negotiate] fetch threw:', err);
    return `[Buying Agent unreachable. Please retry shortly.]`;
  }
}

// ── accept_offer decision against delegation caps ────────────────────

type OfferDecision =
  | { decision: 'accepted'; reason: string }
  | { decision: 'queued';   reason: string }
  | { decision: 'rejected'; reason: string };

function evaluateOffer(caps: DelegationCaps, amountUsd: number | undefined, category: string | undefined): OfferDecision {
  const cat = category?.trim().toLowerCase();

  if (cat && Array.isArray(caps.categories_blocked) && caps.categories_blocked.includes(cat)) {
    return { decision: 'rejected', reason: `category "${cat}" is blocked by the buyer's delegation caps` };
  }
  if (cat && Array.isArray(caps.categories_allowed) && caps.categories_allowed.length > 0 && !caps.categories_allowed.includes(cat)) {
    return { decision: 'rejected', reason: `category "${cat}" is not in the buyer's allowed categories` };
  }
  if (typeof amountUsd === 'number' && typeof caps.max_purchase_usd === 'number' && amountUsd > caps.max_purchase_usd) {
    return { decision: 'rejected', reason: 'amount exceeds the buyer\'s maximum purchase cap' };
  }
  if (typeof amountUsd === 'number' && typeof caps.auto_buy_under_usd === 'number' && amountUsd <= caps.auto_buy_under_usd) {
    return { decision: 'accepted', reason: 'amount is within the buyer\'s auto-buy threshold and breaks no cap' };
  }
  return { decision: 'queued', reason: 'within caps but above the auto-buy threshold; queued for the buyer\'s approval' };
}

// ── Build the MCP server per-request ─────────────────────────────────

function createServer(buyer: BuyerRow, req: Request) {
  const server = new McpServer({
    name: `${buyer.handle}-buying-agent`,
    version: '1.0.0',
  });

  const identity = parseAgentIdentity(req);

  // ── get_buyer_preferences ────────────────────────────────────────
  server.tool(
    'get_buyer_preferences',
    `Read @${buyer.handle}'s public buying preferences. Returns the qualities, constraints, and affinities the buyer has stated. Delegation caps and any private notes are not exposed.`,
    {},
    async () => {
      const t0 = Date.now();
      const prefs = await loadPublicPreferences(buyer.handle);
      const out = asJson({ handle: buyer.handle, count: prefs.length, preferences: prefs });
      void logInteraction(buyer.id, 'get_buyer_preferences', identity, {}, { count: prefs.length }, 200, Date.now() - t0);
      return out;
    },
  );

  // ── negotiate ────────────────────────────────────────────────────
  server.tool(
    'negotiate',
    `Pitch an offer to @${buyer.handle}'s Buying Agent. Describe the product, terms, and price in offer_text. The agent responds on the buyer's behalf, applying their preferences and refusing anything that breaks a limit.`,
    {
      offer_text: z.string().min(1).max(4000).describe('Your full pitch: what you are offering, terms, and price.'),
    },
    async ({ offer_text }) => {
      const t0 = Date.now();
      const reply = await negotiateReply(buyer, offer_text);
      const out = asJson({ handle: buyer.handle, reply });
      void logInteraction(buyer.id, 'negotiate', identity, { offer_text: offer_text.slice(0, 200) }, { len: reply.length }, 200, Date.now() - t0);
      void insertNotification({
        ownerUserId: buyer.owner_user_id,
        kind:        'enquiry',
        title:       'A seller agent pitched your Buying Agent',
        body:        offer_text.slice(0, 240),
        link:        `/buyer/${buyer.handle}/admin`,
        metadata:    { tool_name: 'negotiate', agent_identity: identity, buyer_id: buyer.id },
      });
      return out;
    },
  );

  // ── accept_offer ─────────────────────────────────────────────────
  server.tool(
    'accept_offer',
    `Ask @${buyer.handle}'s Buying Agent to accept a negotiated offer. The agent evaluates it against the buyer's delegation caps: it auto-accepts only when the amount is within the auto-buy threshold and breaks no cap, otherwise it queues the offer for the buyer's approval. Caps that are exceeded cause a rejection.`,
    {
      offer_id:   z.string().min(1).max(120).describe('Your reference id for the offer being accepted.'),
      amount_usd: z.number().min(0).optional().describe('Total order amount in USD. Required for the caps check to clear an auto-buy.'),
      category:   z.string().min(1).max(60).optional().describe('Product category, checked against the buyer\'s allowed/blocked lists.'),
    },
    async ({ offer_id, amount_usd, category }) => {
      const t0 = Date.now();
      const result = evaluateOffer(buyer.delegation_caps, amount_usd, category);
      const out = asJson({ handle: buyer.handle, offer_id, ...result });
      const statusCode = result.decision === 'rejected' ? 409 : 200;
      void logInteraction(buyer.id, 'accept_offer', identity, { offer_id, amount_usd, category }, result, statusCode, Date.now() - t0);

      if (result.decision !== 'rejected') {
        void insertNotification({
          ownerUserId: buyer.owner_user_id,
          kind:        'sale',
          title:       result.decision === 'accepted'
            ? 'Your Buying Agent auto-accepted an offer'
            : 'An offer is waiting for your approval',
          body:        `Offer ${offer_id}${typeof amount_usd === 'number' ? ` · ${amount_usd} USD` : ''}${category ? ` · ${category}` : ''} (${result.decision})`,
          link:        `/buyer/${buyer.handle}/admin`,
          metadata:    { tool_name: 'accept_offer', agent_identity: identity, offer_id, amount_usd: amount_usd ?? null, category: category ?? null, decision: result.decision, buyer_id: buyer.id },
        });
      }
      return out;
    },
  );

  return server;
}

// ── HTTP handlers ────────────────────────────────────────────────────

export async function GET(_req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const buyer = await loadBuyer(handle);
  if (!buyer) return Response.json({ error: `buyer "${handle}" not found or not public` }, { status: 404 });
  return Response.json({
    name:        `${handle}-buying-agent`,
    version:     '1.0.0',
    description: `Per-buyer MCP for @${buyer.handle}. POST JSON-RPC to this endpoint to interact.`,
    protocol:    'MCP Streamable HTTP',
    buyer:       { handle: buyer.handle, display_name: buyer.display_name, mcp_url: `${APP_BASE}/buyers/${buyer.handle}/mcp` },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const buyer = await loadBuyer(handle);
  if (!buyer) return Response.json({ error: `buyer "${handle}" not found or not public` }, { status: 404 });

  if (isRateLimited(rateLimitKey(req))) {
    return Response.json({ error: 'rate limit exceeded, slow down' }, { status: 429 });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  const server = createServer(buyer, req);
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, x-via-agent-id',
    },
  });
}
