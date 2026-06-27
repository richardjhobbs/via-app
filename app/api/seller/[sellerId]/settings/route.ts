import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

/** Zero address + the 0x0..00-0x0..ff precompile/sentinel range: valid-format
 *  addresses no one controls. A payout set to one is unmanageable and burns
 *  funds, so reject them the same way registration does. */
const SENTINEL_ADDRESS = /^0x0{38}[0-9a-fA-F]{2}$/;

export const dynamic = 'force-dynamic';

/**
 * GET /api/seller/[sellerId]/settings
 *   Returns the seller row for the admin surface.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const { data, error } = await db
    .from('app_sellers')
    .select('id, slug, name, kind, contact_email, website_url, description, headline, catalog_source, shopify_domain, squarespace_shop_url, source_currency, wallet_address, agent_wallet_address, erc8004_seller_id, erc8004_agent_id, active, created_at, updated_at, purchase_policy')
    .eq('id', sellerId)
    .single();
  if (error || !data) return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
  return NextResponse.json({ seller: data });
}

interface SettingsBody {
  name?:                 string;
  description?:          string | null;
  headline?:             string | null;
  website_url?:          string | null;
  contact_email?:        string;
  catalog_source?:       'shopify' | 'squarespace' | 'csv' | 'services' | null;
  shopify_domain?:       string | null;
  squarespace_shop_url?: string | null;
  source_currency?:      string;
  purchase_policy?:      string | null;
  wallet_address?:       string;
}

/**
 * PATCH /api/seller/[sellerId]/settings
 *   Owner-only update of editable seller profile fields, including
 *   catalog source + storefront connection so existing sellers can
 *   connect or switch their store source after onboarding.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId, 'admin');
  if ('error' in auth) return auth.error;

  let body: SettingsBody;
  try { body = (await req.json()) as SettingsBody; } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.name !== undefined) {
    const t = String(body.name).trim();
    if (t.length < 2 || t.length > 120) return NextResponse.json({ error: 'name must be 2-120 characters' }, { status: 400 });
    updates.name = t;
  }
  if (body.description !== undefined)   updates.description   = body.description === null ? null : String(body.description).trim().slice(0, 4000);
  if (body.headline !== undefined)      updates.headline      = body.headline    === null ? null : String(body.headline).trim().slice(0, 200);
  if (body.website_url !== undefined)   updates.website_url   = body.website_url === null ? null : String(body.website_url).trim().slice(0, 500);
  if (body.contact_email !== undefined) {
    const e = String(body.contact_email).trim().toLowerCase();
    if (!e.includes('@')) return NextResponse.json({ error: 'contact_email must be a valid address' }, { status: 400 });
    updates.contact_email = e;
  }

  // Catalogue source — null-safe so a seller can disconnect a store.
  if (body.catalog_source !== undefined) {
    if (body.catalog_source !== null && !['shopify', 'squarespace', 'csv', 'services'].includes(body.catalog_source)) {
      return NextResponse.json({ error: "catalog_source must be 'shopify', 'squarespace', 'csv', 'services', or null" }, { status: 400 });
    }
    updates.catalog_source = body.catalog_source;
    // If the source is changing to anything other than the storefront kind,
    // clear that storefront's connection field so stale data does not
    // confuse sync flows. Caller can override by sending the field
    // explicitly in the same PATCH.
    if (body.catalog_source !== 'shopify'     && body.shopify_domain       === undefined) updates.shopify_domain       = null;
    if (body.catalog_source !== 'squarespace' && body.squarespace_shop_url === undefined) updates.squarespace_shop_url = null;
  }

  if (body.shopify_domain !== undefined) {
    if (body.shopify_domain === null) {
      updates.shopify_domain = null;
    } else {
      const d = String(body.shopify_domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
        return NextResponse.json({ error: 'shopify_domain must look like your-store.myshopify.com or a custom domain' }, { status: 400 });
      }
      updates.shopify_domain = d;
    }
  }

  if (body.squarespace_shop_url !== undefined) {
    if (body.squarespace_shop_url === null) {
      updates.squarespace_shop_url = null;
    } else {
      const u = String(body.squarespace_shop_url).trim();
      try { new URL(u); } catch {
        return NextResponse.json({ error: 'squarespace_shop_url must be a full URL (https://your-site.com/shop)' }, { status: 400 });
      }
      updates.squarespace_shop_url = u;
    }
  }

  if (body.source_currency !== undefined) {
    const c = String(body.source_currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) {
      return NextResponse.json({ error: 'source_currency must be a 3-letter ISO code (USD, GBP, EUR, …)' }, { status: 400 });
    }
    updates.source_currency = c;
  }

  if (body.purchase_policy !== undefined) {
    updates.purchase_policy = body.purchase_policy === null
      ? null
      : String(body.purchase_policy).trim().slice(0, 2000);
  }

  // Payout wallet — where USDC sales settle. Owner-editable so a store that was
  // registered with a placeholder (or a wallet the operator no longer controls)
  // can be pointed at the real one without re-registering.
  if (body.wallet_address !== undefined) {
    const w = String(body.wallet_address).trim();
    if (!ethers.isAddress(w)) {
      return NextResponse.json({ error: 'payout wallet is not a valid Base/EVM address' }, { status: 400 });
    }
    if (SENTINEL_ADDRESS.test(w)) {
      return NextResponse.json({ error: 'payout wallet must be a real wallet you control, not a placeholder or burn address' }, { status: 400 });
    }
    updates.wallet_address = w.toLowerCase();
  }

  if (Object.keys(updates).length === 1) {
    // only updated_at — nothing to do
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
  }

  const { data, error } = await db
    .from('app_sellers')
    .update(updates)
    .eq('id', sellerId)
    .select('id, slug, name, kind, contact_email, website_url, description, headline, catalog_source, shopify_domain, squarespace_shop_url, source_currency, purchase_policy, wallet_address')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ seller: data });
}
