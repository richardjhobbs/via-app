/**
 * lib/rrg/telegram-bot.ts
 * RRG Telegram Bot — knowledge retrieval, Together.ai LLM, command handling.
 *
 * Bot: @realrealgenuine_bot
 * Responds to DMs, @mentions in group, and /commands.
 */

import {
  db,
  getApprovedDrops,
  getDropByTokenId,
  getPurchaseCountsByTokenIds,
  getAllActiveBrands,
  getOpenBriefs,
  getContributorStats,
} from '@/lib/rrg/db';

// ── Config ────────────────────────────────────────────────────────────────

const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY ?? '';
const TOGETHER_MODEL   = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
const BOT_USERNAME     = 'realrealgenuine_bot';
const SITE_URL         = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com').replace(/\/$/, '');

// ── Telegram types (subset) ───────────────────────────────────────────────

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export interface TgMessage {
  message_id: number;
  from?:      TgUser;
  chat:       TgChat;
  text?:      string;
  entities?:  TgEntity[];
  reply_to_message?: TgMessage;
}

interface TgUser {
  id:         number;
  first_name: string;
  username?:  string;
  is_bot:     boolean;
}

interface TgChat {
  id:   number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

interface TgEntity {
  type:   string;
  offset: number;
  length: number;
}

// ── Rate limiting ─────────────────────────────────────────────────────────

const rateLimits = new Map<number, { count: number; windowStart: number }>();
const WINDOW_MS       = 60_000;
const LIMIT_GROUP     = 5;
const LIMIT_DM        = 10;

function isRateLimited(chatId: number, isPrivate: boolean): boolean {
  const now   = Date.now();
  const limit = isPrivate ? LIMIT_DM : LIMIT_GROUP;
  const entry = rateLimits.get(chatId);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimits.set(chatId, { count: 1, windowStart: now });
    return false;
  }

  entry.count++;
  if (entry.count > limit) return true;
  return false;
}

// ── Relevance check ───────────────────────────────────────────────────────

export function isRelevant(update: TgUpdate): boolean {
  const msg = update.message;
  if (!msg?.text) return false;

  // Always respond to DMs
  if (msg.chat.type === 'private') return true;

  // In groups: respond to @mentions
  if (msg.entities?.some(e =>
    e.type === 'mention' &&
    msg.text!.slice(e.offset, e.offset + e.length).toLowerCase() === `@${BOT_USERNAME}`
  )) return true;

  // In groups: respond to /commands directed at the bot or without target
  if (msg.entities?.some(e => e.type === 'bot_command')) {
    const cmdText = msg.text!.slice(0, msg.text!.indexOf(' ') > 0 ? msg.text!.indexOf(' ') : undefined);
    // /drops or /drops@realrealgenuine_bot
    if (!cmdText.includes('@') || cmdText.toLowerCase().includes(`@${BOT_USERNAME}`)) {
      return true;
    }
  }

  // Respond to replies to the bot's own messages
  if (msg.reply_to_message?.from?.username?.toLowerCase() === BOT_USERNAME) return true;

  return false;
}

// ── Command extraction ────────────────────────────────────────────────────

interface ParsedCommand {
  command: string | null;
  args:    string;
  query:   string; // text with @mention stripped
}

export function parseCommand(msg: TgMessage): ParsedCommand {
  const text = msg.text ?? '';

  // Extract /command
  const cmdEntity = msg.entities?.find(e => e.type === 'bot_command');
  if (cmdEntity) {
    const raw = text.slice(cmdEntity.offset, cmdEntity.offset + cmdEntity.length);
    const command = raw.split('@')[0].slice(1).toLowerCase(); // "/drops@bot" → "drops"
    const args = text.slice(cmdEntity.offset + cmdEntity.length).trim();
    return { command, args, query: args };
  }

  // Strip @mention for free-text
  const query = text
    .replace(new RegExp(`@${BOT_USERNAME}`, 'gi'), '')
    .trim();

  return { command: null, args: '', query };
}

// ── Knowledge retrieval ───────────────────────────────────────────────────

async function getDropsSummary(): Promise<string> {
  const drops = await getApprovedDrops();
  if (drops.length === 0) return 'No drops listed yet.';

  const tokenIds = drops.map(d => d.token_id!).filter(Boolean);
  const purchaseCounts = await getPurchaseCountsByTokenIds(tokenIds);

  const lines = drops.slice(0, 10).map(d => {
    const sold = purchaseCounts.get(d.token_id!) ?? 0;
    const remaining = d.edition_size - sold;
    const price = parseFloat(d.price_usdc ?? '0').toFixed(2);
    const status = remaining > 0 ? `${remaining}/${d.edition_size} left` : 'SOLD OUT';
    return `• #${d.token_id} ${d.title} — $${price} USDC (${status})`;
  });

  if (drops.length > 10) {
    lines.push(`...and ${drops.length - 10} more at ${SITE_URL}/rrg`);
  }

  return lines.join('\n');
}

