/**
 * Drainer cron , posts queued ERC-8004 reputation signals on-chain, one at a
 * time with sequential deployer nonces (serialized so concurrent door requests
 * never collide on the gas-wallet nonce). The brief door enqueues; this drains.
 *
 * Secured per Vercel's cron contract: `Authorization: Bearer ${CRON_SECRET}`.
 * Schedule is in vercel.json. Also runnable manually with the same header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { drainSignalQueue } from '@/lib/app/erc8004-signal-queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 20, 1), 100);
  const result = await drainSignalQueue(limit);
  return NextResponse.json({ ok: true, ...result });
}
