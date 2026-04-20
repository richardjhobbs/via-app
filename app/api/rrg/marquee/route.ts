import { NextResponse } from 'next/server';
import { getOpenBriefs, getAllActiveBrands } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Marquee items for the site-wide topbar ticker.
 *
 * Composition, in order of visual appearance on the track:
 *   1. An open brief, if any — "Brief open, {brand}, {title}"
 *   2. "Now admitting founding brands" (fixed)
 *   3. "Your concierge, quietly attentive, agent-ready" (fixed)
 *   4. "A fashion-first commerce platform" (fixed)
 *   5. A random admitted brand — "New admission, {brand}"
 *
 * Any slot that has no data to populate (no open briefs, no brands) is simply
 * dropped so the marquee never renders a placeholder.
 *
 * Cached at the edge for 30 seconds; the client polls on an interval to pick
 * up the rotation (new random brand + next brief in sequence) over time.
 */
export async function GET() {
  const [openBriefs, brands] = await Promise.all([
    getOpenBriefs(),
    getAllActiveBrands(),
  ]);

  const brandMap = new Map(brands.map((b) => [b.id, b]));
  const items: string[] = [];
  const bucket = Math.floor(Date.now() / 30_000);

  // 1. A rotating open brief, if any. Rotate by time-bucket so every client
  //    converges on the same brief within a 30s window.
  let briefBrandId: string | null = null;
  if (openBriefs.length > 0) {
    const brief = openBriefs[bucket % openBriefs.length];
    briefBrandId = brief.brand_id ?? null;
    const brand = briefBrandId ? brandMap.get(briefBrandId) : null;
    const label = brand?.name
      ? `Brief open, ${brand.name}, ${brief.title}`
      : `Brief open, ${brief.title}`;
    items.push(label);
  }

  // 2, 3, 4 — kept verbatim.
  items.push('Now admitting founding brands');
  items.push('Your concierge, quietly attentive, agent-ready');
  items.push('A fashion-first commerce platform');

  // 5. A random admitted brand, rotating on the same 30s bucket. Exclude the
  //    brand that's already featured in the brief slot so the two don't
  //    ever say the same name in the same breath.
  const candidates = brands.filter((b) => b.id !== briefBrandId);
  if (candidates.length > 0) {
    // Offset the brand bucket from the brief bucket so the two never move in
    // lockstep, which would feel mechanical.
    const brand = candidates[(bucket + 7) % candidates.length];
    items.push(`New admission, ${brand.name}`);
  }

  return NextResponse.json(
    { items },
    {
      headers: {
        // Edge-cache for 30s so we don't re-query DB on every page hit.
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    },
  );
}
