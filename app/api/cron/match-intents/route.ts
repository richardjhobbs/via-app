/**
 * Re-match cron , re-runs every active buying intent against the catalogue so
 * briefs pick up products ingested after the brief was created (the vinyl
 * ingest worker adds rows continuously). Dedup in matchIntent means only
 * genuinely new hits are written.
 *
 * Secured per Vercel's cron contract: Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` when the CRON_SECRET env var is set.
 * Schedule is configured in vercel.json.
 */
import { NextRequest, NextResponse } from 'next/server';
import { matchOpenIntents } from '@/lib/app/buyer-matching';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const result = await matchOpenIntents();
  return NextResponse.json({ ok: true, ...result });
}
