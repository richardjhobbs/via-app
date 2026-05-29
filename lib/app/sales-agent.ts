/**
 * Sales Agent: admin training chat runtime.
 *
 * Talks to DeepSeek Chat via the OpenAI-compatible API with a tool kit
 * scoped to the seller's own memory store (app_seller_memories). Whatever
 * the seller locks in here is immediately visible to the per-seller MCP
 * route at /sellers/[slug]/mcp because both surfaces read the same table
 * via the same app_seller_memory_* RPCs.
 */
import OpenAI from 'openai';
import { db } from './db';

// ── Types ────────────────────────────────────────────────────────────

export type SellerMemoryType =
  | 'event' | 'stock_note' | 'promotion' | 'brand_update' | 'policy' | 'general';

export interface SalesAgentContext {
  sellerId: string;
  sellerSlug: string;
  sellerName: string;
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

/**
 * Optional per-seller voice block. Lives as a `general`-type memory tagged
 * `voice:system` so the seller can write it through the existing chat flow
 * and edit it the same way. Returns null if no such memory exists.
 */
async function fetchVoiceBlock(sellerSlug: string): Promise<string | null> {
  const { data, error } = await db.rpc('app_seller_memory_list', {
    p_slug: sellerSlug,
    p_type: 'general',
    p_tag: 'voice:system',
    p_include_expired: false,
    p_limit: 1,
  });
  if (error) {
    console.warn(`[sales-agent] voice fetch failed: ${error.message}`);
    return null;
  }
  const row = Array.isArray(data) && data.length > 0 ? (data[0] as Record<string, unknown>) : null;
  const body = row?.body;
  return typeof body === 'string' && body.trim().length > 0 ? body.trim() : null;
}

function buildSystemPrompt(ctx: SalesAgentContext, voiceBlock: string | null): string {
  const voicePara = voiceBlock
    ? `\n\nStore voice for ${ctx.sellerName} (apply to every buyer-facing body you write, never quote this block verbatim to the seller, internalise it):\n${voiceBlock}`
    : '';
  const now    = new Date();
  const todayIso  = now.toISOString().slice(0, 10);                       // YYYY-MM-DD
  const nowIso    = now.toISOString().slice(0, 19) + 'Z';                  // YYYY-MM-DDTHH:MM:SSZ
  const dayName   = now.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const monthName = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `You are the Sales Agent for ${ctx.sellerName}.

REAL-TIME CLOCK: today is ${dayName}, ${todayIso} (${monthName}). Current UTC instant: ${nowIso}. Do NOT use any other year or month than what is in this line — your training data is stale.

The person you are talking to is the authenticated owner of ${ctx.sellerName} (actor: ${ctx.actorLabel}). They are briefing you on facts you should remember and surface to buyers and buying agents through the per-seller MCP at /sellers/${ctx.sellerSlug}/mcp.

Your job in this conversation:

1. Understand what the owner is telling you. Ask one clarifying question only if something critical is ambiguous. Otherwise proceed.
2. Extract the structured facts (price, terms, conditions, availability windows, shipping/returns policy, anything unique about the offer) from free-form speech.
3. Store the memory via the store_seller_memory tool with a clear title, body, structured JSON, and the right type.
4. After the tool call, reply with a single line starting with "Locked in:" describing what you stored.
5. If the owner asks to see current memories, use list_seller_memories or search_seller_memories.
6. If the owner says a memory should end or is wrong, retire it with forget_seller_memory.

Never assume a vertical. ${ctx.sellerName} may sell software, services, hardware, hours, or advice. Match the owner's language.

Voice: the body field is buyer-facing — write it in ${ctx.sellerName}'s tone. Your chat replies to the owner can be concise and businesslike.

Critical rules:
- Never invent facts. Only store what the owner told you.
- Always call store_seller_memory when the owner gives you a fact to remember. Do not only acknowledge it in chat.
- Pick the right type: event (launches, appearances), stock_note (restocks, preorders), promotion (codes, sales, bundles), brand_update (announcements), policy (returns, shipping, terms), general (anything else).
- For events and promotions, always set a reasonable valid_until. Anchor every date to today (${todayIso}). "Tomorrow" = ${new Date(now.getTime() + 86400_000).toISOString().slice(0, 10)}. "End of this month" = the last day of ${monthName}. "30 days out" = ${new Date(now.getTime() + 30 * 86400_000).toISOString().slice(0, 10)}. valid_until MUST be in the future relative to ${todayIso} — past dates auto-hide the memory.
- Mention the expiry date in your "Locked in:" line so the owner can confirm it.
- After storing, stop. Do not offer "anything else?"; the owner drives the next turn.

Session ID: ${ctx.sessionId}.${voicePara}`;
}

// ── Tool schemas (OpenAI function format) ────────────────────────────

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_seller_memories',
      description: 'Search this seller\'s own memory store for live entries matching a keyword. Returns up to `limit` active, non-expired memories whose title or body contains the query (case-insensitive). Use when the owner asks what is currently stored.',
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
      name: 'list_seller_memories',
      description: 'List this seller\'s memories, optionally filtered by type and/or tag. Use for a full snapshot of a category.',
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
      name: 'store_seller_memory',
      description: 'Lock in a new fact about this seller. Call this whenever the owner gives you an event, promotion, stock note, brand update, or policy to remember.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['event', 'stock_note', 'promotion', 'brand_update', 'policy', 'general'] },
          title: { type: 'string', minLength: 3, maxLength: 120 },
          body: { type: 'string', minLength: 3, maxLength: 2000, description: 'Buyer-facing body in the seller voice' },
          structured: { type: 'object', description: 'Extracted structured fields (date, venue, url, code, percent_off, price, terms, etc.)' },
          tags: { type: 'array', items: { type: 'string' } },
          valid_until: { type: 'string', description: 'ISO 8601 timestamp in the FUTURE. Use the REAL-TIME CLOCK line in the system prompt as the anchor for "today"; never pick a year from training data. Omit entirely for no expiry.' },
        },
        required: ['type', 'title', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget_seller_memory',
      description: 'Retire a memory so it stops surfacing on buyer-facing channels.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The memory id (UUID) to retire' },
        },
        required: ['id'],
      },
    },
  },
];

