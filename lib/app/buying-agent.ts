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
import { extractIntent } from './buyer-matching';
import { teaserBrief } from './demand';
import { broadcastTeaser } from './broadcast';
import { hasCredits, deductCredits } from './buyer-credits';

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

const MODEL = 'deepseek-v4-flash';
const BASE_URL = 'https://api.deepseek.com';

// ── System prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(ctx: BuyingAgentContext): string {
  return `You are @${ctx.handle}'s Buying Agent.

You represent the buyer's interests when seller agents pitch you. The person you are talking to now is the authenticated owner of this profile (actor: ${ctx.actorLabel}). They are briefing you on their taste, budget, constraints, and hard nos so you can act on their behalf.

You handle two different things, and you must tell them apart:

A. TRAINING , how the owner buys IN GENERAL: lasting taste, a standing budget ceiling, conditions they require, sellers they favour or avoid. This is durable and applies to every future brief. Store it with store_buyer_memory.

B. A BRIEF , a SPECIFIC thing the owner wants you to go and source NOW (e.g. "find me a first pressing of London Calling under $80", "I need raw selvedge denim around 32 waist this week"). This is a one-off hunt. Create it with craft_intent, which BROADCASTS the brief to the whole VIA network. Sellers then offer against it when they have a genuine match, and those offers (the owner's matched intent) land on the dashboard.

Your job in this conversation:

1. Work out whether the owner is teaching you durable training (A) or asking you to source a specific thing now (B). Ask one clarifying question only if something critical is ambiguous. Otherwise proceed.
2. For TRAINING: extract the structured signal (a price ceiling, a category they love, a category they refuse, a brand affinity, a delivery constraint) from free-form speech, then store it via store_buyer_memory with a clear title, body, structured JSON, and the right type. After storing, reply with a single line starting with "Locked in:" describing what you stored.
3. For a BRIEF: first echo back, in one short line, the specific thing you are about to hunt for including any hard requirements and budget, so the owner can correct you. Once it is right, call craft_intent with a complete, self-contained brief in the owner's voice. After it returns, tell the owner plainly that the brief is broadcast and that offers will arrive on their dashboard as sellers respond.
4. If the owner asks what has come in, what matched, or what is available, use get_brief_results. Lead with the OFFERS (their matched intent), front and centre. If you also mention the "might also interest you" items, make clear those are not an exact match to the brief.
5. If the owner asks to see current preferences, use list_buyer_memories.
6. If the owner wants to change a stored preference, use update_buyer_memory with its id. If they want it gone, use forget_buyer_memory.

Apply stored preferences, constraints, and delegation caps when you reason about offers. Reject anything that violates a cap. Never invent preferences the buyer has not stated, and never invent details in a brief the owner did not give you.

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
  {
    type: 'function',
    function: {
      name: 'craft_intent',
      description: 'Create a live buying BRIEF for a specific thing the owner wants to source NOW and BROADCAST it to the whole VIA network. Sellers offer against it when they have a genuine match; those offers land on the owner\'s dashboard. Use this only for a concrete one-off hunt, NOT for durable taste or budget (that is store_buyer_memory). Confirm the brief with the owner in chat before calling.',
      parameters: {
        type: 'object',
        properties: {
          brief: {
            type: 'string',
            minLength: 3,
            maxLength: 2000,
            description: 'The complete, self-contained brief in natural language, in the owner\'s voice. Include the hard requirements and any budget, e.g. "First pressing of London Calling by The Clash, near mint, under $80".',
          },
        },
        required: ['brief'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_brief_results',
      description: 'Show the owner what has come in for their open briefs. Returns their MATCHED INTENT (the offers sellers have made against their briefs, the primary result) plus a secondary set of earlier catalogue items that are not an exact match but might be of interest. Use whenever the owner asks what matched, what came in, what offers they have, or what is available.',
      parameters: { type: 'object', properties: {} },
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

/**
 * Spin up a live brief from the chat and BROADCAST it: distil the structured
 * intent (so the teaser, door and proxy reaction can all read it), insert an
 * app_buyer_intents row at status 'broadcast', and let the seller side respond.
 * No synchronous index search , matching is the seller's job now. Mirrors the
 * structured Briefs page POST, so a brief crafted in chat behaves identically.
 */
async function callCraftIntent(
  ctx: BuyingAgentContext,
  args: { brief?: string },
): Promise<string> {
  const brief = (args.brief ?? '').trim();
  if (brief.length < 3) return 'Error: the brief is too short to broadcast. Ask the owner for the specific thing they want.';

  // Distilling the intent spends platform DeepSeek even on a BYO key, so it is
  // metered against credits. Block cleanly when the balance is spent.
  if (!(await hasCredits(ctx.buyerId))) {
    return 'Error: out of credits. Tell the owner they need to top up (or connect their own LLM key) before you can broadcast a brief.';
  }

  const meter = { tokens: 0 };
  let structured: Record<string, unknown> = {};
  try {
    const search_intent = await extractIntent(brief.slice(0, 2000), meter);
    structured = { search_intent, search_terms: search_intent.terms };
  } catch {
    structured = {};
  }
  if (meter.tokens > 0) {
    try { await deductCredits(ctx.buyerId, meter.tokens, 'brief broadcast (chat)'); }
    catch (e) { console.error('[buying-agent] craft_intent meter failed:', e); }
  }

  const { data, error } = await db
    .from('app_buyer_intents')
    .insert({ buyer_id: ctx.buyerId, intent_text: brief.slice(0, 2000), structured, status: 'broadcast', broadcast_at: new Date().toISOString() })
    .select('id, structured')
    .single();
  if (error || !data) return `Error creating the brief: ${error?.message ?? 'insert failed'}`;

  // Publish the teaser to the broadcast channels (NOSTR relay + the pull feed).
  const teaser = teaserBrief({ id: data.id as string, structured: data.structured as Record<string, unknown> | null });
  if (teaser) await broadcastTeaser(teaser);

  return `Brief broadcast to the whole VIA network (id=${data.id}). Sellers will offer against it when they have a genuine match, and those offers land on the owner's dashboard. Tell the owner it is live and broadcasting, and that offers will arrive as sellers respond.`;
}

