import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { getSellerUser } from '@/lib/app/seller-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/read-all
 *
 * Marks every unread row read for the signed-in user. Returns the
 * count of rows affected so the client can clear setAppBadge(0) and
 * the bell badge in one round-trip.
 */
export async function POST(_req: NextRequest) {
  const user = await getSellerUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Seller bell only: never mark the user's buyer-side rows read from here
  // (those carry metadata.buyer_id and surface on the buyer dashboard).
  const { data, error } = await db
    .from('app_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('owner_user_id', user.id)
    .is('metadata->>buyer_id', null)
    .is('read_at', null)
    .select('id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: (data ?? []).length });
}
