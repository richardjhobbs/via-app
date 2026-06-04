/**
 * lib/app/seller-catalog.ts
 *
 * Single source of truth for the PUBLIC, buyable view of VIA-app sellers and
 * their catalogue. Used by:
 *   - the public storefront pages (app/sellers/[slug], .../products/[id])
 *   - the network discovery search (app/mcp/route.ts find_seller, /api/via/search)
 *
 * Buyability rule (mirrors the per-seller MCP list_products / buy_product):
 * a product is publicly visible only when the seller is active and the product
 * is active, not admin-removed, and on_chain_status = 'registered'. Draft and
 * removed listings never surface in discovery or on the storefront.
 *
 * Image note: the live data stores the product image in `url` (image_url is
 * null for current rows), so the public image is `image_url ?? url`. The
 * canonical product link is DERIVED (`/sellers/{slug}/products/{id}`), never
 * read from `url`.
 */
import { db } from './db';
import { buildIlikeOr, matchesQuery } from './via-search';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

export function sellerMcpUrl(slug: string): string {
  return `${APP_BASE}/sellers/${encodeURIComponent(slug)}/mcp`;
}
export function sellerPageUrl(slug: string): string {
  return `${APP_BASE}/sellers/${encodeURIComponent(slug)}`;
}
export function productPageUrl(slug: string, productId: string): string {
  return `${APP_BASE}/sellers/${encodeURIComponent(slug)}/products/${encodeURIComponent(productId)}`;
}

export interface PublicSeller {
  slug:             string;
  name:             string;
  kind:             string;
  headline:         string | null;
  description:      string | null;
  website_url:      string | null;
  erc8004_agent_id: string | null;
  page_url:         string;
  mcp_url:          string;
}

export interface ProductMcpRef {
  seller_mcp_url: string;
  product_id:     string;
  token_id:       number | null;
  pricing_mode:   string;
}

export interface PublicProduct {
  product_id:   string;
  seller_slug:  string;
  seller_name:  string;
  title:        string;
  description:  string | null;
  kind:         string | null;
  /** USDC. For configurable products this is the "from" base price. */
  price_usdc:   number | null;
  price_is_from: boolean;
  currency:     string;
  pricing_mode: string;
  stock:        number | null;
  image_url:    string | null;
  token_id:     number | null;
  product_url:  string;
  mcp_ref:      ProductMcpRef;
}

interface SellerRow {
  id:               string;
  slug:             string;
  name:             string;
  kind:             string | null;
  headline:         string | null;
  description:      string | null;
  website_url:      string | null;
  erc8004_agent_id: string | null;
}

interface ProductRow {
  id:           string;
  seller_id:    string;
  title:        string;
  description:  string | null;
  kind:         string | null;
  price_minor:  number | null;
  currency:     string | null;
  stock:        number | null;
  url:          string | null;
  image_url:    string | null;
  token_id:     number | null;
  pricing_mode: string | null;
}

const SELLER_PUBLIC_COLS = 'id, slug, name, kind, headline, description, website_url, erc8004_agent_id';
const PRODUCT_PUBLIC_COLS = 'id, seller_id, title, description, kind, price_minor, currency, stock, url, image_url, token_id, pricing_mode';

function toPublicSeller(row: SellerRow): PublicSeller {
  return {
    slug:             row.slug,
    name:             row.name,
    kind:             row.kind || 'seller',
    headline:         row.headline,
    description:      row.description,
    website_url:      row.website_url,
    erc8004_agent_id: row.erc8004_agent_id,
    page_url:         sellerPageUrl(row.slug),
    mcp_url:          sellerMcpUrl(row.slug),
  };
}

function toPublicProduct(p: ProductRow, seller: { slug: string; name: string }): PublicProduct {
  const mode = p.pricing_mode || 'fixed';
  const priceUsdc = typeof p.price_minor === 'number' ? p.price_minor / 1_000_000 : null;
  return {
    product_id:    p.id,
    seller_slug:   seller.slug,
    seller_name:   seller.name,
    title:         p.title,
    description:   p.description,
    kind:          p.kind,
    price_usdc:    priceUsdc,
    price_is_from: mode === 'configurable',
    currency:      p.currency || 'USDC',
    pricing_mode:  mode,
    stock:         typeof p.stock === 'number' ? p.stock : null,
    image_url:     p.image_url || p.url || null,
    token_id:      p.token_id ?? null,
    product_url:   productPageUrl(seller.slug, p.id),
    mcp_ref: {
      seller_mcp_url: sellerMcpUrl(seller.slug),
      product_id:     p.id,
      token_id:       p.token_id ?? null,
      pricing_mode:   mode,
    },
  };
}

/** A buyable product is active, not admin-removed, and on-chain registered. */
function buyableProducts() {
  return db
    .from('app_seller_products')
    .select(PRODUCT_PUBLIC_COLS)
    .eq('active', true)
    .eq('admin_removed', false)
    .eq('on_chain_status', 'registered');
}

export async function getPublicSeller(slug: string): Promise<PublicSeller | null> {
  const { data, error } = await db
    .from('app_sellers')
    .select(SELLER_PUBLIC_COLS)
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  return toPublicSeller(data as SellerRow);
}

