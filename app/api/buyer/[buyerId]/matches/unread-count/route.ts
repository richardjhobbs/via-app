/**
 * GET /api/buyer/[buyerId]/matches/unread-count
 *
 * Count of UNSEEN matches (status='new') for this buyer. Drives the flashing
 * new-results dot in the buyer top nav. Cleared when the owner opens the
 * dashboard (which marks new -> seen). Owner-auth, polled client-side.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  const [matches, pitches] = await Promise.all([
    db.from('app_buyer_intent_matches').select('id', { count: 'exact', head: true }).eq('buyer_id', buyerId).eq('status', 'new'),
    db.from('app_buyer_brief_pitches').select('id', { count: 'exact', head: true }).eq('buyer_id', buyerId).eq('status', 'new'),
  ]);
  return NextResponse.json({ count: (matches.count ?? 0) + (pitches.count ?? 0) });
}
