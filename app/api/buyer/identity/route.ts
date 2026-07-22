/**
 * GET /api/buyer/identity?rrg_agent_id=<id>  , SECRET-GATED.
 *
 * The canonical buyer record for an agent that was migrated from RRG. RRG's
 * concierge chat reads this to run against VIA's identity + credit balance
 * instead of its own (now-drained) agent_agents row (the phased-coexistence
 * model: VIA is the system of record, RRG keeps the chat surface). Symmetric to
 * RRG's own /api/via/identity. Resolves by linked_rrg_agent_id.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { platformSecretOk } from '@/lib/app/platform-secret';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (!platformSecretOk(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const rrgAgentId = new URL(req.url).searchParams.get('rrg_agent_id')?.trim() ?? '';
  if (!rrgAgentId) return NextResponse.json({ error: 'rrg_agent_id required' }, { status: 400 });

  const { data } = await db
    .from('app_buyers')
    .select('handle, wallet_address, agent_wallet_address, erc8004_agent_id, credit_balance_usdc')
    .eq('linked_rrg_agent_id', rrgAgentId)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: 'not_migrated' }, { status: 404 });

  return NextResponse.json({
    linked: true,
    handle: data.handle,
    wallet_address: data.wallet_address ? String(data.wallet_address).toLowerCase() : null,
    agent_wallet_address: data.agent_wallet_address ? String(data.agent_wallet_address).toLowerCase() : null,
    erc8004_agent_id: data.erc8004_agent_id ?? null,
    credit_balance_usdc: Number(data.credit_balance_usdc ?? 0),
  }, { headers: { 'cache-control': 'no-store' } });
}
