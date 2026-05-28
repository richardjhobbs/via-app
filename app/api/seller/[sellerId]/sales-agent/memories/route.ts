/**
 * GET /api/seller/[sellerId]/concierge/memories
 *
 * Lists current brand memories for the admin chat sidebar.
 * Auth: super-admin OR brand admin for this brand (same gate as chat).
 * Query params:
 *   include_expired=true  - include expired/inactive entries
 *   limit=N                - max rows (default 50, max 200)
 *   type=...               - filter by memory type
 *   tag=...                - filter by tag
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/app/auth';
import { getSellerUser, isBrandAdmin } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;

  const superAdmin = await isAdminFromCookies();
  if (!superAdmin) {
    const user = await getSellerUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const allowed = await isBrandAdmin(user.id, sellerId);
    if (!allowed) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { data: brand, error: brandErr } = await db
    .from('app_sellers')
    .select('slug')
    .eq('id', sellerId)
    .single();
  if (brandErr || !brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const includeExpired = url.searchParams.get('include_expired') === 'true';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);
  const type = url.searchParams.get('type');
  const tag = url.searchParams.get('tag');

  const { data, error } = await db.rpc('app_seller_memory_list', {
    p_slug: brand.slug,
    p_type: type,
    p_tag: tag,
    p_include_expired: includeExpired,
    p_limit: limit,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memories: data ?? [] });
}
