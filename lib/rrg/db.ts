import { createClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';

// ── Typed DB client (server-side, uses service key) ───────────────────
export const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_KEY ?? 'placeholder-key',
  { auth: { persistSession: false } }
);

// ── Constants ─────────────────────────────────────────────────────────
export const RRG_BRAND_ID = '00000000-0000-4000-8000-000000000001';

// ── Types ─────────────────────────────────────────────────────────────

export type BriefStatus = 'active' | 'closed' | 'archived';
export type SubmissionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'ai_screening'   // awaiting vision model analysis
  | 'ai_rejected'    // auto-rejected by vision model (superadmin can override)
  | 'needs_review';  // brand image flagged, pending superadmin sign-off
export type SubmissionChannel = 'web' | 'api' | 'telegram' | 'bluesky' | 'agent' | 'email';
export type BuyerType = 'human' | 'agent';
export type CreatorType = 'human' | 'agent';
export type RrgNetwork = 'base';
export type BrandStatus = 'pending' | 'active' | 'suspended' | 'archived';
export type DistributionStatus = 'pending' | 'completed' | 'failed';

// ── Network helpers ────────────────────────────────────────────────────

/** Returns the network name — always 'base' (mainnet). */
export function getCurrentNetwork(): RrgNetwork {
  return 'base';
}

// ── Interfaces ────────────────────────────────────────────────────────

export interface RrgBrand {
  id: string;
  created_at: string;
  name: string;
  slug: string;
  description: string | null;
  headline: string | null;
  logo_path: string | null;
  banner_path: string | null;
  website_url: string | null;
  social_links: Record<string, string>;
  contact_email: string;
  wallet_address: string;
  status: BrandStatus;
  tc_accepted_at: string | null;
  tc_version: string | null;
  max_self_listings: number;
  self_listings_used: number;
  created_by: string | null;
  application_text: string | null;
  /** Optional per-brand split override (0-100). Replaces tiered formula when set. */
  brand_pct_override: number | null;
  /** Shopify store domain for Storefront API calls */
  shopify_domain: string | null;
  /** Encrypted Shopify Storefront Access Token */
  shopify_storefront_token_encrypted: string | null;
  /** True if brand has garment sizing — enables size selector UI + sizing guide MCP tool */
  supports_sizing: boolean;
  /** Free-form brand config — includes shipping flat-rate, custom policies, etc. See lib/rrg/shipping.ts for the shipping shape. */
  brand_data: Record<string, unknown> | null;
}

export interface RrgBrief {
  id: string;
  created_at: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  status: BriefStatus;
  is_current: boolean;
  social_caption: string | null;
  response_count: number;
  brand_id: string | null;
}

export type ShippingType = 'included' | 'quote_after_payment';

export interface RrgSubmission {
  id: string;
  created_at: string;
  brief_id: string | null;
  creator_wallet: string;
  creator_email: string | null;
  creator_handle: string | null;
  title: string;
  description: string | null;
  submission_channel: SubmissionChannel;
  status: SubmissionStatus;
  jpeg_storage_path: string;
  jpeg_filename: string;
  jpeg_size_bytes: number;
  additional_files_path: string | null;
  additional_files_size_bytes: number | null;
  token_id: number | null;
  edition_size: number;
  price_usdc: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  approval_notification_sent: boolean;
  ipfs_cid: string | null;
  ipfs_url: string | null;
  creator_bio: string | null;
  network: RrgNetwork;
  brand_id: string | null;
  creator_type: CreatorType;
  world_verified: boolean;
  is_brand_product: boolean;
  // Physical product fields
  is_physical_product: boolean;
  physical_description: string | null;
  physical_images_paths: string[] | null;
  price_includes_tax: boolean;
  price_includes_packing: boolean;
  ecommerce_url: string | null;
  shipping_type: ShippingType | null;
  shipping_included_regions: string[] | null;
  refund_commitment: boolean;
  collection_in_person: string | null;
  trust_behavior_accepted: boolean;
  // Voucher fields
  has_voucher: boolean;
  voucher_template_id: string | null;
  // Vision analysis fields
  ai_screened_at: string | null;
  ai_screen_result: 'pass' | 'fail' | null;
  ai_screen_reason: string | null;
  ai_screen_confidence: 'high' | 'medium' | 'low' | null;
  image_review_flags: string[] | null;
  /** Category key for rrg_brand_sizing lookup (tops, bottoms, skirts, outerwear) */
  sizing_category: string | null;
  /** LLM-enhanced product description (null = not yet generated, uses base description) */
  enhanced_description: string | null;
  /** When enhanced_description was generated */
  enhanced_at: string | null;
  /** Structured extracted attributes (fabric, colors, fit, etc) from vision analysis */
  product_attributes: Record<string, unknown> | null;
  /** True = product subject is dark (show on light card bg). False = light subject (dark card). */
  image_is_dark: boolean | null;
}

