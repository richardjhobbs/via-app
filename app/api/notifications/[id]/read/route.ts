import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { getSellerUser } from '@/lib/app/seller-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/[id]/read
 *
 * Marks a single notification row read. RLS would already block
 * cross-user updates, but we double-check ownership here to keep the
 * service-role client honest.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSellerUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await ctx.params;

  const { data, error } = await db
    .from('app_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_user_id', user.id)
    .is('read_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: data ? 1 : 0 });
}
