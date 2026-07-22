/**
 * POST /api/buyer/credits/deduct  , SECRET-GATED.
 *
 * RRG's concierge chat charges a migrated buyer's LLM usage against VIA's ledger
 * (VIA is the system of record for credits once the RRG balance is drained).
 * RRG computes the USD cost for its own provider and sends it here; VIA deducts
 * exactly that and returns the new balance. Resolves the buyer by
 * linked_rrg_agent_id.
 *
 * Body: { rrg_agent_id, cost_usd, description? }
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { platformSecretOk } from '@/lib/app/platform-secret';
import { deductCreditsUsd, getBalance } from '@/lib/app/buyer-credits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!platformSecretOk(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: { rrg_agent_id?: string; cost_usd?: number; description?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const rrgAgentId = body.rrg_agent_id?.trim() ?? '';
  const costUsd = Number(body.cost_usd);
  if (!rrgAgentId) return NextResponse.json({ error: 'rrg_agent_id required' }, { status: 400 });
  if (!Number.isFinite(costUsd) || costUsd < 0) return NextResponse.json({ error: 'cost_usd must be a non-negative number' }, { status: 400 });

  const { data: buyer } = await db
    .from('app_buyers')
    .select('id')
    .eq('linked_rrg_agent_id', rrgAgentId)
    .maybeSingle();
  if (!buyer) return NextResponse.json({ error: 'not_migrated' }, { status: 404 });

  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim()
    : 'rrg concierge chat';
  const balance = await deductCreditsUsd((buyer as { id: string }).id, costUsd, description);
  return NextResponse.json({ ok: true, balance_usdc: balance }, { headers: { 'cache-control': 'no-store' } });
}
