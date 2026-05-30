import { createClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';

// ── Typed DB client (server-side, uses service key) ───────────────────
//
// Placeholder fallbacks exist so `next build` can import this module without
// env vars (e.g. on a CI image). At runtime on the VPS, a missing service key
// or URL means every query silently returns empty , which is how the landing
// page shipped with no brands when `.env.local` wasn't symlinked into the
// standalone output. Log once at module load so the PM2 log shows the
// misconfiguration instead of a quiet empty store.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '[rrg/db] missing Supabase env at module load , NEXT_PUBLIC_SUPABASE_URL=%s SUPABASE_SERVICE_ROLE_KEY=%s. Every query will fail and public surfaces (landing brand grid, /rrg, /brand) will render empty.',
    SUPABASE_URL ? 'set' : 'MISSING',
    SUPABASE_KEY ? 'set' : 'MISSING',
  );
}
export const db = createClient(
  SUPABASE_URL ?? 'https://placeholder.supabase.co',
  SUPABASE_KEY ?? 'placeholder-key',
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
export type CreatorType = 'human' | 'agent';
export type RrgNetwork = 'base';
export type BrandStatus = 'pending' | 'active' | 'suspended' | 'archived';
export type DistributionStatus = 'pending' | 'completed' | 'failed';

// ── Network helpers ────────────────────────────────────────────────────

/** Returns the network name , always 'base' (mainnet). */
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
  /** True if brand has garment sizing , enables size selector UI + sizing guide MCP tool */
  supports_sizing: boolean;
  /** Free-form brand config , includes shipping flat-rate, custom policies, etc. See lib/app/shipping.ts for the shipping shape. */
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

export type ShippingType = 'included' | 'live_rates';

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
  /** True = render in the human storefront grid. False = MCP / agent only.
   *  Distinct from `hidden` (hard kill-switch across every surface).
   *  Default true; admins curate per-brand from /admin. */
  ui_visible: boolean;
}

// ── Brand helpers ─────────────────────────────────────────────────────

export async function getBrandById(id: string): Promise<RrgBrand | null> {
  const { data } = await db
    .from('app_sellers')
    .select('*')
    .eq('id', id)
    .single();
  return data ?? null;
}

export async function getSellerBySlug(slug: string): Promise<RrgBrand | null> {
  const { data } = await db
    .from('app_sellers')
    .select('*')
    .eq('slug', slug)
    .single();
  return data ?? null;
}

export const getAllActiveBrands = unstable_cache(
  async (): Promise<RrgBrand[]> => {
    const { data, error } = await db
      .from('app_sellers')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: true });
    if (error) {
      // Surface DB/env errors rather than silently rendering an empty brand
      // grid on the landing page, /rrg, /brand, etc. The previous behaviour
      // made Supabase outages and bad service-key env look like an empty
      // store, which is exactly how we shipped to prod with no brands.
      console.error('[getAllActiveBrands] supabase query failed:', error);
    }
    return data ?? [];
  },
  ['all-active-brands'],
  { revalidate: 60, tags: ['brands'] },
);

export interface BrandSearchItem {
  slug: string;
  name: string;
  headline: string | null;
}

/** Lightweight index for the nav-bar typeahead. ~100 rows, filtered client-side. */
export const getBrandSearchIndex = unstable_cache(
  async (): Promise<BrandSearchItem[]> => {
    const { data, error } = await db
      .from('app_sellers')
      .select('slug, name, headline')
      .eq('status', 'active')
      .order('name', { ascending: true });
    if (error) {
      console.error('[getBrandSearchIndex] supabase query failed:', error);
    }
    return data ?? [];
  },
  ['brand-search-index'],
  { revalidate: 60, tags: ['brands'] },
);

export interface SellerDirectoryItem {
  id: string;
  slug: string;
  name: string;
  headline: string | null;
  logo_path: string | null;
  banner_path: string | null;
  created_at: string;
  /** Count of approved + non-hidden + ui_visible products. The storefront number. */
  product_count: number;
  /** Count of approved + non-hidden products regardless of ui_visible. The full catalogue agents see via MCP. */
  mcp_product_count: number;
  latest_product_at: string | null;
}

