import { NextRequest, NextResponse } from 'next/server';
import { getApprovedDrops, getDropByTokenId, getCurrentBrief, getAllActiveBrands, db, getCurrentNetwork, getNonActiveBrandIds } from '@/lib/rrg/db';
import { getRRGReadOnly } from '@/lib/rrg/contract';

export const dynamic = 'force-dynamic';

// Columns the agent tool layer actually consumes. Trimming the projection
// here is what takes the lite response from ~25 MB to a few hundred KB.
const LITE_DROP_COLUMNS = [
  'token_id',
  'title',
  'description',
  'enhanced_description',
  'price_usdc',
  'edition_size',
  'brand_id',
  'drop_type',
  'status',
  'hidden',
  'is_brand_product',
  'jpeg_storage_path',
  'ipfs_image_cid',
  'approved_at',
].join(',');

// GET /api/rrg/drops. Public: all approved drops with on-chain minted counts.
// GET /api/rrg/drops?tokenId=N. Single drop.
// GET /api/rrg/drops?lite=1. Agent-tool path: skip on-chain enrichment AND
//   the heavy media columns, keep only the fields the chat tools project on.
//   Sub-second instead of 30+ s, ~200 KB instead of 25 MB.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tokenIdParam = searchParams.get('tokenId');
    const lite = searchParams.get('lite') === '1';

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
        // Contract not yet deployed or network issue. Return DB data only.
      }

      return NextResponse.json({ drop: { ...drop, onChain } });
    }

    // ── Lite mode for agent tools ────────────────────────────────────
    // No on-chain enrichment, no media-heavy columns, no brands sidecar.
    // The shape mirrors the legacy response (drops[].brand_name / brand_slug)
    // so via-tools-spec keeps working without changes there.
    if (lite) {
      const network = getCurrentNetwork();
      const suspendedIds = await getNonActiveBrandIds();
      const brands = await getAllActiveBrands();
      const brandMap = new Map(brands.map(b => [b.id, { name: b.name, slug: b.slug }]));

      const PAGE_SIZE = 1000;
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        let q = db
          .from('rrg_submissions')
          .select(LITE_DROP_COLUMNS)
          .eq('status', 'approved')
          .eq('network', network)
          .eq('hidden', false);
        if (suspendedIds.length > 0) {
          q = q.not('brand_id', 'in', `(${suspendedIds.join(',')})`);
        }
        const { data, error } = await q
          .order('approved_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...(data as unknown as Record<string, unknown>[]));
        if (data.length < PAGE_SIZE) break;
      }

      const liteDrops = rows.map((drop) => {
        const brandId = drop.brand_id as string | null;
        const brand = brandId ? brandMap.get(brandId) : null;
        return {
          ...drop,
          brand_name: brand?.name ?? null,
          brand_slug: brand?.slug ?? null,
          onChain: null,
        };
      });

      return NextResponse.json({ drops: liteDrops });
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
      // Non-fatal. Still add brand info even without on-chain data.
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