export async function listStorefront(slug: string): Promise<{ seller: PublicSeller; products: PublicProduct[] } | null> {
  const sellerRes = await db
    .from('app_sellers')
    .select(SELLER_PUBLIC_COLS)
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();
  if (sellerRes.error || !sellerRes.data) return null;
  const sellerRow = sellerRes.data as SellerRow;

  const { data, error } = await buyableProducts()
    .eq('seller_id', sellerRow.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) console.error('[seller-catalog] listStorefront products failed:', error);
  const products = ((data ?? []) as ProductRow[]).map((p) =>
    toPublicProduct(p, { slug: sellerRow.slug, name: sellerRow.name }),
  );
  return { seller: toPublicSeller(sellerRow), products };
}

export async function getPublicProduct(slug: string, productId: string): Promise<{ seller: PublicSeller; product: PublicProduct } | null> {
  const seller = await getSellerRow(slug);
  if (!seller) return null;
  const { data, error } = await buyableProducts()
    .eq('seller_id', seller.id)
    .eq('id', productId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    seller: toPublicSeller(seller),
    product: toPublicProduct(data as ProductRow, { slug: seller.slug, name: seller.name }),
  };
}

async function getSellerRow(slug: string): Promise<SellerRow | null> {
  const { data, error } = await db
    .from('app_sellers')
    .select(SELLER_PUBLIC_COLS)
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  return data as SellerRow;
}

/**
 * Seller-scoped drill-in: one seller's buyable products, matching q if given
 * (relevance-filtered) or the whole catalogue otherwise. Backs the network
 * root's get_seller_products so an agent can answer "X at seller Y".
 */
export async function searchSellerCatalog(slug: string, q: string, max: number): Promise<{ seller: PublicSeller; products: PublicProduct[] } | null> {
  const seller = await getSellerRow(slug);
  if (!seller) return null;
  const productOr = q ? buildIlikeOr(['title', 'description'], q) : null;
  let query = buyableProducts().eq('seller_id', seller.id).order('created_at', { ascending: false });
  query = productOr ? query.or(productOr).limit(200) : query.limit(max);
  const { data, error } = await query;
  if (error) console.error('[seller-catalog] searchSellerCatalog failed:', error);
  let rows = (data ?? []) as ProductRow[];
  if (q) rows = rows.filter((p) => matchesQuery(`${p.title} ${p.description ?? ''}`, q));
  const products = rows.slice(0, max).map((p) => toPublicProduct(p, { slug: seller.slug, name: seller.name }));
  return { seller: toPublicSeller(seller), products };
}

/**
 * Discovery search across the VIA-app catalogue. Matches product text
 * (title/description) AND seller text (name/headline/description), returning
 * product-level results plus any seller-level matches that had no product hit.
 * Product results carry a human product_url and an MCP ref for the agent.
 */
export async function searchCatalog(q: string, max: number): Promise<{ products: PublicProduct[]; sellers: PublicSeller[] }> {
  const productOr = buildIlikeOr(['title', 'description'], q);
  const sellerOr = buildIlikeOr(['name', 'description', 'headline'], q);

  const [productHit, sellerHit] = await Promise.all([
    productOr
      ? buyableProducts().or(productOr).limit(Math.min(max * 4, 200))
      : Promise.resolve({ data: [] as ProductRow[], error: null }),
    sellerOr
      ? db.from('app_sellers').select(SELLER_PUBLIC_COLS).eq('active', true).or(sellerOr).order('name').limit(max)
      : Promise.resolve({ data: [] as SellerRow[], error: null }),
  ]);

  if (productHit.error) console.error('[seller-catalog] searchCatalog product match failed:', productHit.error);
  if (sellerHit.error)  console.error('[seller-catalog] searchCatalog seller match failed:', sellerHit.error);

  // The ilike OR is recall; keep rows relevant by query-token coverage
  // (min(tokens,2)) so "unicorn slippers" does not match a book that merely
  // says "unicorn", while "raw denim jean" still keeps denim+jean matches.
  const productRows = ((productHit.data ?? []) as ProductRow[])
    .filter((p) => matchesQuery(`${p.title} ${p.description ?? ''}`, q));
  const sellerRows = ((sellerHit.data ?? []) as SellerRow[])
    .filter((s) => matchesQuery(`${s.name} ${s.headline ?? ''} ${s.description ?? ''}`, q));

  // Resolve product rows to their active sellers.
  const sellerIds = Array.from(new Set(productRows.map((p) => p.seller_id))).filter(Boolean);
  const sellerById = new Map<string, SellerRow>();
  for (const s of sellerRows) sellerById.set(s.id, s);
  const unresolved = sellerIds.filter((id) => !sellerById.has(id));
  if (unresolved.length > 0) {
    const { data } = await db.from('app_sellers').select(SELLER_PUBLIC_COLS).eq('active', true).in('id', unresolved);
    for (const s of (data ?? []) as SellerRow[]) sellerById.set(s.id, s);
  }

  const products: PublicProduct[] = [];
  const sellersWithProductHit = new Set<string>();
  for (const p of productRows) {
    const s = sellerById.get(p.seller_id);
    if (!s) continue; // seller inactive / missing: skip
    sellersWithProductHit.add(s.slug);
    products.push(toPublicProduct(p, { slug: s.slug, name: s.name }));
    if (products.length >= max) break;
  }

  // Seller-level matches that did not already surface via a product hit.
  const sellers: PublicSeller[] = sellerRows
    .filter((s) => !sellersWithProductHit.has(s.slug))
    .map(toPublicSeller);

  return { products, sellers };
}
