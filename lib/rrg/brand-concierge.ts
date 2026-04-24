/**
 * Brand Concierge — admin chat core.
 *
 * Shared logic for the Next.js admin chat surface at
 * /admin/rrg/brands/[slug]/concierge. Talks to Claude Haiku with a tool
 * kit scoped to the brand's own memory store. Whatever the admin locks in
 * here is immediately visible to the per-brand nanobot on Box (Telegram
 * concierge) because both surfaces read from the same rrg_brand_memories
 * table. "One operating entity" via shared state, not shared process.
 *
 * Writes are gated by the caller (route handler must authenticate the
 * admin first via requireBrandAuth or isAdminFromCookies).
 */
import Anthropic from '@anthropic-ai/sdk';
import { db } from './db';

// ── Types ────────────────────────────────────────────────────────────

export type BrandMemoryType =
  | 'event' | 'stock_note' | 'promotion' | 'brand_update' | 'policy' | 'general';

export interface BrandConciergeContext {
  brandId: string;
  brandSlug: string;
  brandName: string;
  sessionId: string;
  // Provenance for writes
  actorLabel: string;            // "Richard (superadmin)" or admin email
  actorUserId: string | null;    // Supabase auth user id, or null for superadmin
  source: 'admin_chat' | 'superadmin_chat';
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

// ── Model ────────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5-20251001';

// ── System prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(ctx: BrandConciergeContext): string {
  return `You are the ${ctx.brandName} Brand Concierge — admin surface.

The person you are talking to is an authenticated admin for ${ctx.brandName} (actor: ${ctx.actorLabel}). They are briefing you on things you should remember and surface to customers on ${ctx.brandName}'s customer-facing channels (currently the Telegram concierge, more channels coming).

Your job in this conversation:

1. Understand what the admin is telling you. Ask one clarifying question only if something critical is ambiguous. Otherwise proceed.
2. Extract the structured facts (date, venue, URL, discount code, percent off, timeframe, tags) from free-form speech.
3. Store the memory via the store_brand_memory tool with a clear title, body, structured JSON, appropriate type, and sensible valid_until.
4. Read back a one-sentence confirmation to the admin, starting with "Locked in:" and summarising what was stored.
5. If the admin asks to see current memories, list them with list_brand_memories or search for specifics with search_brand_memories.
6. If the admin says a memory should end or is wrong, expire it with expire_brand_memory.

Voice: match ${ctx.brandName}'s brand voice in the "body" field (customer-facing). Your chat replies to the admin can be concise and businesslike — they are not a customer.

Critical rules:
- Never invent facts. Only store what the admin told you.
- Always call store_brand_memory when the admin gives you a fact to remember. Do not just acknowledge it in chat.
- Always include a confirmed_summary when calling store_brand_memory — that sentence is what you read back.
- Pick the right type: event (popups, launches, appearances), stock_note (restocks, preorders), promotion (codes, sales, bundles), brand_update (news, announcements), policy (returns, shipping, sizing rules), general (anything else).
- For events and promotions, always set a reasonable valid_until. If the admin doesn't specify one, infer from context (end of month, end of event date, 30 days out) and mention it in your confirmation.
- After storing, stop. Do not offer "anything else?" — admin drives the next turn.

Session ID: ${ctx.sessionId}. Pass this in every write tool call so provenance is traceable.`;
}

