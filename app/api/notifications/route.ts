import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { getSellerUser } from '@/lib/app/seller-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications
 *
 * Returns the unread count plus the 25 most-recent notification rows
 * for the signed-in user. The dashboard NotificationBell polls this
 * every 30s and pushes `unread` into navigator.setAppBadge() on
 * installed PWAs.
 *
 * Auth: reuses the seller-auth (sb-access-token) cookie. Buyers will
 * share this endpoint in Stage 2 because notifications are scoped by
 * owner_user_id, which is set the same way for both roles.
 */
export async function GET(_req: NextRequest) {
  const user = await getSellerUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const [{ count: unread }, { data: recent, error }] = await Promise.all([
    db.from('app_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', user.id)
      .is('read_at', null),
    db.from('app_notifications')
      .select('id, kind, title, body, link, metadata, created_at, read_at')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(25),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    unread: unread ?? 0,
    recent: recent ?? [],
  });
}
