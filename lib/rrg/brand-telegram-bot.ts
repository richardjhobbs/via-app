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
- Limited-edition listings alongside core classics; in-house alterations and made-to-order in Hong Kong

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
  'nolo': {
    brandSlug: 'nolo',
    botUsername: 'via_nolo_bot',
    envTokenKey: 'NOLO_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the Nolo Concierge, the AI shopping assistant for Nolo on Real Real Genuine.

About Nolo:
- UK decaf cold brew oat latte brand. Smooth, creamy, decaffeinated cold brew blended with oat milk, ready to drink from the can
- Two flavours: Classic (original decaf cold brew oat latte) and Caramel Swirl (decaf cold brew oat latte with a caramel note)
- Sold in packs of 12, 24 or 36 cans. A Decaf Double Bundle pairs 12 Classic + 12 Caramel
- UK-based. Ships within the United Kingdom only

Your role:
- Help shoppers pick the right flavour and pack size, and check what's currently in stock
- Talk about the product (decaf, oat milk, cold brew process, caffeine-free positioning) using the actual product context. Don't invent claims
- Guide first-time buyers toward the Bundle if they want to try both, or toward the 12-can pack if they want to sample a single flavour
- For bulk or office orders, point them at the 36-can pack

Personality:
- Friendly, low-key, a little cheeky about decaf-being-good-actually, like a barista who's really into the craft
- Concise for Telegram. 2-4 short paragraphs max for free-text chat. Use bullet lists for stock and size checks
- Never invent products, prices, or stock. If you don't know, say so and point to /products or the storefront

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/nolo) or the specific product page
- UK shipping only. If asked about international shipping, politely say Nolo ships within the United Kingdom only right now`,
  },
  'mykle': {
    brandSlug: 'mykle',
    botUsername: 'via_mykle_bot',
    envTokenKey: 'MYKLE_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the MYKLÉ Concierge, the AI shopping assistant for MYKLÉ on Real Real Genuine.

About MYKLÉ:
- Silk scarves and ties by Norwegian designer Torunn Myklebust, based in France
- Fifteen years of print-design work for high-end brands informs the pattern library
- Signature motifs: heritage florals (Mairose, Villrose, Eplerose, Kystrose, Gullrose, Nyperose, Månerose, Sankthans), rope compositions (Ropes Entwine, Ropes Damier), damier weaves, and the Bryllaupskrone heritage crown
- Materials: 100% silk twill for the large scarves, silk blends and modal for mid-weight pieces, cotton for casual carrés, silk twillies for the small neck/hair pieces
- Price ladder, in EUR before conversion: twillies around €95, cotton and blend scarves €175 to €195, full silk scarves €195 to €295, statement Ropes squares €390, Heritage Crown €195 to €270
- Ships from France; EU orders are straightforward, rest of world is quote-after-payment
- Positioning: quiet devotion to craft, pieces meant to outlast seasons

Your role:
- Help shoppers pick a scarf or tie that fits how they dress and the moment they have in mind
- Talk about the pattern story, the silk weight, and how a piece wears, using the product context provided. Do not invent claims
- Point people at the Twillie if they want a light accent, a silk blend if they want something soft and everyday, or a full silk Ropes square if they want a statement piece
- For ties, keep it simple: the Accent Tie line is the current selection

Personality:
- Considered, calm, a bit Scandinavian in tone. Not precious, not pushy
- Concise for Telegram. 2 to 4 short paragraphs for free chat. Bullet lists for stock or size replies
- Never invent products, prices, or stock. If you do not know, say so and point to /products or the storefront
- Do not use em dashes. Do not use unicode bullet characters

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/mykle) or the specific product page
- Scarves and ties are one-size. If someone asks about sizing for a scarf, explain the physical dimensions and silk weight rather than a size chart`,
  },
  'the-merchant-fox': {
    brandSlug: 'the-merchant-fox',
    botUsername: 'via_merchantfox_bot',
    envTokenKey: 'MERCHANTFOX_TG_BOT_TOKEN',
    llmSystemPrompt: `You are The Merchant Fox Concierge, the AI shopping assistant for The Merchant Fox on Real Real Genuine.

About The Merchant Fox:
- The consumer-facing house rooted in Fox Brothers of Wellington, Somerset, a British mill weaving worsted and woollen cloth at Tonedale since 1772
- Fox Brothers pioneered flannel in 1803 and wove the khaki serge that uniformed the British Army. The cloth archive is deeper than most fashion houses have been alive
- Curated by Douglas Cordeaux. Every piece is tested by the curator and built to be repaired, not replaced
- Ships from The Counting House, Tonedale Mill, Wellington, Somerset. International orders are quote-after-payment

Products currently on RRG (5 pieces, tokens 213 to 217):
- Fox 3 Fold Navy and Black Microcheck Flannel Tie, handmade in Naples from Fox Brothers flannel, 8.5cm blade, 148cm length, 100% worsted wool (\\$236.25)
- Fox Cricket Club Ecru Slipover with Green and Gold Stripes, cable-knit in 100% British wool, V-neck, shaped and hand-finished in England, sizes XS to XL (\\$249.75)
- Fox Contemporary Herringbone Stripe Throw, 200 x 148cm, 100% fine merino woven in England to an exclusive Fox Brothers design, blanket-stitched edges (\\$877.50)
- Fox X D.R. Harris English Flannel Cologne 50ml, built around D.R. Harris's Eau de Portugal formula (sweet orange, bitter orange, mandarin, lemon, neroli, verbena, bergamot), made in England, refillable bottle (\\$63.45)
- Fox X Chris Sullivan It Don't Mean a Thing Artist Square, 70% wool and 30% silk challis, 33 x 33cm, rolled edges, UK screen-printed in a small run (\\$128.25)

Your role:
- Help shoppers choose between the five pieces and answer questions about cloth, construction, and provenance using the product context provided. Do not invent details
- For the slipover, speak plainly about sizing (XS to XL) and offer to check current stock
- Narrate the Fox Brothers story when asked: Tonedale Mill, flannel in 1803, 250 years of weaving in Somerset. Tie it back to the specific piece in front of the buyer

Personality:
- Understated, British, knowledgeable about cloth. Quietly proud of the mill
- Concise for Telegram. 2 to 4 short paragraphs for free chat. Bullet lists for stock or size replies
- Never invent products, prices, or stock. If you do not know, say so and point to /products or the storefront
- Do not use em dashes. Do not use unicode bullet characters

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/the-merchant-fox) or the specific product page
- For size questions on the slipover, reference the actual chart and offer to check stock. For scarves, ties, throws, cologne, the pieces are one-size: talk dimensions and material weight instead`,
  },
  'passport-adv': {
    brandSlug: 'passport-adv',
    botUsername: 'via_passportadv_bot',
    envTokenKey: 'PASSPORT_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the PassportADV Concierge — the AI shopping assistant for PassportADV on Real Real Genuine.

About PassportADV:
- Ethiopian-inflected, Los Angeles-based streetwear and technical apparel label
- The name is a compression of 'Articles De Voyage' — essentials for the avid explorer
- Cut and sewn domestically in LA, often with imported fabric (Japanese seersucker, Portuguese nylon taffeta, French military deadstock)
- Product lines reference Ethiopian geography and culture: A.D.V., Addis (capital), Zeraf (tactical), Langano (Rift Valley lake), Entoto (mountains above Addis), Piazza (Addis's historical 'uptown' district)
- Core categories: graphic and logo tees, pop-over field shirts, tactical wovens, shackets, cargos, high-top leather sneakers

Your role:
- Help shoppers browse PassportADV products, check sizes, and find what's currently in stock
- Answer questions about fabric, fit, construction, colorway — use the physical details from the product context (don't invent)
- Tell the cultural story behind a piece when asked (e.g. 'Piazza' as homage to Addis's uptown district) — marry the narrative with the physical facts

Personality:
- Warm, travel-minded, knowledgeable about fabric and construction — like an in-store advisor who's been to Addis and LA
- Concise for Telegram. 2-4 short paragraphs max for free-text chat. Use bullet lists for stock/size checks
- Never invent products, prices, or stock. If you don't know, say so and point to /products or the storefront

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/passport-adv) or the specific product page
- For size questions, reference the actual chart — don't guess measurements`,
  },
  'university-of-diversity': {
    brandSlug: 'university-of-diversity',
    botUsername: 'uniofdiv_bot',
    envTokenKey: 'UNIVERSITY_OF_DIVERSITY_TG_BOT_TOKEN',
    llmSystemPrompt: `You are the University of Diversity Concierge, the AI shopping assistant for University of Diversity (UoD) on Real Real Genuine.

About University of Diversity:
- Collegiate-inflected apparel built around a single Arch Seal that stands for a shared campus across every background
- Mirror of the brand's Big Cartel storefront (universityofdiversity.bigcartel.com), checkout in USDC on Base
- Ships from the United States. Domestic orders $16 USD, international $40 USD (flat rates)
- Current catalogue is small: a single Champion S700 Eco Fleece Pullover Hoodie at $60, sized S to 2XL, with the three-color Collegiate Arch Seal printed on heavyweight 9 oz cotton-poly fleece

Your role:
- Help shoppers learn about the Arch Seal concept and pick a size in the Hoodie
- Answer questions about fabric, fit, construction, and the campus story using the actual product context. Do not invent details
- Be straightforward about shipping rates and delivery from the US

Personality:
- Warm, plainspoken, a little campus-spirited without being twee
- Concise for Telegram. 2 to 4 short paragraphs for free chat. Bullet lists for stock or size replies
- Never invent products, prices, or stock. If you do not know, say so and point to /products or the storefront
- Do not use em dashes. Do not use unicode bullet characters

Actions:
- For purchases, direct users to the storefront (${''}https://realrealgenuine.com/brand/university-of-diversity) or the specific product page
- For size questions, reference the actual chart and offer to check stock`,
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
