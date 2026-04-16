/**
 * lib/rrg/brand-telegram-bot.ts
 *
 * Per-brand Telegram Bot — product browsing, size queries, stock checks.
 * Designed to be used by @via_unknownunion_bot (and future brand bots).
 *
 * Each brand bot has its own token (env var) and connects to the brand's
 * data via the same DB helpers used by the per-brand MCP endpoint.
 */

import {
  db,
  getBrandBySlug,
  getApprovedListings,
  getListingByTokenId,
  getVariantsBySubmissionId,
  getSizingByBrand,
  getSizingByCategory,
  getPurchaseCountsByTokenIds,
  type RrgBrand,
} from '@/lib/rrg/db';

// ── Types ────────────────────────────────────────────────────────────

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export interface TgMessage {
  message_id: number;
  from?: { id: number; first_name: string; username?: string; is_bot: boolean };
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
  text?: string;
  entities?: { type: string; offset: number; length: number }[];
  reply_to_message?: TgMessage;
}

// ── Config per brand bot ─────────────────────────────────────────────

interface BrandBotConfig {
  brandSlug: string;
  botUsername: string;
  envTokenKey: string; // env var name for the bot token
  llmSystemPrompt: string;
}

const BRAND_BOTS: Record<string, BrandBotConfig> = {
  'unknown-union': {
    brandSlug: 'unknown-union',
    botUsername: 'via_unknownunion_bot',
    envTokenKey: 'UU_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the Unknown Union Concierge — the official AI shopping assistant for Unknown Union (UU) on Real Real Genuine.

About Unknown Union:
- Narrative-driven streetwear and culture fashion, built around the idea of an "unknown union" that binds humanity across borders
- Sub-brand FO[REIGN] — "Everything is FO[REIGN] until it's [FAM]ILAR"
- Product lines include Seven Society, Elemental Chapter, FO[REIGN], and limited-edition collabs (e.g. Malik Yusef MOON-GLYPH tee)
- Themes touch African-diaspora heritage (Fleetwood Walker, Jackie Robinson references), cultural exchange, and craft

Your role:
- Help shoppers browse UU products, check sizes, and find what's currently in stock
- Answer questions about fabric, fit, construction, styling — use the physical details from the product context (don't invent)
- Guide sizing using the actual size chart (UU universal 0-6 numeric, also aliased to S/M/L/XL/XXL)
- Tell the story behind a product when asked — marry the brand concept with the physical facts

Personality:
- Knowledgeable, grounded, like a well-informed in-store advisor — not pushy
- Concise for Telegram. 2-4 short paragraphs max for free-text chat. Use bullet lists for stock/size checks.
- Never invent products, prices, or stock. If you don't know, say so and point to /products or the storefront.

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/unknown-union) or the specific product page
- For size questions, reference the actual chart — don't guess measurements`,
  },
  'frey-tailored': {
    brandSlug: 'frey-tailored',
    botUsername: 'via_freytailored_bot',
    envTokenKey: 'FREY_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the Frey Concierge — the AI shopping assistant for Frey Tailored on Real Real Genuine.

About Frey Tailored:
- A Hong Kong-based womenswear label specialising in tailoring. Half canvas construction, surgeon's cuffs, satin peak lapels, jetted pockets — Savile Row techniques applied to contemporary feminine silhouettes
- Concept-led collections: Irregular Stripe (AW25-26), Uniformal Dressing (SS25), African Meadow, Beauty & Healing, Valley of Flowers & People
- Signature categories: tailored jackets, waistcoats, trousers, coats, dresses (short/midi/maxi/shirt dresses), skirts, shirts and blouses, suits
- Limited-edition drops alongside core classics; in-house alterations and made-to-order in Hong Kong

Sizing:
- European numeric sizing EU 32-46 (= UK 6-20, US 2-16). Also marked in two-letter aliases (XS-S, S-M, M-L, L-XL)
- Measurements in cm (bust/waist/hip). Always reference the actual chart — don't guess

Your role:
- Help shoppers browse Frey styles, check sizes, and find what's currently in stock
- Answer questions about fabric, construction, fit and styling using the physical details from the product context — don't invent
- Tell the story behind a style when asked — link the collection concept with the construction details

Personality:
- Considered, warm, like a trusted in-store advisor who knows the craft and the fit
- Concise for Telegram. 2-4 short paragraphs max for free-text chat. Use bullet lists for stock/size checks
- Never invent products, prices, or stock. If you don't know, say so and point to /products or the storefront

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/frey-tailored) or the specific product page
- For size questions, reference the actual chart — don't guess measurements`,
  },
};