async function getDropDetail(tokenId: number): Promise<string> {
  const drop = await getDropByTokenId(tokenId);
  if (!drop) return `Drop #${tokenId} not found.`;

  const counts = await getPurchaseCountsByTokenIds([tokenId]);
  const sold = counts.get(tokenId) ?? 0;
  const remaining = drop.edition_size - sold;
  const price = parseFloat(drop.price_usdc ?? '0').toFixed(2);

  const lines = [
    `🎨 ${drop.title}`,
    drop.description ? drop.description.split('\n')[0].slice(0, 200) : null,
    `Price: $${price} USDC`,
    `Editions: ${remaining}/${drop.edition_size} remaining`,
    sold > 0 ? `${sold} sold` : null,
    `View: ${SITE_URL}/rrg/drop/${tokenId}`,
  ];

  return lines.filter(Boolean).join('\n');
}

async function getBrandsSummary(): Promise<string> {
  const brands = await getAllActiveBrands();
  if (brands.length === 0) return 'No active brands yet.';

  const lines = brands.map(b => {
    const desc = b.headline || b.description?.slice(0, 60) || '';
    return `• ${b.name}${desc ? ` — ${desc}` : ''}`;
  });

  return lines.join('\n');
}

async function getBriefsSummary(): Promise<string> {
  const briefs = await getOpenBriefs();
  if (briefs.length === 0) return 'No active briefs right now. Check back soon!';

  const lines = briefs.map(b => {
    const desc = b.description.slice(0, 80);
    const ends = b.ends_at ? ` (ends ${new Date(b.ends_at).toLocaleDateString()})` : '';
    return `• ${b.title}${ends}\n  ${desc}`;
  });

  return lines.join('\n\n');
}

async function getPlatformStats(): Promise<string> {
  const drops = await getApprovedDrops();
  const brands = await getAllActiveBrands();
  const stats = await getContributorStats();

  const { count: totalSales } = await db
    .from('rrg_purchases')
    .select('id', { count: 'exact', head: true });

  return [
    `📊 RRG Platform Stats`,
    `Drops: ${drops.length}`,
    `Sales: ${totalSales ?? 0}`,
    `Creators: ${stats.total} (${stats.humans} human, ${stats.agents} agent)`,
    `Brands: ${brands.length}`,
  ].join('\n');
}

// ── Build dynamic context for LLM ────────────────────────────────────────

async function buildContext(): Promise<string> {
  const [briefs, drops, stats] = await Promise.all([
    getOpenBriefs(),
    getApprovedDrops(),
    getContributorStats(),
  ]);

  const { count: totalSales } = await db
    .from('rrg_purchases')
    .select('id', { count: 'exact', head: true });

  const briefLines = briefs.slice(0, 3).map(b =>
    `- "${b.title}": ${b.description.slice(0, 100)}`
  ).join('\n');

  const dropLines = drops.slice(0, 5).map(d =>
    `- #${d.token_id} "${d.title}" at $${parseFloat(d.price_usdc ?? '0').toFixed(2)} USDC (${d.edition_size} editions)`
  ).join('\n');

  return [
    `CURRENT BRIEFS (creative challenges):\n${briefLines || 'None active'}`,
    `RECENT DROPS:\n${dropLines || 'None yet'}`,
    `STATS: ${drops.length} drops, ${totalSales ?? 0} sales, ${stats.total} creators (${stats.humans} human, ${stats.agents} agent)`,
  ].join('\n\n');
}

// ── System prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the RRG Bot — the official voice of Real Real Genuine (RRG), an open co-creation commerce platform on Base blockchain.

WHAT RRG IS:
- AI agents and humans collaborate to design, buy, and sell physical and digital products
- Creators submit designs responding to creative briefs from brands
- Approved designs become limited-edition drops (ERC-1155 NFTs) purchasable with USDC
- Creators earn 70% of each sale, brands 20%, platform 10%
- Both AI agents and humans can create and buy

YOUR PERSONALITY:
- Knowledgeable but not salesy — you're helpful and genuine
- Concise — this is Telegram, keep responses short (2-4 sentences for chat, longer for /commands)
- Enthusiastic about co-creation and the intersection of AI + human creativity
- You know the current drops, briefs, and brands (provided in context below)
- If you don't have specific info, say so and point to realrealgenuine.com/rrg

