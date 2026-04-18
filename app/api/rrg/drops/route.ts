import { NextRequest, NextResponse } from 'next/server';
import { getApprovedDrops, getDropByTokenId, getCurrentBrief, getAllActiveBrands } from '@/lib/rrg/db';
import { getRRGReadOnly } from '@/lib/rrg/contract';

export const dynamic = 'force-dynamic';

// GET /api/rrg/drops — public: all approved drops with on-chain minted counts
// GET /api/rrg/drops?tokenId=N — single drop
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tokenIdParam = searchParams.get('tokenId');

    if (tokenIdParam) {
      // Single drop
      const tokenId = parseInt(tokenIdParam, 10);
      if (isNaN(tokenId)) {
        return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 });
      }

      const drop = await getDropByTokenId(tokenId);
      if (!drop) {
        return NextResponse.json({ error: 'Drop not found' }, { status: 404 });
      }

      // Fetch live on-chain data
      let onChain = null;
      try {
        const contract = getRRGReadOnly();
        const data     = await contract.getDrop(tokenId);
        onChain = {
          minted:    Number(data.minted),
          maxSupply: Number(data.maxSupply),
          active:    data.active,
          soldOut:   Number(data.minted) >= Number(data.maxSupply),
        };
      } catch {
        // Contract not yet deployed or network issue — return DB data only
      }

      return NextResponse.json({ drop: { ...drop, onChain } });
    }

    // All drops + brands for enrichment
    const [drops, brief, brands] = await Promise.all([
      getApprovedDrops(),
      getCurrentBrief(),
      getAllActiveBrands(),
    ]);

    // Brand lookup map
    const brandMap = new Map(brands.map(b => [b.id, { name: b.name, slug: b.slug }]));

    // Optionally enrich with on-chain minted counts
    let enriched = drops;
    try {
      const contract = getRRGReadOnly();

      enriched = await Promise.all(
        drops.map(async (drop) => {
          const brand = drop.brand_id ? brandMap.get(drop.brand_id) : null;
          const base = { ...drop, brand_name: brand?.name ?? null, brand_slug: brand?.slug ?? null };
          if (!drop.token_id) return { ...base, onChain: null };
          try {
            const data = await contract.getDrop(drop.token_id);
            return {
              ...base,
              onChain: {
                minted:    Number(data.minted),
                maxSupply: Number(data.maxSupply),
                active:    data.active,
                soldOut:   Number(data.minted) >= Number(data.maxSupply),
              },
            };
          } catch {
            return { ...base, onChain: null };
          }
        })
      );
    } catch {
      // Non-fatal — still add brand info even without on-chain data
      enriched = drops.map(drop => {
        const brand = drop.brand_id ? brandMap.get(drop.brand_id) : null;
        return { ...drop, brand_name: brand?.name ?? null, brand_slug: brand?.slug ?? null, onChain: null };
      });
    }

    // Include brand list for agent discovery
    const brandList = brands.map(b => ({ name: b.name, slug: b.slug, description: b.description, headline: b.headline }));

    return NextResponse.json({ drops: enriched, currentBrief: brief, brands: brandList });
  } catch (err) {
    console.error('[/api/rrg/drops]', err);
    return NextResponse.json({ error: 'Failed to fetch drops' }, { status: 500 });
  }
}
