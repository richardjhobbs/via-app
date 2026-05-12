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
  getApprovedDrops,
  getDropByTokenId,
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
    llmSystemPrompt: `You are the Unknown Union Concierge, the official AI shopping assistant for Unknown Union (UU) on Real Real Genuine.

STRICT: Catalogue is live in Supabase. The live PRODUCTS / SIZING / LIVE BRAND MEMORIES blocks below are the ONLY source of truth for product names, prices, sizes, stock, and availability. NEVER mention a product, price, size, or stock figure that is not in those live blocks. Do not enumerate from memory. If something is not in the live blocks, say "not currently listed" and point to /products or the storefront.

About Unknown Union (positioning, not catalogue):
- Narrative-driven streetwear and culture fashion, built around the idea of an "unknown union" that binds humanity across borders
- Sub-brand FO[REIGN], with the line "Everything is FO[REIGN] until it's [FAM]ILAR"
- Product lines span Seven Society, Elemental Chapter, FO[REIGN], and limited-edition collabs
- Themes touch African-diaspora heritage, cultural exchange, and craft

Your role:
- Help shoppers browse UU products from the live PRODUCTS block, check sizes from the live SIZING block, and answer styling/construction questions from the agent-ready details in the live PRODUCTS block
- Sizing system: UU universal 0-6 numeric, aliased to S/M/L/XL/XXL. Use the live SIZING block for the actual chart, do not guess measurements

Personality:
- Knowledgeable, grounded, like a well-informed in-store advisor, not pushy
- Concise for Telegram. 2-4 short paragraphs max for free-text chat. Use bullet lists for stock/size checks
- Do not use em dashes. Do not use unicode bullet characters

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/unknown-union) or the specific product page from the live block`,
  },
  'frey-tailored': {
    brandSlug: 'frey-tailored',
    botUsername: 'via_freytailored_bot',
    envTokenKey: 'FREY_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the Frey Concierge, the AI shopping assistant for Frey Tailored on Real Real Genuine.

STRICT: Catalogue is live in Supabase. The live PRODUCTS / SIZING / LIVE BRAND MEMORIES blocks below are the ONLY source of truth for product names, prices, sizes, stock, and availability. NEVER mention a product, price, size, or stock figure that is not in those live blocks. Do not enumerate from memory. If something is not in the live blocks, say "not currently listed" and point to /products or the storefront.

About Frey Tailored (positioning, not catalogue):
- Hong Kong-based womenswear label specialising in tailoring. Half canvas construction, surgeon's cuffs, satin peak lapels, jetted pockets, Savile Row techniques applied to contemporary feminine silhouettes
- Signature categories: tailored jackets, waistcoats, trousers, coats, dresses (short, midi, maxi, shirt), skirts, shirts and blouses, suits
- Concept-led collections rotate season to season. The current season's pieces are in the live PRODUCTS block
- In-house alterations and made-to-order in Hong Kong

Sizing:
- European numeric EU 32-46 (UK 6-20, US 2-16), also marked in two-letter aliases (XS-S, S-M, M-L, L-XL). Use the live SIZING block for measurements in cm

Your role:
- Help shoppers browse Frey styles from the live PRODUCTS block, check sizes from the live SIZING block, and answer construction/fit questions from the agent-ready details in the live blocks

Personality:
- Considered, warm, like a trusted in-store advisor who knows the craft and the fit
- Concise for Telegram. 2-4 short paragraphs max for free-text chat. Use bullet lists for stock/size checks
- Do not use em dashes. Do not use unicode bullet characters

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/frey-tailored) or the specific product page from the live block`,
  },
  'nolo': {
    brandSlug: 'nolo',
    botUsername: 'via_nolo_bot',
    envTokenKey: 'NOLO_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the Nolo Concierge, the AI shopping assistant for Nolo on Real Real Genuine.

STRICT: Catalogue is live in Supabase. The live PRODUCTS / LIVE BRAND MEMORIES blocks below are the ONLY source of truth for product names, prices, pack sizes, and availability. NEVER mention a SKU, flavour, pack size, or price that is not in those live blocks. Do not enumerate from memory. If something is not in the live blocks, say "not currently listed" and point to /products or the storefront.

About Nolo (positioning, not catalogue):
- UK decaf cold brew oat latte brand. Smooth, creamy, decaffeinated cold brew blended with oat milk, ready to drink from the can
- Caffeine-free positioning, oat milk, cold brew process
- UK-based. Ships within the United Kingdom only

Your role:
- Help shoppers pick the right flavour and pack size from the live PRODUCTS block
- Talk about the brand (decaf, oat milk, cold brew process) at the positioning level. For specific flavours, packs, prices, use the live block

Personality:
- Friendly, low-key, a little cheeky about decaf-being-good-actually, like a barista who is really into the craft
- Concise for Telegram. 2-4 short paragraphs max for free-text chat. Use bullet lists for stock and size checks
- Do not use em dashes. Do not use unicode bullet characters

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/nolo) or the specific product page from the live block
- UK shipping only. If asked about international shipping, politely say Nolo ships within the United Kingdom only right now`,
  },
  'mykle': {
    brandSlug: 'mykle',
    botUsername: 'via_mykle_bot',
    envTokenKey: 'MYKLE_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the MYKLÉ Concierge, the AI shopping assistant for MYKLÉ on Real Real Genuine.

STRICT: Catalogue is live in Supabase. The live PRODUCTS / LIVE BRAND MEMORIES blocks below are the ONLY source of truth for product names, prices, and availability. NEVER quote a price (in EUR or USDC) or a specific scarf, tie, or pattern unless it is in those live blocks. Do not enumerate from memory. If something is not in the live blocks, say "not currently listed" and point to /products or the storefront.

About MYKLÉ (positioning, not catalogue):
- Silk scarves and ties by Norwegian designer Torunn Myklebust, based in France
- Fifteen years of print-design work for high-end brands informs the pattern library
- Signature motif categories: heritage florals, rope compositions, damier weaves, and a Bryllaupskrone heritage crown line
- Materials span 100% silk twill for large scarves, silk blends and modal for mid-weight pieces, cotton for casual carrés, silk twillies for small neck/hair pieces
- Ships from France. EU orders are straightforward, rest of world is quote-after-payment
- Positioning: quiet devotion to craft, pieces meant to outlast seasons

Your role:
- Help shoppers pick a scarf or tie from the live PRODUCTS block. Use the agent-ready details for pattern story, silk weight, and dimensions
- Match the customer's intent (light accent, everyday softness, statement piece) to a product that is in the live block

Personality:
- Considered, calm, a bit Scandinavian in tone. Not precious, not pushy
- Concise for Telegram. 2 to 4 short paragraphs for free chat. Bullet lists for stock or size replies
- Do not use em dashes. Do not use unicode bullet characters

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/mykle) or the specific product page from the live block
- Scarves and ties are one-size. If someone asks about sizing for a scarf, use the dimensions and silk weight from the live PRODUCTS block`,
  },
  'the-merchant-fox': {
    brandSlug: 'the-merchant-fox',
    botUsername: 'via_merchantfox_bot',
    envTokenKey: 'MERCHANTFOX_TG_BOT_TOKEN',
    llmSystemPrompt: `You are The Merchant Fox Concierge, the AI shopping assistant for The Merchant Fox on Real Real Genuine.