IMPORTANT:
- Only reference data from the context provided below. Do not invent drops, brands, or prices.
- For detailed info, direct users to realrealgenuine.com/rrg or suggest /drops, /brands, /briefs commands
- You can mention that RRG uses ERC-8004 agent identity and has an MCP server for AI agents
- The gallery is at realrealgenuine.com/rrg, submissions at realrealgenuine.com/rrg/submit`;

// ── Together.ai LLM ──────────────────────────────────────────────────────

async function callLLM(userMessage: string, isPrivate: boolean): Promise<string> {
  if (!TOGETHER_API_KEY) {
    return "I'm not fully configured yet — try /drops or /briefs for quick info!";
  }

  const context = await buildContext();
  const maxTokens = isPrivate ? 500 : 300;

  const resp = await fetch('https://api.together.xyz/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${TOGETHER_API_KEY}`,
    },
    body: JSON.stringify({
      model:      TOGETHER_MODEL,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\n--- LIVE CONTEXT ---\n${context}` },
        { role: 'user',   content: userMessage },
      ],
      max_tokens:  maxTokens,
      temperature: 0.7,
      stop:        ['<|eot_id|>'],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) {
    console.error('[telegram-bot] Together.ai error:', resp.status, await resp.text());
    return "I'm having trouble thinking right now. Try /drops or /briefs for quick info!";
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  return content || "I'm not sure how to answer that. Try /drops or /briefs!";
}

// ── Command handlers ──────────────────────────────────────────────────────

async function handleCommand(cmd: string, args: string): Promise<string> {
  switch (cmd) {
    case 'start':
      return [
        '👋 Hey! I\'m the RRG Bot — your guide to Real Real Genuine.',
        '',
        'RRG is an open co-creation platform where AI agents and humans design, buy, and sell products together on Base.',
        '',
        'Commands:',
        '/drops — Browse current drops',
        '/brands — See active brands',
        '/briefs — Current creative challenges',
        '/drop <id> — Drop details (e.g. /drop 5)',
        '/stats — Platform stats',
        '/help — This message',
        '',
        `Or just ask me anything about RRG! 🎨`,
      ].join('\n');

    case 'help':
      return [
        '📖 RRG Bot Commands:',
        '/drops — Browse listed drops with prices',
        '/brands — Active brands on RRG',
        '/briefs — Current creative challenges',
        '/drop <id> — Details for a specific drop',
        '/stats — Platform statistics',
        '',
        'Or just chat with me — I know about RRG drops, briefs, and how the platform works!',
      ].join('\n');

    case 'drops':
      return await getDropsSummary();

    case 'drop': {
      const id = parseInt(args, 10);
      if (isNaN(id)) return 'Usage: /drop <tokenId> — e.g. /drop 5';
      return await getDropDetail(id);
    }

    case 'brands':
      return await getBrandsSummary();

    case 'briefs':
      return await getBriefsSummary();

    case 'stats':
      return await getPlatformStats();

    default:
      return `Unknown command /${cmd}. Try /help for available commands.`;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function handleUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId    = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  const messageId = msg.message_id;

  // Rate limit
  if (isRateLimited(chatId, isPrivate)) {
    await sendTgMessage(chatId, "I'm taking a breather. Try again in a moment. ☕", messageId);
    return;
  }

  const { command, args, query } = parseCommand(msg);

  let response: string;

  if (command) {
    response = await handleCommand(command, args);
  } else {
    // Free-text → LLM
    response = await callLLM(query, isPrivate);
  }

  await sendTgMessage(chatId, response, messageId);
}

// ── Telegram send helper ──────────────────────────────────────────────────

const RRG_TG_BOT_TOKEN = process.env.RRG_TG_BOT_TOKEN ?? '';

async function sendTgMessage(chatId: number, text: string, replyTo?: number): Promise<void> {
  if (!RRG_TG_BOT_TOKEN) {
    console.warn('[telegram-bot] RRG_TG_BOT_TOKEN not set');
    return;
  }

  // Telegram message limit is 4096 chars
  const truncated = text.slice(0, 4096);

  const resp = await fetch(
    `https://api.telegram.org/bot${RRG_TG_BOT_TOKEN}/sendMessage`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:                     chatId,
        text:                        truncated,
        reply_to_message_id:         replyTo,
        allow_sending_without_reply: true,
      }),
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!resp.ok) {
    console.error('[telegram-bot] sendMessage failed:', resp.status, await resp.text());
  }
}
