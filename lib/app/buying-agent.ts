/**
 * Buying Agent: owner training chat runtime.
 *
 * Talks to DeepSeek Chat via the OpenAI-compatible API with a tool kit
 * scoped to the buyer's own memory store (app_buyer_memories). Whatever
 * the buyer locks in here shapes how their agent responds when seller
 * agents negotiate at /buyers/[handle]/mcp, since both surfaces read the
 * same table via the same app_buyer_memory_* RPCs.
 *
 * Perspective is inverted from the Sales Agent: this agent represents the
 * buyer, applies their preferences and delegation caps, and rejects offers
 * that violate a cap. It never invents preferences the buyer hasn't stated.
 */
import OpenAI from 'openai';
import { db } from './db';

// ── Types ────────────────────────────────────────────────────────────

export type BuyerMemoryType =
  | 'preference' | 'constraint' | 'budget' | 'brand_affinity' | 'general';

const BUYER_MEMORY_TYPES: BuyerMemoryType[] =
  ['preference', 'constraint', 'budget', 'brand_affinity', 'general'];

export interface BuyingAgentContext {
  buyerId: string;
  handle: string;
  displayName: string;
  sessionId: string;
  actorLabel: string;
  actorUserId: string | null;
  source: 'owner_chat' | 'superadmin_chat';
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

// ── Provider config ──────────────────────────────────────────────────

const MODEL = 'deepseek-chat';
const BASE_URL = 'https://api.deepseek.com';

// ── System prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(ctx: BuyingAgentContext): string {
  return `You are @${ctx.handle}'s Buying Agent.

You represent the buyer's interests when seller agents pitch you. The person you are talking to now is the authenticated owner of this profile (actor: ${ctx.actorLabel}). They are briefing you on their taste, budget, constraints, and hard nos so you can act on their behalf.

Your job in this conversation:

1. Understand what the owner is telling you about how they want to buy. Ask one clarifying question only if something critical is ambiguous. Otherwise proceed.
2. Extract the structured signal (a price ceiling, a category they love, a category they refuse, a brand affinity, a delivery constraint) from free-form speech.
3. Store it via the store_buyer_memory tool with a clear title, body, structured JSON, and the right type.
4. After the tool call, reply with a single line starting with "Locked in:" describing what you stored.
5. If the owner asks to see current preferences, use list_buyer_memories.
6. If the owner wants to change a stored preference, use update_buyer_memory with its id. If they want it gone, use forget_buyer_memory.

Apply stored preferences, constraints, and delegation caps when you reason about offers. Reject anything that violates a cap. Never invent preferences the buyer has not stated.

Pick the right type:
- preference (styles, materials, qualities they want)
- constraint (delivery windows, locations, conditions they require)
- budget (price ceilings, spend limits, value expectations)
- brand_affinity (sellers or makers they favour or avoid)
- general (anything else)

Critical rules:
- Never invent facts. Only store what the owner told you.
- Always call store_buyer_memory when the owner gives you a preference to remember. Do not only acknowledge it in chat.
- After storing, stop. Do not offer "anything else?"; the owner drives the next turn.

Session ID: ${ctx.sessionId}.`;
}

