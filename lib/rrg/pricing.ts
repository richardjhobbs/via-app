/**
 * lib/rrg/pricing.ts
 *
 * Resolve the effective per-variant price for a purchase.
 *
 * Many brand-mirrored products carry per-size price_override values on
 * rrg_product_variants (e.g. Stadium Goods sneakers where different sizes
 * command different secondary-market prices). The base rrg_submissions.price_usdc
 * stays as the floor / first-variant price; per-size deltas live on the variant
 * row.
 *
 * When a buyer selects a size, checkout needs to charge the override, not the
 * floor. This helper centralises that lookup so every payment path (card,
 * wallet USDC, agent claim) charges consistently.
 *
 * Returns the size-specific price if a variant override exists; otherwise
 * falls back to the base submission price.
 */
import { db } from './db';

export async function resolveEffectivePrice(
  submissionId: string,
  basePriceUsdc: number | string | null | undefined,
  selectedSize?: string | null,
): Promise<number> {
  const base = Number(basePriceUsdc ?? 0);
  if (!selectedSize) return base;

  const { data: variant } = await db
    .from('rrg_product_variants')
    .select('price_override')
    .eq('submission_id', submissionId)
    .eq('size', selectedSize)
    .maybeSingle();

  if (variant?.price_override == null) return base;
  const override = Number(variant.price_override);
  return Number.isFinite(override) && override > 0 ? override : base;
}