/**
 * Deliver the owner's results: their MATCHED INTENT (seller offers against their
 * briefs) front and centre, ranked by the judge score and capped per brief to the
 * brief's option_count; plus a clearly-secondary "might also interest you" set
 * from the legacy catalogue matches (kept for serendipity until the network has
 * scale). The agent relays this, leading with the offers.
 */
async function callBriefResults(ctx: BuyingAgentContext): Promise<string> {
  const DEFAULT_OPTION_COUNT = 5;

  const [{ data: intentRows }, { data: offerRows }, { data: matchRows }] = await Promise.all([
    db.from('app_buyer_intents')
      .select('id, intent_text, structured')
      .eq('buyer_id', ctx.buyerId)
      .in('status', ['open', 'broadcast', 'matched']),
    db.from('app_buyer_brief_pitches')
      .select('intent_id, product, verdict, seller_name')
      .eq('buyer_id', ctx.buyerId)
      .order('created_at', { ascending: false })
      .limit(100),
    db.from('app_buyer_intent_matches')
      .select('title, seller_name, price_usdc, currency')
      .eq('buyer_id', ctx.buyerId)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  const optionCount = new Map<string, number>();
  const briefText = new Map<string, string>();
  for (const i of (intentRows ?? []) as Array<{ id: string; intent_text: string; structured: Record<string, unknown> | null }>) {
    const oc = (i.structured ?? {})['option_count'];
    optionCount.set(i.id, typeof oc === 'number' && oc > 0 ? oc : DEFAULT_OPTION_COUNT);
    briefText.set(i.id, i.intent_text);
  }

  // Group offers per brief, rank (fits first, then score), cap to option_count.
  type Offer = { intentId: string; title: string; price: number | null; seller: string; fits: boolean; score: number; reason: string };
  const byBrief = new Map<string, Offer[]>();
  for (const p of (offerRows ?? []) as Array<Record<string, unknown>>) {
    const intentId = p.intent_id as string;
    if (!briefText.has(intentId)) continue; // only open briefs
    const product = (p.product ?? {}) as Record<string, unknown>;
    const verdict = (p.verdict ?? {}) as Record<string, unknown>;
    const o: Offer = {
      intentId,
      title: (product.title as string) ?? 'Untitled',
      price: typeof product.price_usdc === 'number' ? product.price_usdc : null,
      seller: (p.seller_name as string | null) ?? 'a seller',
      fits: verdict.fits === true,
      score: typeof verdict.score === 'number' ? verdict.score : 0,
      reason: (verdict.reason as string) ?? '',
    };
    const arr = byBrief.get(intentId) ?? [];
    arr.push(o);
    byBrief.set(intentId, arr);
  }

  const lines: string[] = [];
  let offerTotal = 0;
  for (const [intentId, group] of byBrief) {
    group.sort((a, b) => (Number(b.fits) - Number(a.fits)) || (b.score - a.score));
    const capped = group.slice(0, optionCount.get(intentId) ?? DEFAULT_OPTION_COUNT);
    if (capped.length === 0) continue;
    lines.push(`Brief: "${(briefText.get(intentId) ?? '').slice(0, 80)}"`);
    for (const o of capped) {
      offerTotal++;
      lines.push(`  - ${o.title}${o.price !== null ? ` , ${o.price} USDC` : ''} (${o.seller}; ${o.fits ? 'fits' : 'partial'}, score ${o.score})${o.reason ? `: ${o.reason}` : ''}`);
    }
  }

  const matches = (matchRows ?? []) as Array<{ title: string; seller_name: string; price_usdc: number | null; currency: string }>;

  const out: string[] = [];
  if (offerTotal > 0) {
    out.push(`MATCHED INTENT , ${offerTotal} offer${offerTotal === 1 ? '' : 's'} sellers have made against the open briefs (lead with these):`);
    out.push(...lines);
  } else {
    out.push('MATCHED INTENT: no seller offers yet. The open briefs are broadcast; offers arrive as sellers respond.');
  }
  if (matches.length > 0) {
    out.push('');
    out.push('MIGHT ALSO INTEREST YOU , earlier catalogue items, NOT an exact match to the brief but possibly of interest (present as secondary only):');
    for (const m of matches) {
      out.push(`  - ${m.title}${m.price_usdc !== null ? ` , ${m.price_usdc} ${m.currency}` : ''} (${m.seller_name})`);
    }
  }
  return out.join('\n');
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
      case 'craft_intent':
        return await callCraftIntent(ctx, args as { brief?: string });
      case 'get_brief_results':
        return await callBriefResults(ctx);
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
  isByo: boolean;
}

/** LLM config for a turn. Defaults to the platform DeepSeek model. */
export interface TurnLlm {
  apiKey: string;
  baseURL: string;
  model: string;
  isByo: boolean;
}

export async function runBuyingAgentTurn(
  ctx: BuyingAgentContext,
  messages: ChatMessage[],
  llm?: TurnLlm,
): Promise<ChatTurnResult> {
  const cfg: TurnLlm = llm ?? {
    apiKey:  process.env.DEEPSEEK_API_KEY ?? '',
    baseURL: BASE_URL,
    model:   MODEL,
    isByo:   false,
  };
  if (!cfg.apiKey) {
    return {
      reply: 'Buying Agent chat is not configured (no LLM key available).',
      toolCalls: [],
      stopReason: null,
      tokensUsed: 0,
      isByo: cfg.isByo,
    };
  }

  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
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
      model: cfg.model,
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

  return { reply: replyText, toolCalls, stopReason: finishReason, tokensUsed, isByo: cfg.isByo };
}