// ── Tool schemas (same as brand-memory MCP) ──────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_brand_memories',
    description: 'Search this brand\'s own memory store for live entries matching a keyword. Returns up to `limit` active, non-expired memories. Use when the admin asks what\'s currently stored.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword(s) to match in title or body.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_brand_memories',
    description: 'List this brand\'s memories, optionally filtered by type and/or tag. Use for a full snapshot of a category.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['event', 'stock_note', 'promotion', 'brand_update', 'policy', 'general'] },
        tag: { type: 'string' },
        include_expired: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'store_brand_memory',
    description: 'Lock in a new fact about this brand. Call this whenever the admin gives you an event, promotion, stock note, brand update, or policy to remember.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['event', 'stock_note', 'promotion', 'brand_update', 'policy', 'general'] },
        title: { type: 'string', minLength: 3, maxLength: 120 },
        body: { type: 'string', minLength: 3, maxLength: 2000, description: 'Customer-facing body in the brand voice' },
        structured: { type: 'object', description: 'Extracted structured fields (date, venue, url, code, percent_off, etc.)' },
        tags: { type: 'array', items: { type: 'string' } },
        valid_from: { type: 'string', description: 'ISO timestamp; defaults to now' },
        valid_until: { type: 'string', description: 'ISO timestamp; omit for no expiry' },
        confirmed_summary: { type: 'string', description: 'One-sentence human summary you will read back to the admin. Start with "Locked in:"' },
      },
      required: ['type', 'title', 'body', 'confirmed_summary'],
    },
  },
  {
    name: 'expire_brand_memory',
    description: 'Retire a memory so it stops surfacing on customer channels.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The memory id (UUID) to expire' },
        reason: { type: 'string' },
      },
      required: ['id'],
    },
  },
];

// ── Tool dispatch (direct Supabase RPC; same SQL as the brand-memory MCP) ──

interface ToolResult {
  text: string;
  error?: string;
}

function formatMemoryLine(m: Record<string, unknown>): string {
  const validUntil = m.valid_until as string | null;
  const expires = validUntil
    ? ` (until ${new Date(validUntil).toISOString().slice(0, 16).replace('T', ' ')} UTC)`
    : '';
  const tags = Array.isArray(m.tags) && m.tags.length ? ` [${(m.tags as string[]).join(', ')}]` : '';
  return `- ${m.type}: ${m.title}${expires}${tags}\n  id=${m.id}\n  ${m.body}`;
}

async function callSearch(ctx: BrandConciergeContext, args: { query: string; limit?: number }): Promise<ToolResult> {
  const { data, error } = await db.rpc('rrg_brand_memory_search', {
    p_slug: ctx.brandSlug,
    p_query: args.query,
    p_limit: args.limit ?? 5,
  });
  if (error) return { text: `Error: ${error.message}`, error: error.message };
  if (!data || data.length === 0) return { text: `No live memories match "${args.query}".` };
  const rows = data as Record<string, unknown>[];
  return { text: `${rows.length} memory/memories matching "${args.query}":\n\n${rows.map(formatMemoryLine).join('\n\n')}` };
}

async function callList(
  ctx: BrandConciergeContext,
  args: { type?: string; tag?: string; include_expired?: boolean; limit?: number },
): Promise<ToolResult> {
  const { data, error } = await db.rpc('rrg_brand_memory_list', {
    p_slug: ctx.brandSlug,
    p_type: args.type ?? null,
    p_tag: args.tag ?? null,
    p_include_expired: args.include_expired ?? false,
    p_limit: args.limit ?? 20,
  });
  if (error) return { text: `Error: ${error.message}`, error: error.message };
  if (!data || data.length === 0) return { text: 'No memories found.' };
  const rows = data as Record<string, unknown>[];
  return { text: `${rows.length} memor${rows.length === 1 ? 'y' : 'ies'}:\n\n${rows.map(formatMemoryLine).join('\n\n')}` };
}

