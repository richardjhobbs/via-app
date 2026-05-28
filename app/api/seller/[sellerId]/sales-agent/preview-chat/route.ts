/**
 * POST /api/seller/[sellerId]/concierge/preview-chat
 *
 * Public brand-concierge preview. Mirrors the bulk-injection pattern from
 * lib/app/brand-telegram-bot.ts callBrandLLM: a single LLM call where the
 * system prompt carries the live PRODUCTS, SIZING, and BRAND MEMORIES the
 * customer-facing concierge needs as authoritative ground truth.
 *
 * No auth: this is a public test surface for asking the brand concierge
 * questions in the brand's own voice on RRG.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  db,
  getApprovedDrops,
  getVariantsBySubmissionId,
  getSizingByBrand,
  type RrgBrand,
} from '@/lib/app/db';

export const dynamic = 'force-dynamic';

interface ChatMessage {
  role:    'user' | 'assistant';
  content: string;
}

interface PreviewBody {
  messages:  ChatMessage[];
  sessionId?: string;
}

// ── System prompt builder ─────────────────────────────────────────────

function buildCustomerSystemPrompt(
  sellerName: string,
  sellerSlug: string,
  voiceBlock: string | null,
  productsBlock: string,
  sizingBlock: string,
  memoriesBlock: string,
): string {
  const voicePara = voiceBlock
    ? `\n\nBrand voice for ${sellerName}, internalise this, do not quote it back to the customer:\n${voiceBlock}`
    : '';
  const storefrontUrl = `https://realrealgenuine.com/brand/${sellerSlug}`;
  const sizingSection = sizingBlock
    ? `\n\nLIVE SIZING (per category, brand authority, do NOT invent measurements):\n${sizingBlock}`
    : '';
  return `You are the ${sellerName} Concierge on Real Real Genuine (RRG), an agentic-commerce platform on Base mainnet built by VIA Labs. RRG is where ${sellerName} reaches a new class of customer: AI agents shopping for their humans, alongside human shoppers using the storefront directly. Your job is to answer questions in ${sellerName}'s own voice, grounded in the live RRG context below.

PLATFORM CONTEXT (always true, every brand on RRG):
- Storefront on RRG: ${storefrontUrl}
- Payment on RRG settles in USDC on Base mainnet (1 USDC = 1 USD); a card checkout option is also available. Prices on RRG are USD-native unless a memory says otherwise.
- Fulfilment is the brand's own: shipping, returns physically, in-store collection. The brand's published shipping and returns policies apply to RRG orders.
- AI agents discover and transact via the per-brand MCP endpoint at ${storefrontUrl}/mcp. Humans use the storefront URL above.

STRICT GROUNDING. The LIVE PRODUCTS, LIVE SIZING, and LIVE BRAND MEMORIES blocks below are the ONLY source of truth for what ${sellerName} sells on RRG today, the brand's policies, fees, sizing, and store details. NEVER mention a product, price, size, colour, or stock figure that is not in those live blocks. Do not enumerate from world knowledge. If a customer asks about an item, colour, or size that is not in the LIVE PRODUCTS block, say "that is not currently listed on RRG" and point them to ${storefrontUrl} or, for items in the broader brand catalogue that the brand carries off-platform, to the brand's own customer-service channels. The customer in front of you might be a human or an AI agent. Either way, answer the question. Do not guess identity.

Two-track escalation:
- Brand-side questions you cannot answer (a stock item not on RRG, a custom request): point to ${sellerName}'s own customer-service channels in the memories.
- RRG-side questions you cannot answer (wallet flow, on-chain proof, the agent MCP details): point to ${storefrontUrl} and offer to flag the question.

Behaviour:
- Lead with the customer's question. Answer concisely in the brand voice.
- When the memories contain a verbatim policy quote on the topic, quote it directly rather than paraphrasing.
- Cite specifics (numbers, fees, timeframes, names) exactly as they appear in the blocks, never approximate.
- Do not use em dashes. Do not use unicode bullet characters.
- Keep replies short: at most 4 short paragraphs for a complex question, often one paragraph is enough.
- Do not narrate ("let me check"). Just answer.
- Never offer to "store" or "remember" anything; that is the admin's job.${voicePara}

LIVE PRODUCTS on RRG for ${sellerName} (the COMPLETE list of what we sell here; everything else is off-platform):
${productsBlock}${sizingSection}

LIVE BRAND MEMORIES (locked in by ${sellerName}; treat as authoritative):
${memoriesBlock || '(none)'}`;
}

// ── Context loaders (mirror lib/app/brand-telegram-bot.ts) ────────────

async function loadMemoriesBlock(sellerSlug: string): Promise<string> {
  const { data, error } = await db.rpc('app_seller_memory_list', {
    p_slug:            sellerSlug,
    p_type:            null,
    p_tag:             null,
    p_include_expired: false,
    p_limit:           60,
  });
  if (error) {
    console.warn(`[preview-chat] memory list error for ${sellerSlug}: ${error.message}`);
    return '';
  }
  const rows = (data as Record<string, unknown>[] | null) ?? [];
  if (rows.length === 0) return '';
  return rows.map((m) => {
    const validUntil = m.valid_until as string | null;
    const expires = validUntil
      ? ` (valid until ${new Date(validUntil).toISOString().slice(0, 16).replace('T', ' ')} UTC)`
      : '';
    const tags = Array.isArray(m.tags) && (m.tags as string[]).length > 0
      ? ` [${(m.tags as string[]).join(', ')}]`
      : '';
    return `- ${String(m.type).toUpperCase()}: ${m.title}${expires}${tags}\n  ${m.body}`;
  }).join('\n\n');
}

async function loadVoiceBlock(sellerSlug: string): Promise<string | null> {
  const { data, error } = await db.rpc('app_seller_memory_list', {
    p_slug:            sellerSlug,
    p_type:            'general',
    p_tag:             'voice:system',
    p_include_expired: false,
    p_limit:           1,
  });
  if (error) return null;
  const row = Array.isArray(data) && data.length > 0 ? (data[0] as Record<string, unknown>) : null;
  const body = row?.body;
  return typeof body === 'string' && body.trim().length > 0 ? body.trim() : null;
}

async function loadProductsBlock(brand: RrgBrand): Promise<string> {
  const drops = await getApprovedDrops(brand.id);
  if (drops.length === 0) return `No products are currently listed on RRG for ${brand.name}.`;

  const lines: string[] = [];
  for (const d of drops) {
    const variants = await getVariantsBySubmissionId(d.id);
    const sizes  = variants.filter(v => v.size ).map(v => `${v.size }${v.cached_stock > 0 ? '' : '(OOS)'}`);
    const colors = Array.from(new Set(variants.map(v => v.color).filter((c): c is string => !!c)));
    const price  = parseFloat(d.price_usdc ?? '0').toFixed(2);
    const attrs  = (d.product_attributes ?? {}) as Record<string, unknown>;

    const block: string[] = [
      `#${d.token_id} ${d.title} - $${price} USDC`,
      d.enhanced_description ? `  Details: ${d.enhanced_description}` : null,
      typeof attrs.fabric_guess === 'string' ? `  Fabric: ${attrs.fabric_guess}` : null,
      typeof attrs.fit === 'string' ? `  Fit: ${attrs.fit}` : null,
      typeof attrs.primary_color === 'string'
        ? `  Color: ${attrs.primary_color}${
            Array.isArray(attrs.secondary_colors) && attrs.secondary_colors.length > 0
              ? ` (+ ${(attrs.secondary_colors as string[]).join(', ')})`
              : ''
          }`
        : null,
      sizes.length  > 0 ? `  Sizes (OOS = out of stock): ${sizes.join(', ')}` : null,
      colors.length > 0 ? `  Colours available: ${colors.join(', ')}` : null,
    ].filter((l): l is string => l !== null);

    lines.push(block.join('\n'));
  }
  return lines.join('\n\n');
}

async function loadSizingBlock(brand: RrgBrand): Promise<string> {
  if (!brand.supports_sizing) return '';
  const charts = await getSizingByBrand(brand.id);
  if (!charts || charts.length === 0) return '';
  return charts.map((c) => {
    const head = `Category: ${c.category} (unit: ${c.unit})`;
    const fit  = c.fit_notes ? `\n  Fit notes: ${c.fit_notes}` : '';
    let chart = '';
    if (Array.isArray(c.size_chart) && c.size_chart.length > 0) {
      const rows = c.size_chart as Record<string, unknown>[];
      const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
      chart = '\n  ' + keys.join(' | ') + '\n  ' +
        rows.map((r) => keys.map((k) => String(r[k] ?? '')).join(' | ')).join('\n  ');
    }
    return `${head}${fit}${chart}`;
  }).join('\n\n');
}

// ── Route handler ──────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;

  const { data: brand, error: brandErr } = await db
    .from('app_sellers')
    .select('*')
    .eq('id', sellerId)
    .single<RrgBrand>();
  if (brandErr || !brand) {
    return NextResponse.json({ error: `Brand not found: ${brandErr?.message ?? ''}` }, { status: 404 });
  }

  let body: PreviewBody;
  try {
    body = (await req.json()) as PreviewBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: '`messages` must be a non-empty array' }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Preview is not configured (missing DEEPSEEK_API_KEY).' }, { status: 503 });
  }

  const [memoriesBlock, voiceBlock, productsBlock, sizingBlock] = await Promise.all([
    loadMemoriesBlock(brand.slug),
    loadVoiceBlock(brand.slug),
    loadProductsBlock(brand),
    loadSizingBlock(brand),
  ]);

  const systemPrompt = buildCustomerSystemPrompt(
    brand.name,
    brand.slug,
    voiceBlock,
    productsBlock,
    sizingBlock,
    memoriesBlock,
  );

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...body.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let reply = '';
  let tokensUsed = 0;
  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:       'deepseek-chat',
        messages:    apiMessages,
        max_tokens:  900,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[preview-chat] deepseek error ${resp.status}: ${errText.slice(0, 200)}`);
      return NextResponse.json({ error: `Upstream LLM error ${resp.status}` }, { status: 502 });
    }
    const data = await resp.json();
    reply = (data?.choices?.[0]?.message?.content as string | undefined)?.trim() ?? '';
    tokensUsed = ((data?.usage?.prompt_tokens as number | undefined) ?? 0)
               + ((data?.usage?.completion_tokens as number | undefined) ?? 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[preview-chat] LLM call failed:', msg);
    return NextResponse.json({ error: `LLM call failed: ${msg}` }, { status: 502 });
  }

  return NextResponse.json({
    reply: reply || '(no reply)',
    tokensUsed,
    memoriesCount: memoriesBlock ? memoriesBlock.split('\n\n').length : 0,
    productsCount: productsBlock.startsWith('No products') ? 0 : productsBlock.split('\n\n').length,
    sizingCharts:  sizingBlock ? sizingBlock.split('\n\n').length : 0,
    voiceBlockUsed: voiceBlock != null,
  });
}
