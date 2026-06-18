/**
 * Authenticated VIA content MCP, app.getvia.xyz/mcp-content
 *
 * The DRAFTING rail for the VIA content identities (Priscilla, human depth;
 * Rosie, agent depth). Exposes ONE tool, draft_nostr_content, that QUEUES an
 * approved-pending post into app_nostr_content. It does NOT publish , a human
 * approves it in the VIA admin, and only then does the server publish it to Nostr
 * (relay.getvia.xyz + broadcaster fan-out) AND surface it on /demand. This makes
 * the draft-then-approve gate real: the agent cannot publish on its own.
 *
 * Whole route gated by the x-via-token header (CONTENT_API_TOKEN); the Hermes
 * agents carry that token in their MCP transport header, never in the model
 * context, so this never trips the sandbox secret/exfil guards.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/app/db';
import { postApprovalCard } from '@/lib/app/nostr-content-approval';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function asJson(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function authorized(req: Request): boolean {
  const token = process.env.CONTENT_API_TOKEN;
  return Boolean(token) && req.headers.get('x-via-token') === token;
}

function createServer() {
  const server = new McpServer({ name: 'via-content', version: '2.0.0' });

  server.tool(
    'draft_nostr_content',
    'QUEUE an approved-pending post to VIA\'s Nostr feed under your own identity. This does NOT publish , it submits the post for Richard\'s approval. Once he approves it in the VIA admin, the server publishes it to Nostr (VIA\'s relay plus public relays via the broadcaster) and shows it on app.getvia.xyz/demand. Draft the content, tell Richard it is queued and where to approve, and wait. identity must be your own ("priscilla" for human-facing, "rosie" for agent-facing). Returns a draft_id and pending status.',
    {
      identity: z.enum(['priscilla', 'rosie']).describe('Your own VIA identity. priscilla = human-facing depth; rosie = agent-facing depth.'),
      kind:     z.union([z.literal(1), z.literal(30023)]).optional().describe('1 = short note (default), 30023 = long-form article.'),
      content:  z.string().min(1).describe('The post text. For a 30023 article this is the markdown body.'),
      title:    z.string().optional().describe('Long-form (30023) title.'),
      summary:  z.string().optional().describe('Long-form (30023) summary.'),
      slug:     z.string().optional().describe('Long-form (30023) URL slug.'),
      reply_to: z.object({ event_id: z.string(), pubkey: z.string().optional(), relay: z.string().optional() }).optional()
        .describe('Reply to another Nostr event.'),
    },
    async ({ identity, kind, content, title, summary, slug, reply_to }) => {
      const { data, error } = await db
        .from('app_nostr_content')
        .insert({
          identity,
          kind: kind ?? 1,
          content,
          title: title ?? null,
          summary: summary ?? null,
          slug: slug ?? null,
          reply_to: reply_to ?? null,
          status: 'pending',
          created_by: identity,
        })
        .select('id')
        .single();
      if (error || !data) {
        console.error('[mcp-content] draft insert failed:', error);
        return asJson({ ok: false, error: 'failed to queue draft' });
      }
      // Post the Approve/Reject card to the identity's Discord channel (best-effort;
      // the draft is also approvable from the admin page if the card fails).
      const cardPosted = await postApprovalCard(data.id as string);
      return asJson({
        ok: true,
        draft_id: data.id,
        status: 'pending',
        card_posted: cardPosted,
        message: 'Draft queued for approval. It will NOT post until Richard approves it. An Approve/Reject card was sent to your Discord channel; once he approves, it publishes to Nostr and appears on app.getvia.xyz/demand. Tell him it is queued and waiting.',
      });
    },
  );

  return server;
}

export async function GET() {
  return Response.json({
    name:        'via-content',
    version:     '2.0.0',
    description: 'Authenticated VIA content MCP. Requires the x-via-token header. Tool: draft_nostr_content (queues for human approval; does not publish).',
    protocol:    'MCP Streamable HTTP',
    tools:       ['draft_nostr_content'],
  });
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, x-via-token',
    },
  });
}