// ── Rate limiting ────────────────────────────────────────────────────

const rateLimits = new Map<number, { count: number; windowStart: number }>();

function isRateLimited(chatId: number, isPrivate: boolean): boolean {
  const now = Date.now();
  const limit = isPrivate ? 10 : 5;
  const entry = rateLimits.get(chatId);
  if (!entry || now - entry.windowStart > 60_000) {
    rateLimits.set(chatId, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > limit;
}

// ── Relevance check ──────────────────────────────────────────────────

export function isBrandBotRelevant(update: TgUpdate, botUsername: string): boolean {
  const msg = update.message;
  if (!msg?.text) return false;
  if (msg.chat.type === 'private') return true;
  if (msg.entities?.some(e =>
    e.type === 'mention' &&
    msg.text!.slice(e.offset, e.offset + e.length).toLowerCase() === `@${botUsername}`
  )) return true;
  if (msg.entities?.some(e => e.type === 'bot_command')) {
    const cmdText = msg.text!.slice(0, msg.text!.indexOf(' ') > 0 ? msg.text!.indexOf(' ') : undefined);
    if (!cmdText.includes('@') || cmdText.toLowerCase().includes(`@${botUsername}`)) return true;
  }
  if (msg.reply_to_message?.from?.username?.toLowerCase() === botUsername) return true;
  return false;
}

// ── Command parsing ──────────────────────────────────────────────────

function parseCommand(msg: TgMessage): { command: string | null; args: string; query: string } {
  const text = msg.text ?? '';
  const cmdEntity = msg.entities?.find(e => e.type === 'bot_command');
  if (cmdEntity) {
    const raw = text.slice(cmdEntity.offset, cmdEntity.offset + cmdEntity.length);
    const command = raw.split('@')[0].slice(1).toLowerCase();
    const args = text.slice(cmdEntity.offset + cmdEntity.length).trim();
    return { command, args, query: args };
  }
  return { command: null, args: '', query: text.trim() };
}

// ── Knowledge retrieval ──────────────────────────────────────────────

async function getProductsSummary(brand: RrgBrand): Promise<string> {
  const drops = await getApprovedListings(brand.id);
  if (drops.length === 0) return 'No products listed yet.';

  const lines = await Promise.all(drops.slice(0, 15).map(async (d) => {
    const variants = await getVariantsBySubmissionId(d.id);
    const inStockSizes = variants.filter(v => v.cached_stock > 0).map(v => v.size).filter(Boolean);
    const price = parseFloat(d.price_usdc ?? '0').toFixed(2);
    const sizeInfo = inStockSizes.length > 0 ? ` [${inStockSizes.join(', ')}]` : '';
    return `• #${d.token_id} ${d.title} — $${price} USDC${sizeInfo}`;
  }));

  return lines.join('\n');
}

async function getProductDetail(brand: RrgBrand, tokenId: number): Promise<string> {
  const drop = await getListingByTokenId(tokenId);
  if (!drop || drop.brand_id !== brand.id) return `Product #${tokenId} not found.`;

  const variants = await getVariantsBySubmissionId(drop.id);
  const price = parseFloat(drop.price_usdc ?? '0').toFixed(2);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com';

  const sizeLines = variants.map(v => {
    const stock = v.cached_stock > 0 ? `in stock (${v.cached_stock})` : 'OUT OF STOCK';
    return `  ${v.size ?? 'OS'}: ${stock}`;
  });

  return [
    `${drop.title}`,
    `Price: $${price} USDC`,
    drop.description ? drop.description.split('\n')[0].slice(0, 200) : null,
    '',
    'Sizes:',
    ...sizeLines,
    '',
    `View: ${siteUrl}/rrg/drop/${tokenId}`,
    `Shop: ${drop.ecommerce_url ?? ''}`,
  ].filter(l => l !== null).join('\n');
}

async function getSizingSummary(brand: RrgBrand, category?: string): Promise<string> {
  const sizing = category
    ? await getSizingByCategory(brand.id, category).then(s => s ? [s] : [])
    : await getSizingByBrand(brand.id);

  if (sizing.length === 0) return 'No sizing guide available' + (category ? ` for "${category}".` : '.');

  const sections = sizing.map(s => {
    const header = `${s.category.toUpperCase()} (${s.unit})`;
    const rows = (s.size_chart as Record<string, unknown>[]).map(row => {
      const size = (row as Record<string, unknown>).size;
      const measurements = Object.entries(row as Record<string, unknown>)
        .filter(([k]) => k !== 'size')
        .map(([k, v]) => `${k.replace(/_cm|_in/, '')}: ${v}`)
        .join(', ');
      return `  ${size}: ${measurements}`;
    });
    return [header, ...rows, s.fit_notes ? `Fit: ${s.fit_notes}` : ''].filter(Boolean).join('\n');
  });

  return sections.join('\n\n');
}

async function getStockCheck(brand: RrgBrand, query: string): Promise<string> {
  const drops = await getApprovedListings(brand.id);
  // Try to match product by name
  const q = query.toLowerCase();
  const match = drops.find(d => d.title.toLowerCase().includes(q));
  if (!match) return `No product matching "${query}" found. Try /products to see all items.`;

  const variants = await getVariantsBySubmissionId(match.id);
  const lines = variants.map(v => {
    const status = v.cached_stock > 0 ? `${v.cached_stock} in stock` : 'OUT OF STOCK';
    return `  ${v.size ?? 'OS'}: ${status}`;
  });

  return [`${match.title} — Stock:`, ...lines].join('\n');
}

// ── Command handlers ─────────────────────────────────────────────────

async function handleBrandCommand(
  cmd: string,
  args: string,
  brand: RrgBrand,
  config: BrandBotConfig,
): Promise<string> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com';

  switch (cmd) {
    case 'start':
      return [
        `Welcome to ${brand.name}!`,
        brand.headline || '',
        '',
        'Commands:',
        '/products — Browse all products',
        '/product <id> — Product details + stock',
        '/sizes [category] — Sizing guide',
        '/stock <product name> — Check stock',
        '/help — This message',
        '',
        `Or just ask me anything about ${brand.name}!`,
        '',
        `Storefront: ${siteUrl}/brand/${brand.slug}`,
      ].filter(Boolean).join('\n');

    case 'help':
      return [
        `${brand.name} Bot Commands:`,
        '/products — Browse products with prices + available sizes',
        '/product <id> — Full details for a product',
        '/sizes [tops|bottoms|outerwear|skirts] — Sizing guide',
        '/stock <product name> — Check stock by product',
        '',
        `Or just chat — I can help you find the right size and style!`,
      ].join('\n');

    case 'products':
      return await getProductsSummary(brand);

    case 'product': {
      const id = parseInt(args, 10);
      if (isNaN(id)) return 'Usage: /product <tokenId> — e.g. /product 42';
      return await getProductDetail(brand, id);
    }

    case 'sizes':
    case 'sizing':
      return await getSizingSummary(brand, args || undefined);

    case 'stock': {
      if (!args) return 'Usage: /stock <product name> — e.g. /stock rugby shirt';
      return await getStockCheck(brand, args);
    }

    default:
      return `Unknown command /${cmd}. Try /help for available commands.`;
  }
}

// ── LLM fallback ─────────────────────────────────────────────────────

/**
 * Build a rich per-product context block using enhanced_description +
 * product_attributes (agent-ready fields populated by enhance-descriptions.mjs).
 * Falls back gracefully when those fields are null.
 */
async function getAgentReadyProductContext(brand: RrgBrand): Promise<string> {
  const drops = await getApprovedListings(brand.id);
  if (drops.length === 0) return 'No products listed yet.';

  const lines: string[] = [];
  for (const d of drops) {
    const variants = await getVariantsBySubmissionId(d.id);
    const sizes = variants.filter(v => v.size).map(v => `${v.size}${v.cached_stock > 0 ? '' : '(OOS)'}`);
    const price = parseFloat(d.price_usdc ?? '0').toFixed(2);
    const attrs = (d.product_attributes ?? {}) as Record<string, unknown>;

    const block: string[] = [
      `#${d.token_id} ${d.title} — $${price} USDC`,
      d.enhanced_description ? `  Details: ${d.enhanced_description}` : null,
      attrs.fabric_guess ? `  Fabric: ${attrs.fabric_guess}` : null,
      attrs.fit ? `  Fit: ${attrs.fit}` : null,
      attrs.primary_color ? `  Color: ${attrs.primary_color}${Array.isArray(attrs.secondary_colors) && attrs.secondary_colors.length > 0 ? ` (+ ${(attrs.secondary_colors as string[]).join(', ')})` : ''}` : null,
      sizes.length > 0 ? `  Sizes: ${sizes.join(', ')}` : null,
    ].filter((l): l is string => l !== null);

    lines.push(block.join('\n'));
  }
  return lines.join('\n\n');
}

async function callBrandLLM(
  query: string,
  brand: RrgBrand,
  config: BrandBotConfig,
  isPrivate: boolean,
): Promise<string> {
  const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY ?? '';
  if (!TOGETHER_API_KEY) {
    return `Try /products or /sizes for quick info about ${brand.name}!`;
  }

  // Rich context: agent-ready product details (enhanced description + structured attributes) + sizing chart
  const [productCtx, sizing] = await Promise.all([
    getAgentReadyProductContext(brand),
    getSizingSummary(brand),
  ]);

  const context = `PRODUCTS (agent-ready details — fabric, fit, colors, sizes):\n${productCtx}\n\nSIZING CHART:\n${sizing}`;

  const resp = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOGETHER_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: `${config.llmSystemPrompt}\n\n--- LIVE CONTEXT ---\n${context}` },
        { role: 'user', content: query },
      ],
      max_tokens: isPrivate ? 500 : 300,
      temperature: 0.7,
      stop: ['<|eot_id|>'],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) {
    console.error(`[brand-tg-bot] LLM error: ${resp.status}`);
    return `I'm having trouble right now. Try /products or /sizes for quick info!`;
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || `Try /products or /sizes!`;
}

