/**
 * lib/app/catalog-import.ts
 *
 * Shared mapping logic for catalogue sync endpoints (Shopify, Squarespace).
 *
 * Takes a normalised ShopifyProduct[] (the Squarespace helper produces
 * the same shape), an FX rate from getUsdcRate(), and upserts each row
 * into app_seller_products keyed on (seller_id, external_id) so
 * re-syncs update in place. Inserted rows land as on_chain_status='draft'
 * — the seller still explicitly publishes each on-chain.
 *
 * VIA is data-only: images are not synced, not stored, not surfaced.
 * See feedback_via_is_data_not_images.md.
 */

import type { ShopifyProduct } from '../shopify/products-json';
import { stripHtml } from '../shopify/products-json';
import { priceToUsdcMinor, type UsdcRate } from './fx';
import { db } from './db';

export type CatalogSource = 'shopify' | 'squarespace' | 'csv';

export interface SyncResult {
  source:   CatalogSource;
  fetched:  number;
  synced:   number;
  updated:  number;
  skipped:  number;
  errors:   string[];
  fx:       UsdcRate;
}

export interface MapperOptions {
  sellerId:        string;
  source:          CatalogSource;
  /** Used to construct `url` for the seller's storefront product page. */
  productUrlFor:   (product: ShopifyProduct) => string | null;
  /** Source for the Shopify product.id namespace prefix in external_id. */
  externalIdPrefix?: string;
  /**
   * Per-row stock count. Returns the row's stock or null for unlimited.
   * Implementations vary by source — Shopify counts available variants,
   * Squarespace sums qtyInStock, CSV passes the per-row stock cell.
   */
  totalStockFor:   (product: ShopifyProduct) => number | null;
  /**
   * Optional per-row kind override. CSV ingestion supplies a kind
   * column (physical/digital/service); Shopify + Squarespace pin to
   * 'physical' by default.
   */
  kindFor?:        (product: ShopifyProduct) => 'physical' | 'digital' | 'service';
  /** Source for the FX rate applied to native prices. */
  fx:              UsdcRate;
}

export async function importCatalog(
  products: ShopifyProduct[],
  opts: MapperOptions,
): Promise<SyncResult> {
  const result: SyncResult = {
    source:  opts.source,
    fetched: products.length,
    synced:  0,
    updated: 0,
    skipped: 0,
    errors:  [],
    fx:      opts.fx,
  };

  for (const p of products) {
    try {
      const externalId = `${opts.externalIdPrefix ?? opts.source}:${p.id || p.handle}`;
      const firstVariant = p.variants?.[0];
      if (!firstVariant) {
        result.skipped++;
        continue;
      }
      const nativePrice = Number(firstVariant.price ?? '0');
      if (!Number.isFinite(nativePrice) || nativePrice < 0) {
        result.skipped++;
        result.errors.push(`Product ${externalId} (${p.title}) has invalid native price: ${firstVariant.price}`);
        continue;
      }
      const priceMinor = priceToUsdcMinor(nativePrice, opts.fx.rate);
      const totalStock = opts.totalStockFor(p);
      const anyAvailable = p.variants.some((v) => v.available);
      const description = stripHtml(p.body_html).slice(0, 4000) || null;
      const url = opts.productUrlFor(p);
      const metadata: Record<string, unknown> = {
        source:        opts.source,
        handle:        p.handle,
        vendor:        p.vendor ?? null,
        product_type:  p.product_type ?? null,
        tags:          p.tags ?? [],
        variant_count: p.variants.length,
        fx_note:       opts.fx.note,
        native_price:  nativePrice,
      };

      const { data: existing } = await db
        .from('app_seller_products')
        .select('id, on_chain_status')
        .eq('seller_id', opts.sellerId)
        .eq('external_id', externalId)
        .maybeSingle();

      const kind = opts.kindFor?.(p) ?? 'physical';

      if (existing) {
        const updates: Record<string, unknown> = {
          title:       p.title,
          description,
          url,
          stock:       totalStock,
          metadata,
          updated_at:  new Date().toISOString(),
        };
        // Price is immutable post-registration; only update drafts.
        if (existing.on_chain_status === 'draft') {
          updates.price_minor = priceMinor;
          updates.kind = kind;
        }
        const { error } = await db
          .from('app_seller_products')
          .update(updates)
          .eq('id', existing.id);
        if (error) result.errors.push(`Update ${externalId}: ${error.message}`);
        else       result.updated++;
      } else {
        const { error } = await db
          .from('app_seller_products')
          .insert({
            seller_id:   opts.sellerId,
            external_id: externalId,
            kind,
            title:       p.title,
            description,
            price_minor: priceMinor,
            currency:    'USDC',
            stock:       totalStock,
            url,
            metadata,
            active:      anyAvailable,
          });
        if (error) result.errors.push(`Insert ${externalId}: ${error.message}`);
        else       result.synced++;
      }
    } catch (e) {
      result.errors.push(`Product ${p.id || p.handle}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

// ── Per-source totalStock helpers ─────────────────────────────────────

/**
 * Shopify /products.json exposes only `available: boolean` per variant.
 * Best-effort stock = count of available variants. If a product has no
 * variants, returns null (unlimited).
 */
export function shopifyTotalStock(p: ShopifyProduct): number | null {
  if (!p.variants || p.variants.length === 0) return null;
  return p.variants.reduce((sum, v) => sum + (v.available ? 1 : 0), 0);
}

/**
 * Squarespace exposes qtyInStock + unlimited per variant. Treat unlimited
 * as null (so MCP list_products / get_product return null = no cap).
 */
export function squarespaceTotalStock(
  p: ShopifyProduct,
  rawStockFor: (variantIndex: number) => number,
): number | null {
  if (!p.variants || p.variants.length === 0) return null;
  let sum = 0;
  let anyUnlimited = false;
  for (let i = 0; i < p.variants.length; i++) {
    const s = rawStockFor(i);
    if (s >= Number.MAX_SAFE_INTEGER) {
      anyUnlimited = true;
      break;
    }
    sum += s;
  }
  return anyUnlimited ? null : sum;
}
