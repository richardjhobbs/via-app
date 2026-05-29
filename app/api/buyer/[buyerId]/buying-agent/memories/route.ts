/**
 * GET /api/buyer/[buyerId]/buying-agent/memories
 *
 * Lists current buyer preferences for the training chat sidebar and the
 * read-only preferences surface. Auth: super-admin OR the buyer's owner.
 * Query params:
 *   limit=N  - max rows (default 50, max 200)
 *   type=... - filter by memory type
 *   tag=...  - filter by tag
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/app/auth';
import { getBuyerUser, isBuyerOwner } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;

  const superAdmin = await isAdminFromCookies();
  if (!superAdmin) {
    const user = await getBuyerUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const allowed = await isBuyerOwner(user.id, buyerId);
    if (!allowed) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { data: buyer, error: buyerErr } = await db
    .from('app_buyers')
    .select('handle')
    .eq('id', buyerId)
    .single();
  if (buyerErr || !buyer) {
    return NextResponse.json({ error: 'Buyer not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);
  const type = url.searchParams.get('type');
  const tag = url.searchParams.get('tag');

  const { data, error } = await db.rpc('app_buyer_memory_list', {
    p_handle: buyer.handle,
    p_type: type,
    p_tag: tag,
    p_limit: limit,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memories: data ?? [] });
}
