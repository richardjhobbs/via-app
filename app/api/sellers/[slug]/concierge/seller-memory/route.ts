import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isConciergeAuthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sellers/[slug]/concierge/seller-memory
 *
 * Returns active memories for the seller. Calls the Supabase RPC
 * app_seller_memory_list which scopes to the seller's id, filters out
 * expired rows (valid_until > now()), and optionally narrows by type
 * or tag. The Hermes Sales Agent calls this to ground its answers.
 *
 * Query params:
 *   q     optional substring filter on title + body
 *   type  optional memory type ('policy', 'event', 'brand_update', ...)
 *   tag   optional single tag
 *   limit default 100, max 500
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await isConciergeAuthorized(req, slug))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url     = new URL(req.url);
  const q       = url.searchParams.get('q')    ?? undefined;
  const type    = url.searchParams.get('type') ?? undefined;
  const tag     = url.searchParams.get('tag')  ?? undefined;
  const limit   = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 1), 500);

  const { data, error } = await db.rpc('app_seller_memory_list', {
    p_slug:              slug,
    p_type:              type ?? null,
    p_tag:               tag ?? null,
    p_include_expired:   false,
    p_limit:             limit,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = (data ?? []) as Array<{
    id: string; seller_id: string; type: string; title: string; body: string;
    structured: Record<string, unknown>; tags: string[]; valid_until: string | null;
    created_at: string;
  }>;

  if (q && q.trim().length > 0) {
    const needle = q.trim().toLowerCase();
    rows = rows.filter(
      (r) => r.title.toLowerCase().includes(needle) || r.body.toLowerCase().includes(needle),
    );
  }

  return NextResponse.json({ memories: rows });
}
