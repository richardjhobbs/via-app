/**
 * POST /api/rrg/admin/agent-notifications/scan
 *
 * Cron entry point for the drop-match watcher. Scans newly-approved drops
 * against each pro-tier agent's brand + style memory and writes
 * match_found notifications.
 *
 * Auth: CRON_SECRET via `x-cron-secret` header, or ADMIN_SECRET via
 * `x-admin-secret`, or admin cookie. Mirrors auto-scan.
 *
 * Query params:
 *   hours_back     (default 24)  look-back window for "newly approved"
 *   per_agent_limit (default 5)  cap notifications per agent per scan
 *
 * Example cron call:
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     https://realrealgenuine.com/api/rrg/admin/agent-notifications/scan
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/rrg/auth';
import { runDropMatchScan } from '@/lib/agent/notification-watcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function checkAuth(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header =
      req.headers.get('x-cron-secret') ||
      req.headers.get('authorization')?.replace('Bearer ', '');
    if (header === cronSecret) return true;
  }
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = req.headers.get('x-admin-secret');
  if (adminSecret && adminHeader === adminSecret) return true;
  return isAdminFromCookies();
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const hoursBack = Number(url.searchParams.get('hours_back') ?? '24');
  const perAgentLimit = Number(url.searchParams.get('per_agent_limit') ?? '5');

  const started = Date.now();
  const result = await runDropMatchScan({
    hoursBack: Number.isFinite(hoursBack) ? hoursBack : 24,
    perAgentLimit: Number.isFinite(perAgentLimit) ? perAgentLimit : 5,
  });

  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - started,
    ...result,
  });
}