// ── Main handler ─────────────────────────────────────────────────────

export async function handleBrandBotUpdate(
  update: TgUpdate,
  brandSlug: string,
): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const config = BRAND_BOTS[brandSlug];
  if (!config) {
    console.error(`[brand-tg-bot] no config for brand: ${brandSlug}`);
    return;
  }

  const brand = await getBrandBySlug(brandSlug);
  if (!brand) {
    console.error(`[brand-tg-bot] brand not found: ${brandSlug}`);
    return;
  }

  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  const messageId = msg.message_id;

  if (isRateLimited(chatId, isPrivate)) {
    await sendBrandTgMessage(brandSlug, chatId, "Easy there! Try again in a moment.", messageId);
    return;
  }

  const { command, args, query } = parseCommand(msg);
  let response: string;

  if (command) {
    response = await handleBrandCommand(command, args, brand, config);
  } else {
    response = await callBrandLLM(query, brand, config, isPrivate);
  }

  await sendBrandTgMessage(brandSlug, chatId, response, messageId);
}

// ── TG send helper ───────────────────────────────────────────────────

async function sendBrandTgMessage(
  brandSlug: string,
  chatId: number,
  text: string,
  replyTo?: number,
): Promise<void> {
  const config = BRAND_BOTS[brandSlug];
  if (!config) return;

  const token = process.env[config.envTokenKey] ?? '';
  if (!token) {
    console.warn(`[brand-tg-bot] ${config.envTokenKey} not set`);
    return;
  }

  const resp = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4096),
        reply_to_message_id: replyTo,
        allow_sending_without_reply: true,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!resp.ok) {
    console.error(`[brand-tg-bot] sendMessage failed: ${resp.status}`, await resp.text());
  }
}

// Export config for webhook route
export function getBrandBotConfig(brandSlug: string): BrandBotConfig | null {
  return BRAND_BOTS[brandSlug] ?? null;
}
