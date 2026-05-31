import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/via/search?q=<query>&limit=<n>: VIA network search contract.
 *
 * Every VIA member platform exposes this same shape so the network root
 * (www.getvia.xyz/mcp via_find) can fan out across all members and return
 * pointers. Returns sellers as directory entries, not product detail: the
 * catalogue and the buy stay at origin. Each result carries the per-seller
 * mcp_url an agent connects to next.
 */

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

interface SearchResult {
  name: string;
  kind: string;
  detail: string | null;
  mcp_url: string;
  web_url: string | null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 50);

  let query = db
    .from('app_sellers')
    .select('slug, name, kind, headline, description, website_url')
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(limit);

  if (q) {
    const safe = q.replace(/[%,()]/g, ' ').trim();
    const pattern = `%${safe}%`;
    query = query.or(`name.ilike.${pattern},description.ilike.${pattern},headline.ilike.${pattern}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[api/via/search] query failed:', error);
    return NextResponse.json({ platform: 'via', results: [], error: 'search_unavailable' }, { status: 200 });
  }

  const results: SearchResult[] = (data ?? []).map((row) => ({
    name: row.name,
    kind: row.kind || 'seller',
    detail: row.headline || row.description || null,
    mcp_url: `${APP_BASE}/sellers/${encodeURIComponent(row.slug)}/mcp`,
    web_url: row.website_url || `${APP_BASE}/sellers/${encodeURIComponent(row.slug)}`,
  }));

  return NextResponse.json(
    { platform: 'via', results },
    { headers: { 'cache-control': 'public, max-age=30, s-maxage=30' } },
  );
}
