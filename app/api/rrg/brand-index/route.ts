import { NextResponse } from 'next/server';
import { getBrandSearchIndex } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Lightweight brand index for the nav-bar typeahead. ~100 rows, fetched once
 * per client on mount, filtered locally.
 */
export async function GET() {
  const brands = await getBrandSearchIndex();
  return NextResponse.json(
    { brands },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