async function callStore(
  ctx: BrandConciergeContext,
  args: {
    type: BrandMemoryType;
    title: string;
    body: string;
    structured?: Record<string, unknown>;
    tags?: string[];
    valid_from?: string;
    valid_until?: string;
    confirmed_summary: string;
  },
): Promise<ToolResult> {
  const { data, error } = await db
    .from('rrg_brand_memories')
    .insert({
      brand_id: ctx.brandId,
      brand_slug: ctx.brandSlug,
      type: args.type,
      title: args.title,
      body: args.body,
      structured: args.structured ?? {},
      tags: args.tags ?? [],
      valid_from: args.valid_from ?? new Date().toISOString(),
      valid_until: args.valid_until ?? null,
      confirmed_summary: args.confirmed_summary,
      source: ctx.source,
      created_by_user_id: ctx.actorUserId,
      created_by_label: ctx.actorLabel,
      session_id: ctx.sessionId,
    })
    .select('id, type, title, valid_until')
    .single();

  if (error) return { text: `Error storing: ${error.message}`, error: error.message };
  const expiry = data.valid_until ? ` (expires ${data.valid_until})` : '';
  return { text: `Stored. id=${data.id} type=${data.type} title="${data.title}"${expiry}. Read back: ${args.confirmed_summary}` };
}

async function callExpire(
  ctx: BrandConciergeContext,
  args: { id: string; reason?: string },
): Promise<ToolResult> {
  const { data, error } = await db
    .from('rrg_brand_memories')
    .update({
      active: false,
      valid_until: new Date().toISOString(),
      confirmed_summary: args.reason ?? 'expired by admin',
    })
    .eq('brand_id', ctx.brandId)
    .eq('id', args.id)
    .select('id, title')
    .single();

  if (error) return { text: `Error: ${error.message}`, error: error.message };
  if (!data) return { text: `No memory with id ${args.id}.` };
  return { text: `Expired. id=${data.id} title="${data.title}"` };
}

async function dispatchTool(
  ctx: BrandConciergeContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'search_brand_memories':
        return (await callSearch(ctx, args as { query: string; limit?: number })).text;
      case 'list_brand_memories':
        return (await callList(ctx, args as { type?: string; tag?: string; include_expired?: boolean; limit?: number })).text;
      case 'store_brand_memory':
        return (await callStore(ctx, args as Parameters<typeof callStore>[1])).text;
      case 'expire_brand_memory':
        return (await callExpire(ctx, args as { id: string; reason?: string })).text;
      default:
        return `Error: unknown tool "${name}"`;
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return `Error: ${err}`;
  }
}

// ── Main entry: run one turn of the admin chat ────────────────────────

export interface ChatTurnResult {
  reply: string;
  toolCalls: { name: string; input: unknown; result: string }[];
  stopReason: string | null;
  tokensUsed: number;
}

export async function runConciergeTurn(
  ctx: BrandConciergeContext,
  messages: ChatMessage[],
): Promise<ChatTurnResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      reply: 'Admin chat is not configured (missing ANTHROPIC_API_KEY).',
      toolCalls: [],
      stopReason: null,
      tokensUsed: 0,
    };
  }

  const client = new Anthropic({ apiKey });
  const system = buildSystemPrompt(ctx);

  // Convert our message shape to Anthropic's
  const convo: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const toolCalls: { name: string; input: unknown; result: string }[] = [];
  let tokensUsed = 0;
  let replyText = '';
  let stopReason: string | null = null;

  // Tool-call loop — bounded
  for (let iter = 0; iter < 6; iter++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: TOOLS,
      messages: convo,
    });
    tokensUsed += (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0);
    stopReason = resp.stop_reason;

    // Collect text + tool_use blocks from this turn
    const assistantBlocks: Anthropic.ContentBlockParam[] = [];
    let anyToolUse = false;

    for (const block of resp.content) {
      if (block.type === 'text') {
        replyText = block.text;
        assistantBlocks.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        anyToolUse = true;
        assistantBlocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    if (!anyToolUse) break;

    // Push assistant turn, then dispatch tools, then push tool_result turn
    convo.push({ role: 'assistant', content: assistantBlocks });

    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type === 'tool_use') {
        const result = await dispatchTool(ctx, block.name, block.input as Record<string, unknown>);
        toolCalls.push({ name: block.name, input: block.input, result });
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }
    convo.push({ role: 'user', content: toolResultBlocks });
  }

  return { reply: replyText, toolCalls, stopReason, tokensUsed };
}