export interface RrgPurchase {
  id: string;
  created_at: string;
  submission_id: string;
  token_id: number;
  buyer_wallet: string;
  buyer_email: string | null;
  buyer_type: BuyerType;
  tx_hash: string;
  amount_usdc: string;
  files_delivered: boolean;
  delivery_email: string | null;
  download_token: string | null;
  download_expires_at: string | null;
  mint_status: string;
  payment_method: string;
  network: RrgNetwork;
  brand_id: string | null;
  // Revenue split audit columns
  split_creator_usdc: number | null;
  split_brand_usdc: number | null;
  split_platform_usdc: number | null;
  brand_pct_applied: number | null;
  split_model: string | null;
  // Shipping fields (physical products)
  shipping_name: string | null;
  shipping_address_line1: string | null;
  shipping_address_line2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  shipping_phone: string | null;
  physical_terms_accepted: boolean;
}

export interface RrgDistribution {
  id: string;
  created_at: string;
  purchase_id: string;
  brand_id: string | null;
  total_usdc: number;
  creator_usdc: number;
  brand_usdc: number;
  platform_usdc: number;
  creator_wallet: string | null;
  brand_wallet: string | null;
  split_type: string;
  status: DistributionStatus;
  notes: string | null;
}

// ── Brand helpers ─────────────────────────────────────────────────────

export async function getBrandById(id: string): Promise<RrgBrand | null> {
  const { data } = await db
    .from('rrg_brands')
    .select('*')
    .eq('id', id)
    .single();
  return data ?? null;
}

export async function getBrandBySlug(slug: string): Promise<RrgBrand | null> {
  const { data } = await db
    .from('rrg_brands')
    .select('*')
    .eq('slug', slug)
    .single();
  return data ?? null;
}

export const getAllActiveBrands = unstable_cache(
  async (): Promise<RrgBrand[]> => {
    const { data } = await db
      .from('rrg_brands')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: true });
    return data ?? [];
  },
  ['all-active-brands'],
  { revalidate: 60, tags: ['brands'] },
);

export interface BrandDirectoryItem {
  id: string;
  slug: string;
  name: string;
  headline: string | null;
  logo_path: string | null;
  banner_path: string | null;
  created_at: string;
  product_count: number;
  latest_product_at: string | null;
}

export const getBrandsForDirectory = unstable_cache(
  async (): Promise<BrandDirectoryItem[]> => {
    // Fetch active brands
    const { data: brands } = await db
      .from('rrg_brands')
      .select('id, slug, name, headline, logo_path, banner_path, created_at')
      .eq('status', 'active');

    if (!brands || brands.length === 0) return [];

    // Fetch product stats per brand (approved, visible drops)
    const brandIds = brands.map((b) => b.id);
    const { data: stats } = await db
      .from('rrg_submissions')
      .select('brand_id, approved_at')
      .eq('status', 'approved')
      .eq('hidden', false)
      .in('brand_id', brandIds);

    // Aggregate: count + latest approved_at per brand
    const brandStats = new Map<string, { count: number; latest: string | null }>();
    for (const s of stats ?? []) {
      const existing = brandStats.get(s.brand_id) ?? { count: 0, latest: null };
      existing.count++;
      if (!existing.latest || s.approved_at > existing.latest) {
        existing.latest = s.approved_at;
      }
      brandStats.set(s.brand_id, existing);
    }

    return brands.map((b) => {
      const st = brandStats.get(b.id);
      return {
        id: b.id,
        slug: b.slug,
        name: b.name,
        headline: b.headline,
        logo_path: b.logo_path,
        banner_path: b.banner_path,
        created_at: b.created_at,
        product_count: st?.count ?? 0,
        latest_product_at: st?.latest ?? null,
      };
    });
  },
  ['brands-for-directory'],
  { revalidate: 60, tags: ['brands'] },
);

