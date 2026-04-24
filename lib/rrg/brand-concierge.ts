/**
 * Brand Concierge — admin chat core.
 *
 * Shared logic for the Next.js admin chat surface at
 * /admin/rrg/brands/[slug]/concierge. Talks to DeepSeek Chat via the
 * OpenAI-compatible API with a tool kit scoped to the brand's own
 * memory store. Whatever the admin locks in here is immediately visible
 * to the per-brand nanobot on Box (Telegram concierge) because both
 * surfaces read from the same rrg_brand_memories table. "One operating
 * entity" via shared state, not shared process.
 */
import OpenAI from 'openai';
import { db } from './db';

// ── Types ────────────────────────────────────────────────────────────

export type BrandMemoryType =
  | 'event' | 'stock_note' | 'promotion' | 'brand_update' | 'policy' | 'general';

export interface BrandConciergeContext {
  brandId: string;
  brandSlug: string;
  brandName: string;
  sessionId: string;
  actorLabel: string;
  actorUserId: string | null;
  source: 'admin_chat' | 'superadmin_chat';
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

// ── Provider config ──────────────────────────────────────────────────

const MODEL = 'deepseek-chat';
const BASE_URL = 'https://api.deepseek.com';

// ── System prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(ctx: BrandConciergeContext): string {
  return `You are the ${ctx.brandName} Brand Concierge, admin surface.

The person you are talking to is an authenticated admin for ${ctx.brandName} (actor: ${ctx.actorLabel}). They are briefing you on things you should remember and surface to customers on ${ctx.brandName}'s customer-facing channels (currently the Telegram concierge, more channels coming).

Your job in this conversation:

1. Understand what the admin is telling you. Ask one clarifying question only if something critical is ambiguous. Otherwise proceed.
2. Extract the structured facts (date, venue, URL, discount code, percent off, timeframe, tags) from free-form speech.
3. Store the memory via the store_brand_memory tool with a clear title, body, structured JSON, appropriate type, and a sensible valid_until.
4. Read back a one-sentence confirmation that starts with "Locked in:".
5. If the admin asks to see current memories, use list_brand_memories or search_brand_memories.
6. If the admin says a memory should end or is wrong, expire it with expire_brand_memory.

Voice: match ${ctx.brandName}'s brand voice in the body field (customer-facing). Your chat replies to the admin can be concise and businesslike, not customer-facing.

Critical rules:
- Never invent facts. Only store what the admin told you.
- Always call store_brand_memory when the admin gives you a fact to remember. Do not only acknowledge it in chat.
- Always include a confirmed_summary when calling store_brand_memory. That sentence is what you read back.
- Pick the right type: event (popups, launches, appearances), stock_note (restocks, preorders), promotion (codes, sales, bundles), brand_update (news, announcements), policy (returns, shipping, sizing rules), general (anything else).
- For events and promotions, always set a reasonable valid_until. If the admin does not specify one, infer from context (end of month, end of event date, 30 days out) and mention the expiry in your confirmation.
- After storing, stop. Do not offer "anything else?"; the admin drives the next turn.

Session ID: ${ctx.sessionId}. Pass this in every write tool call so provenance is traceable.`;
}

// ── Tool schemas (OpenAI function format) ────────────────────────────

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_brand_memories',
      description: 'Search this brand\'s own memory store for live entries matching a keyword. Returns up to `limit` active, non-expired memories. Use when the admin asks what\'s currently stored.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword(s) to match in title or body.' },
          limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_brand_memories',
      description: 'List this brand\'s memories, optionally filtered by type and/or tag. Use for a full snapshot of a category.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['event', 'stock_note', 'promotion', 'brand_update', 'policy', 'general'] },
          tag: { type: 'string' },
          include_expired: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'store_brand_memory',
      description: 'Lock in a new fact about this brand. Call this whenever the admin gives you an event, promotion, stock note, brand update, or policy to remember.',
      parameters: {
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
  },
  {
    type: 'function',
    function: {
      name: 'expire_brand_memory',
      description: 'Retire a memory so it stops surfacing on customer-facing channels.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The memory id (UUID) to expire' },
          reason: { type: 'string' },
        },
        required: ['id'],
      },
    },
  },
];

// ── Tool dispatch (direct Supabase RPC; same SQL as the brand-memory MCP) ──

