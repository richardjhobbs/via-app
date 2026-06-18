import { NextRequest, NextResponse } from 'next/server';
import { fetchPostedContent } from '@/lib/app/content-feed';

export const dynamic = 'force-dynamic';

/**
 * GET /api/via/content?limit=
 *
 * Published VIA content posts (Priscilla human-facing, Rosie agent-facing),
 * approved through the admin gate and published to Nostr. The /demand board polls
 * this alongside /api/via/demand and merges both into one social feed.
 */
export async function GET(req: NextRequest) {
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
  const posts = await fetchPostedContent(limit);
  return NextResponse.json({ count: posts.length, posts });
}