export async function getAllBrands(): Promise<RrgBrand[]> {
  const { data } = await db
    .from('rrg_brands')
    .select('*')
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function getBrandSalesStats(brandId: string): Promise<{
  totalSales: number;
  totalRevenue: number;
  brandRevenue: number;
  pendingDistributions: number;
}> {
  // Count purchases for this brand
  const { count: totalSales } = await db
    .from('rrg_purchases')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId);

  // Sum revenue from distributions
  const { data: distData } = await db
    .from('rrg_distributions')
    .select('total_usdc, brand_usdc, status')
    .eq('brand_id', brandId);

  let totalRevenue = 0;
  let brandRevenue = 0;
  let pendingDistributions = 0;
  for (const d of distData ?? []) {
    totalRevenue += parseFloat(d.total_usdc ?? '0');
    brandRevenue += parseFloat(d.brand_usdc ?? '0');
    if (d.status === 'pending') pendingDistributions++;
  }

  return {
    totalSales: totalSales ?? 0,
    totalRevenue,
    brandRevenue,
    pendingDistributions,
  };
}

// ── Brief helpers ──────────────────────────────────────────────────────

export async function getBriefById(briefId: string): Promise<RrgBrief | null> {
  const { data } = await db
    .from('rrg_briefs')
    .select('*')
    .eq('id', briefId)
    .single();
  return data ?? null;
}

export async function getCurrentBrief(brandId?: string): Promise<RrgBrief | null> {
  let query = db
    .from('rrg_briefs')
    .select('*')
    .eq('is_current', true)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  if (brandId) {
    query = query.eq('brand_id', brandId);
  }

  const { data } = await query.maybeSingle();
  return data ?? null;
}

