/**
 * Sync cron , keeps each VIA buyer linked from an RRG concierge up to date as
 * the RRG concierge keeps learning. Pulls persona + memories from RRG over HTTP
 * and upserts them idempotently (by external id), so a re-run never duplicates.
 *
 * No LLM spend here , this is a plain copy of already-extracted memories, so
 * unlike the match-intents cron it does NOT gate on buyer credits.
 *
 * Secured per Vercel's cron contract: `Authorization: Bearer ${CRON_SECRET}`.
 * Schedule is configured in vercel.json.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { syncConciergeMemories } from '@/lib/app/rrg-concierge-import';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_PER_RUN = 200;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { data: linked, error } = await db
    .from('app_buyers')
    .select('id, handle, linked_rrg_agent_id')
    .not('linked_rrg_agent_id', 'is', null)
    .limit(MAX_PER_RUN);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let inserted = 0;
  let updated = 0;
  let synced = 0;
  let unreachable = 0;
  let failed = 0;

  for (const b of (linked ?? []) as Array<{ id: string; handle: string; linked_rrg_agent_id: string }>) {
    try {
      const res = await syncConciergeMemories(b.id, b.linked_rrg_agent_id);
      if (res === null) { unreachable++; continue; }
      synced++;
      inserted += res.inserted;
      updated += res.updated;
    } catch (e) {
      failed++;
      console.error(`[sync-rrg-memories] failed handle=${b.handle}:`, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({
    ok: true,
    buyers: (linked ?? []).length,
    synced,
    unreachable,
    failed,
    inserted,
    updated,
  });
}