// ── Tool schemas (OpenAI function format) ────────────────────────────

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_buyer_memories',
      description: 'List this buyer\'s stored preferences, optionally filtered by type and/or tag. Use for a snapshot of what is currently locked in.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: BUYER_MEMORY_TYPES },
          tag: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'store_buyer_memory',
      description: 'Lock in a new preference, constraint, budget, or brand affinity for this buyer. Call this whenever the owner gives you something to remember about how they want to buy.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: BUYER_MEMORY_TYPES },
          title: { type: 'string', minLength: 3, maxLength: 120 },
          body: { type: 'string', minLength: 3, maxLength: 2000, description: 'Plain description of the preference in the buyer\'s words' },
          structured: { type: 'object', description: 'Extracted structured fields (max_usd, category, brand, condition, etc.)' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['type', 'title', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_buyer_memory',
      description: 'Revise an existing stored preference in place. Use when the owner changes their mind about something already locked in.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The memory id (UUID) to revise' },
          type: { type: 'string', enum: BUYER_MEMORY_TYPES },
          title: { type: 'string', minLength: 3, maxLength: 120 },
          body: { type: 'string', minLength: 3, maxLength: 2000 },
          structured: { type: 'object' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'type', 'title', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget_buyer_memory',
      description: 'Retire a stored preference so it no longer shapes how the agent buys.',
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

// ── Tool dispatch (Supabase RPCs that match migration 0002) ──

function formatMemoryLine(m: Record<string, unknown>): string {
  const tags = Array.isArray(m.tags) && m.tags.length ? ` [${(m.tags as string[]).join(', ')}]` : '';
  return `- ${m.type}: ${m.title}${tags}\n  id=${m.id}\n  ${m.body}`;
}

async function callList(
  ctx: BuyingAgentContext,
  args: { type?: string; tag?: string; limit?: number },
): Promise<string> {
  const { data, error } = await db.rpc('app_buyer_memory_list', {
    p_handle: ctx.handle,
    p_type:   args.type ?? null,
    p_tag:    args.tag ?? null,
    p_limit:  args.limit ?? 20,
  });
  if (error) return `Error: ${error.message}`;
  if (!data || data.length === 0) return 'No preferences stored yet.';
  const rows = data as Record<string, unknown>[];
  return `${rows.length} preference${rows.length === 1 ? '' : 's'}:\n\n${rows.map(formatMemoryLine).join('\n\n')}`;
}

async function callStore(
  ctx: BuyingAgentContext,
  args: {
    type: BuyerMemoryType;
    title: string;
    body: string;
    structured?: Record<string, unknown>;
    tags?: string[];
    id?: string;
  },
): Promise<string> {
  const { data, error } = await db.rpc('app_buyer_memory_upsert', {
    p_handle:     ctx.handle,
    p_type:       args.type,
    p_title:      args.title,
    p_body:       args.body,
    p_structured: args.structured ?? {},
    p_tags:       args.tags ?? [],
    p_id:         args.id ?? null,
  });
  if (error) return `Error storing: ${error.message}`;
  const verb = args.id ? 'Updated' : 'Stored';
  return `${verb}. id=${data} type=${args.type} title="${args.title}"`;
}

async function callForget(
  ctx: BuyingAgentContext,
  args: { id: string },
): Promise<string> {
  const { data, error } = await db.rpc('app_buyer_memory_forget', {
    p_handle: ctx.handle,
    p_id:     args.id,
  });
  if (error) return `Error: ${error.message}`;
  return data ? `Forgotten. id=${args.id}` : `No preference with id ${args.id} owned by @${ctx.handle}.`;
}

async function dispatchTool(
  ctx: BuyingAgentContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'list_buyer_memories':
        return await callList(ctx, args as { type?: string; tag?: string; limit?: number });
      case 'store_buyer_memory':
        return await callStore(ctx, args as Parameters<typeof callStore>[1]);
      case 'update_buyer_memory':
        return await callStore(ctx, args as Parameters<typeof callStore>[1]);
      case 'forget_buyer_memory':
        return await callForget(ctx, args as { id: string });
      default:
        return `Error: unknown tool "${name}"`;
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return `Error: ${err}`;
  }
}

// ── Main entry: run one turn of the owner chat ────────────────────────

export interface ChatTurnResult {
  reply: string;
  toolCalls: { name: string; input: unknown; result: string }[];
  stopReason: string | null;
  tokensUsed: number;
}

export async function runBuyingAgentTurn(
  ctx: BuyingAgentContext,
  messages: ChatMessage[],
): Promise<ChatTurnResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      reply: 'Buying Agent chat is not configured (missing DEEPSEEK_API_KEY).',
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