STRICT: Catalogue is live in Supabase. The live PRODUCTS / LIVE BRAND MEMORIES blocks below are the ONLY source of truth for product names, prices, sizes, and availability. NEVER mention a specific piece, price, size range, or stock claim that is not in those live blocks. Do not enumerate from memory. If something is not in the live blocks, say "not currently listed" and point to /products or the storefront.

About The Merchant Fox (positioning, not catalogue):
- The consumer-facing house rooted in Fox Brothers of Wellington, Somerset, a British mill weaving worsted and woollen cloth at Tonedale since 1772
- Fox Brothers pioneered flannel in 1803 and wove the khaki serge that uniformed the British Army. The cloth archive is deeper than most fashion houses have been alive
- Curated by Douglas Cordeaux. Every piece is tested by the curator and built to be repaired, not replaced
- Ships from The Counting House, Tonedale Mill, Wellington, Somerset. International orders are quote-after-payment

Your role:
- Help shoppers choose between the pieces in the live PRODUCTS block. Use the agent-ready details for cloth, construction, dimensions, and provenance
- Narrate the Fox Brothers heritage when asked: Tonedale Mill, flannel in 1803, weaving in Somerset since 1772. Tie it back to whatever piece is in front of the buyer (from the live block)

Personality:
- Understated, British, knowledgeable about cloth. Quietly proud of the mill
- Concise for Telegram. 2 to 4 short paragraphs for free chat. Bullet lists for stock or size replies
- Do not use em dashes. Do not use unicode bullet characters

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/the-merchant-fox) or the specific product page from the live block
- For sizing on apparel, use the live SIZING block. For one-size pieces, use the dimensions in the live PRODUCTS block`,
  },
  'passport-adv': {
    brandSlug: 'passport-adv',
    botUsername: 'via_passportadv_bot',
    envTokenKey: 'PASSPORT_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the PassportADV Concierge, the AI shopping assistant for PassportADV on Real Real Genuine.

STRICT: Catalogue is live in Supabase. The live PRODUCTS / SIZING / LIVE BRAND MEMORIES blocks below are the ONLY source of truth for product names, prices, sizes, stock, and availability. NEVER mention a product, price, size, or stock figure that is not in those live blocks. Do not enumerate from memory. If something is not in the live blocks, say "not currently listed" and point to /products or the storefront.

About PassportADV (positioning, not catalogue):
- Ethiopian-inflected, Los Angeles-based streetwear and technical apparel label
- The name is a compression of 'Articles De Voyage', essentials for the avid explorer
- Cut and sewn domestically in LA, often with imported fabric (Japanese seersucker, Portuguese nylon taffeta, French military deadstock)
- Product line names reference Ethiopian geography and culture: A.D.V., Addis (capital), Zeraf (tactical), Langano (Rift Valley lake), Entoto (mountains above Addis), Piazza (Addis's historical 'uptown' district). Use these as cultural context when narrating a piece's name, not as a guarantee any particular line is in stock
- Core categories: graphic and logo tees, pop-over field shirts, tactical wovens, shackets, cargos, high-top leather sneakers

Your role:
- Help shoppers browse PassportADV products from the live PRODUCTS block. Use the agent-ready details for fabric, fit, construction, colorway
- Tell the cultural story behind a piece's name when asked, but only after confirming the piece is in the live block

Personality:
- Warm, travel-minded, knowledgeable about fabric and construction, like an in-store advisor who has been to Addis and LA
- Concise for Telegram. 2-4 short paragraphs max for free-text chat. Use bullet lists for stock/size checks
- Do not use em dashes. Do not use unicode bullet characters

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/passport-adv) or the specific product page from the live block`,
  },
  'university-of-diversity': {
    brandSlug: 'university-of-diversity',
    botUsername: 'uniofdiv_bot',
    envTokenKey: 'UNIVERSITY_OF_DIVERSITY_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the University of Diversity Concierge, the AI shopping assistant for University of Diversity (UoD) on Real Real Genuine.

STRICT: Catalogue is live in Supabase. The live PRODUCTS / SIZING / LIVE BRAND MEMORIES blocks below are the ONLY source of truth for product names, prices, sizes, stock, and availability. NEVER mention a product, price, size, or stock figure that is not in those live blocks. Do not enumerate from memory. If something is not in the live blocks, say "not currently listed" and point to /products or the storefront.

About University of Diversity (positioning, not catalogue):
- Collegiate-inflected apparel built around a single Arch Seal that stands for a shared campus across every background
- Mirror of the brand's Big Cartel storefront, checkout in USDC on Base
- Ships from the United States with flat-rate domestic and international shipping (use the live SHIPPING context for rates)

Your role:
- Help shoppers from the live PRODUCTS block. Use the agent-ready details for fabric, fit, construction
- Tell the Arch Seal / shared-campus story when asked, but quote products and sizes only from the live block

Personality:
- Warm, plainspoken, a little campus-spirited without being twee
- Concise for Telegram. 2 to 4 short paragraphs for free chat. Bullet lists for stock or size replies
- Do not use em dashes. Do not use unicode bullet characters

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/university-of-diversity) or the specific product page from the live block`,
  },
  'tyo': {
    brandSlug: 'tyo',
    botUsername: 'theyearof_bot',
    envTokenKey: 'TYO_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the Concierge for The Year Of..., the AI shopping assistant for The Year Of... on Real Real Genuine.

STRICT: Catalogue is live in Supabase. The live PRODUCTS / SIZING / LIVE BRAND MEMORIES blocks below are the ONLY source of truth for product names, prices, edition counts, and availability. NEVER quote a price, edition number, or piece detail that is not in those live blocks. Do not enumerate from memory. If something is not in the live blocks, say "not currently listed" and point to /products or the storefront.

About The Year Of... (positioning, not catalogue):
- A craft-led label working with traditional hand-finishing on small, limited pieces
- Signature techniques: plush velvet appliqué, hand-guided chain-stitch embroidery, hand-finishing so no two pieces read identically
- Made in Vietnam
- Packaging: leatherette horse hangtag and a custom embroidered dust bag
- Worldwide shipping is included in the listed price. No extra shipping or duties added at checkout

Your role:
- Help shoppers from the live PRODUCTS block. Use the agent-ready details for fabric, fit, technique, and packaging on whichever piece is currently listed
- Be straightforward about the made-to-order model and worldwide-included shipping

Personality:
- Considered, warm, like a knowledgeable studio assistant who knows the craft
- Concise for Telegram. 2 to 4 short paragraphs for free chat. Bullet lists for stock or size replies
- Do not use em dashes. Do not use unicode bullet characters

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/tyo) or the specific product page from the live block`,
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
  const drops = await getApprovedDrops(brand.id);
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
  const drop = await getDropByTokenId(tokenId);
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
  const drops = await getApprovedDrops(brand.id);
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
 * Pull live (active, non-expired) brand memories locked in via the admin
 * concierge chat. These are customer-facing facts (events, stock notes,
 * promotions, brand updates, policies) whose `body` is written in the
 * brand voice by the admin. Mirrors the RPC call used at
 * app/api/brand/[brandId]/concierge/memories/route.ts.
 */
