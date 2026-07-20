import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { enrichmentFromMetadata } from '@/lib/app/via-product';
import { productPageUrl, sellerPageUrl } from '@/lib/app/seller-catalog';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/acp/feed: read-only product feed in the OpenAI product feed shape
 * (the discovery feed behind ChatGPT shopping / the Agentic Commerce Protocol).
 *
 * Groundwork only. OpenAI ingests feeds by SFTP push or their push API, not by
 * URL pull, so this endpoint is the canonical snapshot source a future exporter
 * reads from (and lets us validate the mapping today). It is not registered
 * anywhere.
 *
 * Field names follow the flat schema documented at
 * developers.openai.com/commerce/specs/feed (item_id, title, description, url,
 * brand, price "N.NN USD", availability, image_url, seller_name, seller_url,
 * marketplace_seller, is_eligible_search / is_eligible_checkout).
 *
 * Scope: Stage-1 INTEGRATED stores only, the same rule as the per-seller MCP
 * discovery gating (app_sellers.agent_wallet_address non-null). Ingested
 * discovery-only catalogues never appear here. Product rule mirrors
 * lib/app/seller-catalog.ts buyableProducts(): active, not admin-removed,
 * on_chain_status in draft/registered.
 *
 * Discovery only: title, description, price, image. No brief, pitch, offer, or
 * negotiation content, so the x402 paid-door invariant is untouched.
 *
 * Params:
 *   limit  1..1000 (default 500)
 *   offset >= 0
 *   seller optional slug filter
 */

interface SellerRow {
  id: string;
  slug: string;
  name: string;
  shipping: Record<string, unknown> | null;
}

interface ProductRow {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  kind: string | null;
  price_minor: number | null;
  currency: string | null;
  stock: number | null;
  url: string | null;
  image_url: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
}

/** Plain text, whitespace-collapsed, clipped. The feed spec wants plain text. */
function plainClip(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const t = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function gtinFrom(attrs: Record<string, unknown>): string | null {
  const raw = attrs.barcode;
  if (typeof raw !== 'string') return null;
  // Ingested barcodes carry trailing junk ("5012093550923 Includes --"):
  // take the first token and accept it only when it is a clean 8-14 digit code.
  const first = raw.trim().split(/\s+/)[0] ?? '';
  return /^\d{8,14}$/.test(first) ? first : null;
}

function brandFrom(attrs: Record<string, unknown>, sellerName: string): string {
  for (const key of ['brand', 'label', 'artist', 'maker']) {
    const v = attrs[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 70);
  }
  return sellerName.slice(0, 70);
}

/**
 * The `url` column is an uploaded product image for onboarded stores but the
 * SOURCE PAGE for ingested catalogues, so only trust it (or image_url) when it
 * plausibly is an image. The feed spec wants JPEG/PNG.
 */
function imageFrom(p: ProductRow): string | null {
  for (const candidate of [p.image_url, p.url]) {
    if (typeof candidate === 'string' && /^https?:\/\/.+\.(jpe?g|png)(\?.*)?$/i.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** "music/vinyl" -> "Music > Vinyl" (spec taxonomy uses " > " separators). */
function categoryFrom(category: string | null): string | null {
  if (!category) return null;
  return category
    .split('/')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join(' > ');
}

function toFeedItem(p: ProductRow, seller: SellerRow): Record<string, unknown> | null {
  if (typeof p.price_minor !== 'number') return null; // price is required by the spec
  const enr = enrichmentFromMetadata(p.metadata, p.description, p.kind);
  const attrs = enr.attributes ?? {};
  const description = plainClip(enr.agentDescription ?? p.description, 5000);
  if (!description) return null; // description is required by the spec
  const gtin = gtinFrom(attrs);
  const image = imageFrom(p);
  const shipsFrom = (seller.shipping ?? {})['ships_from_country'];
  const secondhand = typeof enr.conditionGrade === 'string' && enr.conditionGrade.length > 0;
  return {
    item_id: p.id,
    title: plainClip(p.title, 150),
    description,
    url: productPageUrl(seller.slug, p.id),
    ...(gtin ? { gtin } : {}),
    brand: brandFrom(attrs, seller.name),
    ...(enr.category ? { product_category: categoryFrom(enr.category) } : {}),
    condition: secondhand ? 'secondhand' : 'new',
    // Prices are held in USDC (6-decimal minor units), pegged 1:1 and emitted
    // as USD, the settlement currency a card buyer actually pays on the
    // product page.
    price: `${(p.price_minor / 1_000_000).toFixed(2)} USD`,
    availability: p.stock === null || p.stock > 0 ? 'in_stock' : 'out_of_stock',
    ...(image ? { image_url: image } : {}),
    is_digital: p.kind === 'digital',
    seller_name: seller.name.slice(0, 70),
    seller_url: sellerPageUrl(seller.slug),
    marketplace_seller: 'VIA',
    ...(typeof shipsFrom === 'string' && shipsFrom ? { store_country: shipsFrom } : {}),
    is_eligible_search: true,
    is_eligible_checkout: false,
    ...(p.updated_at ? { last_updated: p.updated_at } : {}),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 500, 1), 1000);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  const sellerSlug = (url.searchParams.get('seller') || '').trim();

  // Integrated stores only: the store has a platform agent wallet. Same rule
  // as the per-seller MCP's isIntegrated() gate.
  let sellerQuery = db
    .from('app_sellers')
    .select('id, slug, name, shipping')
    .eq('active', true)
    .not('agent_wallet_address', 'is', null);
  if (sellerSlug) sellerQuery = sellerQuery.eq('slug', sellerSlug);
  const sellersRes = await sellerQuery;
  if (sellersRes.error) {
    console.error('[acp-feed] seller query failed:', sellersRes.error);
    return NextResponse.json({ error: 'feed unavailable' }, { status: 500 });
  }
  const sellers = (sellersRes.data ?? []) as SellerRow[];
  const sellerById = new Map(sellers.map((s) => [s.id, s]));
  if (sellers.length === 0) {
    return NextResponse.json({ spec: 'openai-product-feed', count: 0, offset, next_offset: null, items: [] });
  }

  const { data, error } = await db
    .from('app_seller_products')
    .select('id, seller_id, title, description, kind, price_minor, currency, stock, url, image_url, metadata, updated_at')
    .in('seller_id', Array.from(sellerById.keys()))
    .eq('active', true)
    .eq('admin_removed', false)
    .in('on_chain_status', ['draft', 'registered'])
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error('[acp-feed] product query failed:', error);
    return NextResponse.json({ error: 'feed unavailable' }, { status: 500 });
  }

  const rows = (data ?? []) as ProductRow[];
  const items = rows
    .map((p) => {
      const s = sellerById.get(p.seller_id);
      return s ? toFeedItem(p, s) : null;
    })
    .filter((x): x is Record<string, unknown> => x !== null);

  return NextResponse.json(
    {
      spec: 'openai-product-feed',
      spec_ref: 'https://developers.openai.com/commerce/specs/feed',
      generated_at: new Date().toISOString(),
      scope: 'stage_1_integrated_stores_only',
      count: items.length,
      offset,
      next_offset: rows.length === limit ? offset + limit : null,
      items,
    },
    { headers: { 'cache-control': 'public, max-age=300, s-maxage=300' } },
  );
}