export const getBrandsForDirectory = unstable_cache(
  async (): Promise<SellerDirectoryItem[]> => {
    // Fetch active brands
    const { data: brands, error: brandsError } = await db
      .from('app_sellers')
      .select('id, slug, name, headline, logo_path, banner_path, created_at')
      .eq('status', 'active');

    if (brandsError) {
      console.error('[getBrandsForDirectory] brands query failed:', brandsError);
    }
    if (!brands || brands.length === 0) return [];

    // Aggregate counts via the brand_product_counts() RPC (scripts/008-...sql).
    // Aggregating server-side returns one row per brand, so we never hit
    // PostgREST's 1000-row response cap , that cap previously truncated
    // totalMcpProducts to 1000 once the catalogue grew past 1k rows.
    const sellerIds = brands.map((b) => b.id);
    const { data: stats, error: statsError } = await db.rpc('brand_product_counts', { brand_ids: sellerIds });

    if (statsError) {
      console.error('[getBrandsForDirectory] brand_product_counts RPC failed:', statsError);
    }

    type StatRow = { brand_id: string; ui_count: number; mcp_count: number; latest_approved_at: string | null };
    const brandStats = new Map<string, { ui_count: number; mcp_count: number; latest: string | null }>();
    for (const s of (stats ?? []) as StatRow[]) {
      brandStats.set(s.brand_id, {
        ui_count:  Number(s.ui_count)  || 0,
        mcp_count: Number(s.mcp_count) || 0,
        latest:    s.latest_approved_at,
      });
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
        product_count: st?.ui_count ?? 0,
        mcp_product_count: st?.mcp_count ?? 0,
        latest_product_at: st?.latest ?? null,
      };
    });
  },
  ['brands-for-directory'],
  { revalidate: 60, tags: ['brands'] },
);

