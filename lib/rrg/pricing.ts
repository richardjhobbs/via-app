/**
 * lib/rrg/pricing.ts
 *
 * Resolve the effective per-variant price for a purchase.
 *
 * Many brand-mirrored products carry per-variant price_override values on
 * rrg_product_variants (e.g. Stadium Goods sneakers where different sizes
 * command different secondary-market prices, or future colour-keyed
 * specials). The base rrg_submissions.price_usdc stays as the floor /
 * first-variant price; per-variant deltas live on the variant row.
 *
 * When a buyer selects a (size, colour) combination, checkout needs to
 * charge the override that matches both axes, not the floor. This helper
 * centralises that lookup so every payment path (card, wallet USDC,
 * agent claim) charges consistently.
 *
 * Returns the variant-specific price if a row matches the selection AND
 * carries an override; otherwise falls back to the base submission price.
 */
import { db } from './db';

export async function resolveEffectivePrice(
  submissionId: string,
  basePriceUsdc: number | string | null | undefined,
  selectedSize?: string | null,
  selectedColor?: string | null,
): Promise<number> {
  const base = Number(basePriceUsdc ?? 0);
  if (!selectedSize && !selectedColor) return base;

  let q = db
    .from('rrg_product_variants')
    .select('price_override')
    .eq('submission_id', submissionId);
  if (selectedSize)  q = q.eq('size',  selectedSize);
  if (selectedColor) q = q.eq('color', selectedColor);

  const { data: variant } = await q.maybeSingle();

  if (variant?.price_override == null) return base;
  const override = Number(variant.price_override);
  return Number.isFinite(override) && override > 0 ? override : base;
}
