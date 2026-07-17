import { NextResponse } from 'next/server';
import { getWireEvents } from '@/lib/app/wire';

/**
 * GET /api/via/wire , the public read-only network activity stream that powers
 * The Wire page and any embedded ticker. No auth; anonymised teasers + on-chain
 * settlement/offer events only. `?limit=N` (1..100, default 50).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100);
  const events = await getWireEvents(limit);
  return NextResponse.json(
    { events, count: events.length },
    {
      headers: {
        // Cross-origin readable so brands can fetch the stream for their own
        // embedded slice; the data is already fully public.
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
      },
    },
  );
}
