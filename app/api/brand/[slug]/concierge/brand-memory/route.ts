/**
 * GET /api/brand/[slug]/concierge/brand-memory
 *
 * The brand's own live knowledge (events, promotions, policies, stock notes,
 * brand updates) locked in by the owner via the RRG admin concierge chat.
 * Backs the Hermes concierge MCP `search_brand_memory` / `list_brand_memory`
 * tools. Reuses the existing rrg_brand_memory_search / rrg_brand_memory_list
 * RPCs (same ones the in-app brand bot already calls). Read-only.
 *
 * Query: ?q=...            -> search
 *        ?list=1&type=&tag= -> list
 *        limit (default 5 search / 20 list)
 */
import { NextRequest, NextResponse } from 'next/server';
import { isConciergeAuthorized, adminUnauthorized } from '@/lib/rrg/auth';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!(await isConciergeAuthorized(req, slug))) return adminUnauthorized();
  const url = new URL(req.url);

  if (url.searchParams.get('list') === '1') {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
    const { data, error } = await db.rpc('rrg_brand_memory_list', {
      p_slug: slug,
      p_type: url.searchParams.get('type'),
      p_tag: url.searchParams.get('tag'),
      p_include_expired: false,
      p_limit: limit,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ memories: data ?? [] });
  }

  const q = url.searchParams.get('q') ?? '';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '5', 10) || 5, 1), 25);
  const { data, error } = await db.rpc('rrg_brand_memory_search', {
    p_slug: slug,
    p_query: q,
    p_limit: limit,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memories: data ?? [] });
}
