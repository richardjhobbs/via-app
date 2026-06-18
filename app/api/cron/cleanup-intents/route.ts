/**
 * Cleanup cron , permanently deletes briefs that were cancelled more than 24h
 * ago. The 24h grace window lets an owner reinstate a brief they cancelled by
 * mistake; after that it is removed (its matches cascade away via the FK).
 *
 * Secured per Vercel's cron contract: Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}`. Schedule is in vercel.json.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('app_buyer_intents')
    .delete()
    .eq('status', 'cancelled')
    .lt('resolved_at', cutoff)
    .select('id');

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: (data ?? []).length });
}