export async function getAllBrands(): Promise<RrgBrand[]> {
  const { data } = await db
    .from('app_sellers')
    .select('*')
    .order('created_at', { ascending: false });
  return data ?? [];
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

export async function getCurrentBrief(sellerId?: string): Promise<RrgBrief | null> {
  let query = db
    .from('rrg_briefs')
    .select('*')
    .eq('is_current', true)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  if (sellerId) {
    query = query.eq('brand_id', sellerId);
  }

  const { data } = await query.maybeSingle();
  return data ?? null;
}

export async function getRecentBriefs(limit = 6, sellerId?: string): Promise<RrgBrief[]> {
  let query = db
    .from('rrg_briefs')
    .select('*');

  if (sellerId) {
    query = query.eq('brand_id', sellerId);
  }

  const { data } = await query
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getOpenBriefs(sellerId?: string): Promise<RrgBrief[]> {
  let query = db
    .from('rrg_briefs')
    .select('*')
    .eq('status', 'active');

  if (sellerId) {
    query = query.eq('brand_id', sellerId);
  }

  const { data } = await query
    .order('created_at', { ascending: false });
  return data ?? [];
}

/** Active briefs that haven't expired.
 *  When sellerId is provided (brand pages), only returns CURRENT briefs for that brand.
 *  Without sellerId (main RRG page), returns all active briefs with current ones first. */
export async function getSubmittableBriefs(sellerId?: string): Promise<RrgBrief[]> {
  let query = db
    .from('rrg_briefs')
    .select('*')
    .eq('status', 'active');

  if (sellerId) {
    query = query.eq('brand_id', sellerId).eq('is_current', true);
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

export async function getPendingSubmissions(sellerId?: string): Promise<RrgSubmission[]> {
  if (!sellerId) {
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
    .eq('brand_id', sellerId);
  const briefIds = (brandBriefIds ?? []).map((b) => b.id);

  let query = db
    .from('rrg_submissions')
    .select('*')
    .eq('status', 'pending');

  if (briefIds.length > 0) {
    query = query.or(`brand_id.eq.${sellerId},brief_id.in.(${briefIds.join(',')})`);
  } else {
    query = query.eq('brand_id', sellerId);
  }

  const { data } = await query.order('created_at', { ascending: true });
  return data ?? [];
}

/**
 * Returns submissions needing human review: pending + ai_rejected + needs_review.
 * Used by superadmin and brand admin panels.
 */
export async function getSubmissionsForReview(sellerId?: string): Promise<RrgSubmission[]> {
  const reviewStatuses = ['pending', 'ai_rejected', 'needs_review'];

  if (!sellerId) {
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
    .eq('brand_id', sellerId);
  const briefIds = (brandBriefIds ?? []).map((b) => b.id);

  let query = db
    .from('rrg_submissions')
    .select('*')
    .in('status', reviewStatuses);

  if (briefIds.length > 0) {
    query = query.or(`brand_id.eq.${sellerId},brief_id.in.(${briefIds.join(',')})`);
  } else {
    query = query.eq('brand_id', sellerId);
  }

  const { data } = await query.order('created_at', { ascending: true });
  return data ?? [];
}

/**
 * Brand IDs that are not currently `active` (suspended, archived, etc.).
 * Used to exclude their products from every public surface.
 */
export async function getNonActiveBrandIds(): Promise<string[]> {
  const { data } = await db.from('app_sellers').select('id').neq('status', 'active');
  return (data ?? []).map((b) => b.id as string);
}

export async function getApprovedDrops(sellerId?: string): Promise<RrgSubmission[]> {
  const suspendedIds = sellerId ? [] : await getNonActiveBrandIds();

  // PostgREST caps each request at 1000 rows by default. With the ui_visible
  // expansion some brands (e.g. 13DE MARZO) cleared 1k MCP rows , without
  // chunking, list_drops and get_brand silently truncated to the first 1000.
  // Page through the table in 1000-row chunks until exhausted.
  const PAGE_SIZE = 1000;
  const all: RrgSubmission[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = db
      .from('rrg_submissions')
      .select('*')
      .eq('status', 'approved')
      .eq('network', getCurrentNetwork())
      .eq('hidden', false);

    if (sellerId) {
      query = query.eq('brand_id', sellerId);
    } else if (suspendedIds.length > 0) {
      query = query.not('brand_id', 'in', `(${suspendedIds.join(',')})`);
    }

    const { data } = await query
      .order('approved_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    const chunk = data ?? [];
    all.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * UI-side product list. Filters to ui_visible=true so the storefront grid
 * only shows curated products. For the full agent catalogue, MCP routes
 * use getApprovedDrops / search_products_fts which intentionally do NOT
 * apply the ui_visible filter.
 *
 * Returns:
 *   - drops: paginated rows for this page
 *   - totalCount: storefront-visible count (after ui_visible filter)
 *   - mcpTotalCount: full MCP catalogue count for the same scope (briefId/sellerId)
 *
 * mcpTotalCount lets the storefront render "X visible / Y in MCP catalogue"
 * without a second round-trip from the page component.
 */
export async function getApprovedDropsPaginated(
  page: number,
  perPage: number,
  briefId?: string | null,
  sellerId?: string,
): Promise<{ drops: RrgSubmission[]; totalCount: number; mcpTotalCount: number }> {
  const suspendedIds = sellerId ? [] : await getNonActiveBrandIds();

  return unstable_cache(
    async () => {
      const offset = (page - 1) * perPage;
      const network = getCurrentNetwork();

      // UI page rows: status + network + hidden=false + ui_visible=true
      let pageQuery = db
        .from('rrg_submissions')
        .select('*', { count: 'exact' })
        .eq('status', 'approved')
        .eq('network', network)
        .eq('hidden', false)
        .eq('ui_visible', true);

      // MCP total count for the same scope, no ui_visible filter
      let mcpQuery = db
        .from('rrg_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'approved')
        .eq('network', network)
        .eq('hidden', false);

      if (briefId) {
        pageQuery = pageQuery.eq('brief_id', briefId);
        mcpQuery  = mcpQuery.eq('brief_id', briefId);
      }
      if (sellerId) {
        pageQuery = pageQuery.eq('brand_id', sellerId);
        mcpQuery  = mcpQuery.eq('brand_id', sellerId);
      } else if (suspendedIds.length > 0) {
        pageQuery = pageQuery.not('brand_id', 'in', `(${suspendedIds.join(',')})`);
        mcpQuery  = mcpQuery.not('brand_id', 'in', `(${suspendedIds.join(',')})`);
      }

      const [{ data, count }, { count: mcpCount }] = await Promise.all([
        pageQuery.order('approved_at', { ascending: false }).range(offset, offset + perPage - 1),
        mcpQuery,
      ]);

      return {
        drops: data ?? [],
        totalCount: count ?? 0,
        mcpTotalCount: mcpCount ?? 0,
      };
    },
    [`drops-paginated-${page}-${perPage}-${briefId ?? 'all'}-${sellerId ?? 'all'}-sus${suspendedIds.length}`],
    { revalidate: 30, tags: ['drops'] },
  )();
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

export async function getSizingByBrand(sellerId: string): Promise<RrgBrandSizing[]> {
  const { data } = await db
    .from('rrg_brand_sizing')
    .select('*')
    .eq('brand_id', sellerId)
    .order('category', { ascending: true });
  return data ?? [];
}

export async function getSizingByCategory(sellerId: string, category: string): Promise<RrgBrandSizing | null> {
  const { data } = await db
    .from('rrg_brand_sizing')
    .select('*')
    .eq('brand_id', sellerId)
    .eq('category', category)
    .maybeSingle();
  return data ?? null;
}
