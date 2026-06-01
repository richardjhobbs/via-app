import { NextResponse } from 'next/server';
import { getNetworkMetrics } from '@/lib/app/network-stats';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/stats/test-agents: live count of synthetic load-test agents across
 * the VIA network.
 *
 * The real load-test agents are agent_agents rows flagged is_synthetic=true on
 * each member platform (RRG seeds them as LOADTEST-<n>; see rrg
 * scripts/seed-synthetic-agents.mjs). They deliberately skip ERC-8004 minting
 * and never settle. Each member self-reports the count as `syntheticAgents` on
 * its /stats endpoint; network-stats sums them. Cosmetic today; may become a
 * tracked network metric later.
 */
export async function GET() {
  const metrics = await getNetworkMetrics();

  return NextResponse.json(
    { count: metrics.syntheticAgents },
    { headers: { 'cache-control': 'public, max-age=15, s-maxage=15' } },
  );
}