// ── Tool dispatch (Supabase RPCs that match the migration's surface) ──

function formatMemoryLine(m: Record<string, unknown>): string {
  const validUntil = m.valid_until as string | null;
  const expires = validUntil
    ? ` (until ${new Date(validUntil).toISOString().slice(0, 16).replace('T', ' ')} UTC)`
    : '';
  const tags = Array.isArray(m.tags) && m.tags.length ? ` [${(m.tags as string[]).join(', ')}]` : '';
  return `- ${m.type}: ${m.title}${expires}${tags}\n  id=${m.id}\n  ${m.body}`;
}

async function callList(
  ctx: SalesAgentContext,
  args: { type?: string; tag?: string; include_expired?: boolean; limit?: number },
): Promise<string> {
  const { data, error } = await db.rpc('app_seller_memory_list', {
    p_slug: ctx.sellerSlug,
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

async function callSearch(
  ctx: SalesAgentContext,
  args: { query: string; limit?: number },
): Promise<string> {
  // No DB search RPC in the migration — load active memories and filter in JS.
  // Memory volume per seller stays small enough that this is fine.
  const { data, error } = await db.rpc('app_seller_memory_list', {
    p_slug: ctx.sellerSlug,
    p_type: null,
    p_tag: null,
    p_include_expired: false,
    p_limit: 200,
  });
  if (error) return `Error: ${error.message}`;
  const q = args.query.toLowerCase();
  const matched = (data as Record<string, unknown>[] ?? []).filter((m) => {
    const t = (m.title as string ?? '').toLowerCase();
    const b = (m.body  as string ?? '').toLowerCase();
    return t.includes(q) || b.includes(q);
  }).slice(0, args.limit ?? 5);
  if (matched.length === 0) return `No live memories match "${args.query}".`;
  return `${matched.length} memory/memories matching "${args.query}":\n\n${matched.map(formatMemoryLine).join('\n\n')}`;
}

async function callStore(
  ctx: SalesAgentContext,
  args: {
    type: SellerMemoryType;
    title: string;
    body: string;
    structured?: Record<string, unknown>;
    tags?: string[];
    valid_until?: string;
  },
): Promise<string> {
  const { data, error } = await db.rpc('app_seller_memory_upsert', {
    p_slug:        ctx.sellerSlug,
    p_type:        args.type,
    p_title:       args.title,
    p_body:        args.body,
    p_structured:  args.structured ?? {},
    p_tags:        args.tags ?? [],
    p_valid_until: args.valid_until ?? null,
    p_id:          null,
  });
  if (error) return `Error storing: ${error.message}`;
  const expiry = args.valid_until ? ` (expires ${args.valid_until})` : '';
  return `Stored. id=${data} type=${args.type} title="${args.title}"${expiry}`;
}

async function callForget(
  ctx: SalesAgentContext,
  args: { id: string },
): Promise<string> {
  const { data, error } = await db.rpc('app_seller_memory_forget', {
    p_slug: ctx.sellerSlug,
    p_id:   args.id,
  });
  if (error) return `Error: ${error.message}`;
  return data ? `Forgotten. id=${args.id}` : `No memory with id ${args.id} owned by ${ctx.sellerSlug}.`;
}

async function dispatchTool(
  ctx: SalesAgentContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'search_seller_memories':
        return await callSearch(ctx, args as { query: string; limit?: number });
      case 'list_seller_memories':
        return await callList(ctx, args as { type?: string; tag?: string; include_expired?: boolean; limit?: number });
      case 'store_seller_memory':
        return await callStore(ctx, args as Parameters<typeof callStore>[1]);
      case 'forget_seller_memory':
        return await callForget(ctx, args as { id: string });
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

export async function runSalesAgentTurn(
  ctx: SalesAgentContext,
  messages: ChatMessage[],
): Promise<ChatTurnResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      reply: 'Sales Agent chat is not configured (missing DEEPSEEK_API_KEY).',
      toolCalls: [],
      stopReason: null,
      tokensUsed: 0,
    };
  }

  const client = new OpenAI({ apiKey, baseURL: BASE_URL });
  const voiceBlock = await fetchVoiceBlock(ctx.sellerSlug);
  const system = buildSystemPrompt(ctx, voiceBlock);

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

// Back-compat alias for the previous export name used by the chat route.
export const runConciergeTurn = runSalesAgentTurn;