export async function getRecentBriefs(limit = 6, brandId?: string): Promise<RrgBrief[]> {
  let query = db
    .from('rrg_briefs')
    .select('*');

  if (brandId) {
    query = query.eq('brand_id', brandId);
  }

  const { data } = await query
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getOpenBriefs(brandId?: string): Promise<RrgBrief[]> {
  let query = db
    .from('rrg_briefs')
    .select('*')
    .eq('status', 'active');

  if (brandId) {
    query = query.eq('brand_id', brandId);
  }

  const { data } = await query
    .order('created_at', { ascending: false });
  return data ?? [];
}

/** Active briefs that haven't expired.
 *  When brandId is provided (brand pages), only returns CURRENT briefs for that brand.
 *  Without brandId (main RRG page), returns all active briefs with current ones first. */
export async function getSubmittableBriefs(brandId?: string): Promise<RrgBrief[]> {
  let query = db
    .from('rrg_briefs')
    .select('*')
    .eq('status', 'active');

  if (brandId) {
    query = query.eq('brand_id', brandId).eq('is_current', true);
  }

  const { data } = await query
    .order('is_current', { ascending: false })
    .order('created_at', { ascending: false });

  if (!data) return [];
  // Filter out expired briefs (ends_at in the past)
  const now = new Date();
  return data.filter(b => !b.ends_at || new Date(b.ends_at) > now);
}

// ── Submission helpers ─────────────────────────────────────────────────

export async function getPendingSubmissions(brandId?: string): Promise<RrgSubmission[]> {
  if (!brandId) {
    // Super-admin: all pending
    const { data } = await db
      .from('rrg_submissions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    return data ?? [];
  }

  // Brand admin: match by brand_id OR by brief belonging to this brand
  const { data: brandBriefIds } = await db
    .from('rrg_briefs')
    .select('id')
    .eq('brand_id', brandId);
  const briefIds = (brandBriefIds ?? []).map((b) => b.id);

  let query = db
    .from('rrg_submissions')
    .select('*')
    .eq('status', 'pending');

  if (briefIds.length > 0) {
    query = query.or(`brand_id.eq.${brandId},brief_id.in.(${briefIds.join(',')})`);
  } else {
    query = query.eq('brand_id', brandId);
  }

  const { data } = await query.order('created_at', { ascending: true });
  return data ?? [];
}

/**
 * Returns submissions needing human review: pending + ai_rejected + needs_review.
 * Used by superadmin and brand admin panels.
 */
export async function getSubmissionsForReview(brandId?: string): Promise<RrgSubmission[]> {
  const reviewStatuses = ['pending', 'ai_rejected', 'needs_review'];

  if (!brandId) {
    const { data } = await db
      .from('rrg_submissions')
      .select('*')
      .in('status', reviewStatuses)
      .order('created_at', { ascending: true });
    return data ?? [];
  }

  const { data: brandBriefIds } = await db
    .from('rrg_briefs')
    .select('id')
    .eq('brand_id', brandId);
  const briefIds = (brandBriefIds ?? []).map((b) => b.id);

  let query = db
    .from('rrg_submissions')
    .select('*')
    .in('status', reviewStatuses);

  if (briefIds.length > 0) {
    query = query.or(`brand_id.eq.${brandId},brief_id.in.(${briefIds.join(',')})`);
  } else {
    query = query.eq('brand_id', brandId);
  }

  const { data } = await query.order('created_at', { ascending: true });
  return data ?? [];
}

/**
 * Brand IDs that are not currently `active` (suspended, archived, etc.).
 * Used to exclude their products from every public surface.
 */
export async function getNonActiveBrandIds(): Promise<string[]> {
  const { data } = await db.from('rrg_brands').select('id').neq('status', 'active');
  return (data ?? []).map((b) => b.id as string);
}

export async function getApprovedDrops(brandId?: string): Promise<RrgSubmission[]> {
  const suspendedIds = brandId ? [] : await getNonActiveBrandIds();

  let query = db
    .from('rrg_submissions')
    .select('*')
    .eq('status', 'approved')
    .eq('network', getCurrentNetwork())
    .eq('hidden', false);

  if (brandId) {
    query = query.eq('brand_id', brandId);
  } else if (suspendedIds.length > 0) {
    query = query.not('brand_id', 'in', `(${suspendedIds.join(',')})`);
  }

  const { data } = await query.order('approved_at', { ascending: false });
  return data ?? [];
}

export async function getApprovedDropsPaginated(
  page: number,
  perPage: number,
  briefId?: string | null,
  brandId?: string,
): Promise<{ drops: RrgSubmission[]; totalCount: number }> {
  const suspendedIds = brandId ? [] : await getNonActiveBrandIds();

  return unstable_cache(
    async () => {
      const offset = (page - 1) * perPage;

      let query = db
        .from('rrg_submissions')
        .select('*', { count: 'exact' })
        .eq('status', 'approved')
        .eq('network', getCurrentNetwork())
        .eq('hidden', false);

      if (briefId) query = query.eq('brief_id', briefId);
      if (brandId) {
        query = query.eq('brand_id', brandId);
      } else if (suspendedIds.length > 0) {
        query = query.not('brand_id', 'in', `(${suspendedIds.join(',')})`);
      }

      const { data, count } = await query
        .order('approved_at', { ascending: false })
        .range(offset, offset + perPage - 1);

      return { drops: data ?? [], totalCount: count ?? 0 };
    },
    [`drops-paginated-${page}-${perPage}-${briefId ?? 'all'}-${brandId ?? 'all'}-sus${suspendedIds.length}`],
    { revalidate: 30, tags: ['drops'] },
  )();
}

export async function getPurchaseCountsByTokenIds(
  tokenIds: number[],
): Promise<Map<number, number>> {
  if (tokenIds.length === 0) return new Map();

  const { data } = await db
    .from('rrg_purchases')
    .select('token_id')
    .in('token_id', tokenIds);

  const counts = new Map<number, number>();
  for (const row of data ?? []) {
    counts.set(row.token_id, (counts.get(row.token_id) ?? 0) + 1);
  }
  return counts;
}

export async function getDropByTokenId(tokenId: number): Promise<RrgSubmission | null> {
  const { data } = await db
    .from('rrg_submissions')
    .select('*')
    .eq('token_id', tokenId)
    .eq('status', 'approved')
    .eq('network', getCurrentNetwork())
    .eq('hidden', false)
    .single();
  return data ?? null;
}

export async function getSubmissionById(id: string): Promise<RrgSubmission | null> {
  const { data } = await db
    .from('rrg_submissions')
    .select('*')
    .eq('id', id)
    .single();
  return data ?? null;
}

// ── Token ID counter ───────────────────────────────────────────────────

export async function claimNextTokenId(): Promise<number> {
  // Atomic increment: read current, update, return claimed value
  const { data: cfg } = await db
    .from('rrg_config')
    .select('value')
    .eq('key', 'next_token_id')
    .single();

  const current = parseInt(cfg?.value ?? '1', 10);
  const next = current + 1;

  await db
    .from('rrg_config')
    .update({ value: String(next), updated_at: new Date().toISOString() })
    .eq('key', 'next_token_id');

  return current;
}

// ── Purchase helpers ───────────────────────────────────────────────────

export async function getPurchaseByTxHash(txHash: string): Promise<RrgPurchase | null> {
  const { data } = await db
    .from('rrg_purchases')
    .select('*')
    .eq('tx_hash', txHash)
    .single();
  return data ?? null;
}

export async function getPurchaseByDownloadToken(token: string): Promise<RrgPurchase | null> {
  const { data } = await db
    .from('rrg_purchases')
    .select('*')
    .eq('download_token', token)
    .single();
  return data ?? null;
}

// ── Contributor helpers ───────────────────────────────────────────────

export interface RrgContributor {
  wallet_address: string;
  creator_type: CreatorType;
  display_name: string | null;
  email: string | null;
  bio: string | null;
  registered_at: string;
  last_active_at: string | null;
  total_submissions: number;
  total_approved: number;
  total_rejected: number;
  total_revenue_usdc: number;
  brands_contributed: string[];
  created_at: string;
  updated_at: string;
}

export async function getAllContributors(): Promise<RrgContributor[]> {
  const { data } = await db
    .from('rrg_contributors')
    .select('*')
    .order('total_submissions', { ascending: false });
  return data ?? [];
}

export async function getContributorByWallet(wallet: string): Promise<RrgContributor | null> {
  const { data } = await db
    .from('rrg_contributors')
    .select('*')
    .eq('wallet_address', wallet.toLowerCase())
    .single();
  return data ?? null;
}

export async function getContributorStats(): Promise<{
  total: number;
  humans: number;
  agents: number;
  totalRevenue: number;
}> {
  const { data } = await db
    .from('rrg_contributors')
    .select('creator_type, total_revenue_usdc');

  let humans = 0;
  let agents = 0;
  let totalRevenue = 0;
  for (const c of data ?? []) {
    if (c.creator_type === 'agent') agents++;
    else humans++;
    totalRevenue += parseFloat(c.total_revenue_usdc ?? '0');
  }
  return { total: humans + agents, humans, agents, totalRevenue };
}

// ── Distribution helpers ──────────────────────────────────────────────

export async function getDistributions(
  status?: DistributionStatus,
  brandId?: string,
): Promise<RrgDistribution[]> {
  let query = db
    .from('rrg_distributions')
    .select('*');

  if (status) {
    query = query.eq('status', status);
  }
  if (brandId) {
    query = query.eq('brand_id', brandId);
  }

  const { data } = await query.order('created_at', { ascending: false });
  return data ?? [];
}

// ── Product variant helpers ──────────────────────────────────────────

export interface RrgProductVariant {
  id: string;
  submission_id: string;
  size: string | null;
  color: string | null;
  shopify_variant_id: string | null;
  cached_stock: number;
  cached_stock_at: string | null;
  sku: string | null;
  price_override: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export async function getVariantsBySubmissionId(submissionId: string): Promise<RrgProductVariant[]> {
  const { data } = await db
    .from('rrg_product_variants')
    .select('*')
    .eq('submission_id', submissionId)
    .order('sort_order', { ascending: true });
  return data ?? [];
}

export async function getVariantsByTokenId(tokenId: number): Promise<RrgProductVariant[]> {
  // Look up submission first, then get variants
  const sub = await getDropByTokenId(tokenId);
  if (!sub) return [];
  return getVariantsBySubmissionId(sub.id);
}

export async function updateVariantStock(
  variantId: string,
  stock: number,
): Promise<void> {
  await db
    .from('rrg_product_variants')
    .update({ cached_stock: stock, cached_stock_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', variantId);
}

// ── Brand sizing helpers ─────────────────────────────────────────────

export interface RrgBrandSizing {
  id: string;
  brand_id: string;
  category: string;
  size_chart: Record<string, unknown>[];
  fit_notes: string | null;
  unit: string;
  source_url: string | null;
  scraped_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getSizingByBrand(brandId: string): Promise<RrgBrandSizing[]> {
  const { data } = await db
    .from('rrg_brand_sizing')
    .select('*')
    .eq('brand_id', brandId)
    .order('category', { ascending: true });
  return data ?? [];
}

export async function getSizingByCategory(brandId: string, category: string): Promise<RrgBrandSizing | null> {
  const { data } = await db
    .from('rrg_brand_sizing')
    .select('*')
    .eq('brand_id', brandId)
    .eq('category', category)
    .maybeSingle();
  return data ?? null;
}