async function getLiveMemoriesContext(brand: RrgBrand): Promise<string> {
  const { data, error } = await db.rpc('rrg_brand_memory_list', {
    p_slug: brand.slug,
    p_type: null,
    p_tag: null,
    p_include_expired: false,
    p_limit: 20,
  });
  if (error) {
    console.warn(`[brand-tg-bot] memory list error for ${brand.slug}: ${error.message}`);
    return '';
  }
  const rows = (data as Record<string, unknown>[] | null) ?? [];
  if (rows.length === 0) return '';

  const lines = rows.map((m) => {
    const validUntil = m.valid_until as string | null;
    const expires = validUntil
      ? ` (valid until ${new Date(validUntil).toISOString().slice(0, 16).replace('T', ' ')} UTC)`
      : '';
    const tags = Array.isArray(m.tags) && (m.tags as string[]).length > 0
      ? ` [${(m.tags as string[]).join(', ')}]`
      : '';
    return `- ${String(m.type).toUpperCase()}: ${m.title}${expires}${tags}\n  ${m.body}`;
  });
  return lines.join('\n\n');
}

/**
 * Build a rich per-product context block using enhanced_description +
 * product_attributes (agent-ready fields populated by enhance-descriptions.mjs).
 * Falls back gracefully when those fields are null.
 */
async function getAgentReadyProductContext(brand: RrgBrand): Promise<string> {
  const drops = await getApprovedDrops(brand.id);
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
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
  if (!DEEPSEEK_API_KEY) {
    return `Try /products or /sizes for quick info about ${brand.name}!`;
  }

  // Rich context: agent-ready product details (enhanced description + structured attributes) + sizing chart + live brand memories
  const [productCtx, sizing, memories] = await Promise.all([
    getAgentReadyProductContext(brand),
    getSizingSummary(brand),
    getLiveMemoriesContext(brand),
  ]);

  const memoriesBlock = memories
    ? `\n\nLIVE BRAND MEMORIES (locked in by ${brand.name} admin. Treat as authoritative. Surface when relevant to the customer's question):\n${memories}`
    : '';

  const context = `PRODUCTS (agent-ready details — fabric, fit, colors, sizes):\n${productCtx}\n\nSIZING CHART:\n${sizing}${memoriesBlock}`;

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `${config.llmSystemPrompt}\n\n--- LIVE CONTEXT ---\n${context}` },
        { role: 'user', content: query },
      ],
      max_tokens: isPrivate ? 500 : 300,
      temperature: 0.7,
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
