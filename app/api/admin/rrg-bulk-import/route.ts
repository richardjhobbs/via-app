/**
 * POST /api/admin/rrg-bulk-import  , admin-guarded.
 *
 * Bulk migration of RRG buyer agents into VIA (VIA becomes the single source of
 * buyer agents). Pulls the real buyer list from RRG over the federation channel
 * (GET /api/via/buyers), and for each: provisions the Supabase owner
 * (findOrCreateUser), imports the buyer (importConcierge, idempotent on the now
 * UNIQUE linked_rrg_agent_id), and transfers the prepaid RRG credit balance
 * (inside importConcierge). Idempotent: re-running converges, never double-
 * imports or double-credits.
 *
 * Body (all optional): {
 *   dryRun?: boolean,        // default TRUE, audit only, no writes
 *   limit?: number,          // max agents to process this run (default 25)
 *   rrgAgentId?: string,     // process only this one RRG agent (verification)
 *   includeByo?: boolean     // include BYO-LLM agents (default false)
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isAdminFromCookies } from '@/lib/app/auth';
import { findOrCreateUser } from '@/lib/app/rrg-owner';
import { importConcierge } from '@/lib/app/rrg-concierge-import';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RRG_BASE = (process.env.RRG_BASE_URL || 'https://realrealgenuine.com').replace(/\/$/, '');

interface RrgBuyer {
  id: string; name: string | null; email: string | null; wallet_address: string | null;
  erc8004_agent_id: number | null; credit_balance_usdc: number | null; status: string | null;
  via_buyer_linked: boolean; llm_byo_provider: string | null; created_at: string;
}

async function rrgFetch(path: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${RRG_BASE}${path}`, { headers: { 'x-via-platform-secret': secret }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminFromCookies())) {
    return NextResponse.json({ error: 'admin only' }, { status: 401 });
  }
  const secret = process.env.VIA_PLATFORM_SECRET;
  if (!secret) return NextResponse.json({ error: 'VIA_PLATFORM_SECRET not configured' }, { status: 503 });

  let body: { dryRun?: boolean; limit?: number; rrgAgentId?: string; includeByo?: boolean };
  try { body = await req.json(); } catch { body = {}; }
  const dryRun = body.dryRun !== false; // default true
  const limit = Math.min(Math.max(Number(body.limit ?? 25) || 25, 1), 200);
  const includeByo = body.includeByo === true;
  const onlyId = body.rrgAgentId?.trim() || null;

  // Audit stats (always).
  const stats = await rrgFetch('/api/via/buyers?stats=1', secret);
  if (!stats) return NextResponse.json({ error: 'could not reach RRG for stats' }, { status: 502 });

  // Fetch the batch to process (one page is enough for the first runs).
  const byoParam = includeByo ? '&include_byo=1' : '';
  const page = await rrgFetch(`/api/via/buyers?limit=${limit}${byoParam}`, secret);
  let buyers = ((page?.buyers as RrgBuyer[]) ?? []);
  if (onlyId) buyers = buyers.filter((b) => b.id === onlyId);

  // Which are already linked on VIA?
  const ids = buyers.map((b) => b.id);
  const linked = new Set<string>();
  if (ids.length > 0) {
    const { data: existing } = await db.from('app_buyers').select('linked_rrg_agent_id').in('linked_rrg_agent_id', ids);
    for (const r of (existing ?? []) as { linked_rrg_agent_id: string }[]) linked.add(r.linked_rrg_agent_id);
  }

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      stats,
      batch_size: buyers.length,
      would_create: buyers.filter((b) => !linked.has(b.id) && b.email).length,
      already_linked: buyers.filter((b) => linked.has(b.id)).length,
      missing_email: buyers.filter((b) => !b.email).map((b) => b.id),
      sample: buyers.slice(0, 10).map((b) => ({ id: b.id, name: b.name, email: b.email, credit: b.credit_balance_usdc, linked: linked.has(b.id) })),
    });
  }

  // Execute: serial, small delay, per-agent isolated.
  const results: Array<Record<string, unknown>> = [];
  for (const b of buyers) {
    if (!b.email) { results.push({ id: b.id, skipped: 'no_email' }); continue; }
    if (!b.wallet_address) { results.push({ id: b.id, skipped: 'no_wallet' }); continue; }
    try {
      const ownerUserId = await findOrCreateUser(b.email, b.wallet_address, 'via_bulk_rrg');
      if (!ownerUserId) { results.push({ id: b.id, error: 'owner_provision_failed' }); continue; }
      const r = await importConcierge({ rrgAgentId: b.id, walletAddress: b.wallet_address, displayName: b.name ?? undefined, ownerUserId });
      results.push(r.ok
        ? { id: b.id, ok: true, handle: r.buyer?.handle, already_linked: r.alreadyLinked ?? false }
        : { id: b.id, error: r.error });
    } catch (e) {
      results.push({ id: b.id, error: e instanceof Error ? e.message : 'import threw' });
    }
    await new Promise((res) => setTimeout(res, 400)); // throttle mint + auth-user creation
  }

  return NextResponse.json({
    dry_run: false,
    stats,
    processed: results.length,
    created: results.filter((r) => r.ok && !r.already_linked).length,
    relinked: results.filter((r) => r.ok && r.already_linked).length,
    errors: results.filter((r) => r.error || r.skipped).length,
    results,
  });
}
