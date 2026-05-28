import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { fetchShopifyProducts, stripHtml, type ShopifyProduct } from '@/lib/shopify/products-json';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface SyncResult {
  synced:  number;
  updated: number;
  skipped: number;
  errors:  string[];
}

/**
 * POST /api/seller/[sellerId]/products/sync-shopify
 *
 * Reads the seller's stored shopify_domain, pulls /products.json (no
 * Shopify auth required — works on any store with a public catalog),
 * and upserts each product into app_seller_products keyed on the
 * (seller_id, external_id) unique index. Imported rows land as drafts
 * (on_chain_status = 'draft') so the seller still explicitly publishes
 * each one on-chain.
 *
 * Mapping (VIA is data-only — images are intentionally not synced):
 *   external_id   = shopify product.id (stringified)
 *   kind          = 'physical' (Shopify catalog is overwhelmingly physical)
 *   title         = shopify product.title
 *   description   = stripHtml(shopify product.body_html), trimmed to 4000
 *   price_minor   = round(first_variant.price * 1_000_000)
 *   stock         = sum of available variants; null if no variants
 *   url           = "https://${domain}/products/${handle}" (buying agents
 *                   follow this if they need the seller's own rendering)
 *   metadata      = { shopify_handle, vendor, product_type, tags, variant_count }
 *   active        = true if at least one variant is available
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const { data: seller, error: sellerErr } = await db
    .from('app_sellers')
    .select('id, slug, shopify_domain')
    .eq('id', sellerId)
    .single();
  if (sellerErr || !seller) {
    return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
  }
  if (!seller.shopify_domain) {
    return NextResponse.json({ error: 'No Shopify domain set on this seller. Add one in onboarding or settings, then retry.' }, { status: 400 });
  }

  const domain = String(seller.shopify_domain).trim();
  if (!/^[a-zA-Z0-9.-]+\.myshopify\.com$/.test(domain) && !/^[a-zA-Z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return NextResponse.json({ error: `Invalid Shopify domain stored: ${domain}` }, { status: 400 });
  }

  let products: ShopifyProduct[];
  try {
    products = await fetchShopifyProducts(domain, 250);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Shopify fetch failed: ${msg}` }, { status: 502 });
  }

  const result: SyncResult = { synced: 0, updated: 0, skipped: 0, errors: [] };

  for (const p of products) {
    try {
      const externalId = String(p.id);
      const firstVariant = p.variants?.[0];
      if (!firstVariant) {
        result.skipped++;
        continue;
      }
      const priceFloat = Number(firstVariant.price ?? '0');
      if (!isFinite(priceFloat) || priceFloat < 0) {
        result.skipped++;
        result.errors.push(`Product ${externalId} (${p.title}) has invalid price: ${firstVariant.price}`);
        continue;
      }
      const priceMinor = Math.round(priceFloat * 1_000_000);
      const totalStock = p.variants.reduce((sum, v) => sum + (v.available ? 1 : 0), 0);
      const anyAvailable = p.variants.some((v) => v.available);
      const description = stripHtml(p.body_html).slice(0, 4000) || null;
      const url = `https://${domain}/products/${p.handle}`;
      const metadata = {
        shopify_handle: p.handle,
        vendor: p.vendor ?? null,
        product_type: p.product_type ?? null,
        tags: p.tags ?? [],
        variant_count: p.variants.length,
      };

      // Check if this external_id already exists for this seller
      const { data: existing } = await db
        .from('app_seller_products')
        .select('id, on_chain_status')
        .eq('seller_id', sellerId)
        .eq('external_id', externalId)
        .maybeSingle();

      if (existing) {
        // Update editable fields only. Don't touch on-chain state, token_id,
        // or active (the seller may have intentionally deactivated).
        const updates: Record<string, unknown> = {
          title:       p.title,
          description,
          url,
          stock:       totalStock,
          metadata,
          updated_at:  new Date().toISOString(),
        };
        // Price is immutable post-registration; only update on drafts.
        if (existing.on_chain_status === 'draft') {
          updates.price_minor = priceMinor;
        }
        const { error } = await db
          .from('app_seller_products')
          .update(updates)
          .eq('id', existing.id);
        if (error) {
          result.errors.push(`Update ${externalId}: ${error.message}`);
        } else {
          result.updated++;
        }
      } else {
        const { error } = await db
          .from('app_seller_products')
          .insert({
            seller_id:   sellerId,
            external_id: externalId,
            kind:        'physical',
            title:       p.title,
            description,
            price_minor: priceMinor,
            currency:    'USDC',
            stock:       totalStock,
            url,
            metadata,
            active:      anyAvailable,
          });
        if (error) {
          result.errors.push(`Insert ${externalId}: ${error.message}`);
        } else {
          result.synced++;
        }
      }
    } catch (e) {
      result.errors.push(`Product ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    domain,
    fetched:  products.length,
    ...result,
  });
}
