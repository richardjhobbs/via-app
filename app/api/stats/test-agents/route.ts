import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/stats/test-agents: live count of synthetic load-test buying agents.
 *
 * Test agents are registered with a `TEST-` placeholder in erc8004_agent_id
 * (see lib/app/test-mode.ts) instead of a real on-chain mint. They exist only
 * to stress-test the network, have no owner or wallet, and are counted here so
 * the footer can show how many are live during a run. Cosmetic today; may
 * become a tracked network metric later.
 */
export async function GET() {
  const { count } = await db
    .from('app_buyers')
    .select('id', { count: 'exact', head: true })
    .like('erc8004_agent_id', 'TEST-%');

  return NextResponse.json(
    { count: count ?? 0 },
    { headers: { 'cache-control': 'public, max-age=15, s-maxage=15' } },
  );
}