function formatMemoryLine(m: Record<string, unknown>): string {
  const validUntil = m.valid_until as string | null;
  const expires = validUntil
    ? ` (until ${new Date(validUntil).toISOString().slice(0, 16).replace('T', ' ')} UTC)`
    : '';
  const tags = Array.isArray(m.tags) && m.tags.length ? ` [${(m.tags as string[]).join(', ')}]` : '';
  return `- ${m.type}: ${m.title}${expires}${tags}\n  id=${m.id}\n  ${m.body}`;
}

async function callSearch(ctx: BrandConciergeContext, args: { query: string; limit?: number }): Promise<string> {
  const { data, error } = await db.rpc('rrg_brand_memory_search', {
    p_slug: ctx.brandSlug,
    p_query: args.query,
    p_limit: args.limit ?? 5,
  });
  if (error) return `Error: ${error.message}`;
  if (!data || data.length === 0) return `No live memories match "${args.query}".`;
  const rows = data as Record<string, unknown>[];
  return `${rows.length} memory/memories matching "${args.query}":\n\n${rows.map(formatMemoryLine).join('\n\n')}`;
}

async function callList(
  ctx: BrandConciergeContext,
  args: { type?: string; tag?: string; include_expired?: boolean; limit?: number },
): Promise<string> {
  const { data, error } = await db.rpc('rrg_brand_memory_list', {
    p_slug: ctx.brandSlug,
    p_type: args.type ?? null,
    p_tag: args.tag ?? null,
    p_include_expired: args.include_expired ?? false,
    p_limit: args.limit ?? 20,
  });
  if (error) return `Error: ${error.message}`;
  if (!data || data.length === 0) return 'No memories found.';
  const rows = data as Record<string, unknown>[];
  return `${rows.length} memor${rows.length === 1 ? 'y' : 'ies'}:\n\n${rows.map(formatMemoryLine).join('\n\n')}`;
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
): Promise<string> {
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

  if (error) return `Error storing: ${error.message}`;
  const expiry = data.valid_until ? ` (expires ${data.valid_until})` : '';
  return `Stored. id=${data.id} type=${data.type} title="${data.title}"${expiry}. Read back: ${args.confirmed_summary}`;
}

async function callExpire(
  ctx: BrandConciergeContext,
  args: { id: string; reason?: string },
): Promise<string> {
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

  if (error) return `Error: ${error.message}`;
  if (!data) return `No memory with id ${args.id}.`;
  return `Expired. id=${data.id} title="${data.title}"`;
}

async function dispatchTool(
  ctx: BrandConciergeContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'search_brand_memories':
        return await callSearch(ctx, args as { query: string; limit?: number });
      case 'list_brand_memories':
        return await callList(ctx, args as { type?: string; tag?: string; include_expired?: boolean; limit?: number });
      case 'store_brand_memory':
        return await callStore(ctx, args as Parameters<typeof callStore>[1]);
      case 'expire_brand_memory':
        return await callExpire(ctx, args as { id: string; reason?: string });
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
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      reply: 'Admin chat is not configured (missing DEEPSEEK_API_KEY).',
      toolCalls: [],
      stopReason: null,
      tokensUsed: 0,
    };
  }

  const client = new OpenAI({ apiKey, baseURL: BASE_URL });
  const system = buildSystemPrompt(ctx);

  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const toolCalls: { name: string; input: unknown; result: string }[] = [];
  let tokensUsed = 0;
  let replyText = '';
  let finishReason: string | null = null;

  for (let iter = 0; iter < 6; iter++) {
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: convo,
      tools: TOOLS,
      max_tokens: 1024,
    });
    tokensUsed += (resp.usage?.prompt_tokens ?? 0) + (resp.usage?.completion_tokens ?? 0);

    const choice = resp.choices[0];
    if (!choice) break;
    finishReason = choice.finish_reason;

    const msg = choice.message;

    const assistantMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: 'assistant',
      content: msg.content ?? '',
    };
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      assistantMsg.tool_calls = msg.tool_calls;
    }
    convo.push(assistantMsg);

    if (msg.content) replyText = msg.content;

    if (!msg.tool_calls || msg.tool_calls.length === 0) break;

    for (const tc of msg.tool_calls) {
      if (tc.type !== 'function') continue;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments || '{}');
      } catch {
        parsedArgs = {};
      }
      const result = await dispatchTool(ctx, tc.function.name, parsedArgs);
      toolCalls.push({ name: tc.function.name, input: parsedArgs, result });
      convo.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  return { reply: replyText, toolCalls, stopReason: finishReason, tokensUsed };
}
