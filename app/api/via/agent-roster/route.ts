/**
 * GET /api/via/agent-roster
 *
 * The DB-driven seller roster for the central seller-agent runtime (the VPS
 * process in scripts/seller-agent.mjs). Returns every VIA-source seller that is
 * fully onboarded and therefore runnable: it has a derived agent wallet
 * (agent_wallet_address), an ERC-8004 identity to stamp on offers
 * (erc8004_agent_id), and is not rejected. This replaces the hand-maintained
 * VIA half of the ROSTER array, so onboarding a seller (register -> approve ->
 * enable-agent) makes it pitch on the next agent pass with no code change.
 *
 * The agent resolves each seller's SIGNING key itself, in memory, from
 * AGENT_WALLET_SEED + store_id; this endpoint only lists WHO to run, never HOW
 * to pay. It is deliberately UNAUTHENTICATED: seller identity is already public
 * (the list_sellers MCP tool returns the same roster to any agent), and every
 * field here is public or inert, slug/name, on-chain agent wallet + erc8004 id,
 * and store_id (the app_sellers UUID). store_id is only the HMAC MESSAGE in
 * wallet derivation; all security rests on the seed's secrecy (see
 * lib/app/agent-wallet.ts), so exposing the UUID reveals nothing exploitable.
 *
 * RRG-source brands are NOT here: they live in RRG's separate database and each
 * needs its <SLUG>_WALLET_PRIVATE_KEY placed on the VPS by hand before it can
 * pay, so they stay an explicit, key-gated list in seller-agent.mjs.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await db
    .from('app_sellers')
    .select('id, slug, name, agent_wallet_address, erc8004_agent_id, approval_status')
    .not('agent_wallet_address', 'is', null)
    .not('erc8004_agent_id', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const sellers = (data ?? [])
    // A store that once had a wallet but was later rejected must not be pitched for.
    .filter((s) => !String(s.approval_status ?? '').startsWith('rejected'))
    // Only REAL on-chain identities. Ingest/dev rows carry a placeholder id (e.g.
    // "TEST-09D1451E"); a real erc8004 id is the numeric token id. Pitching with a
    // fake id would stamp garbage identity on offers, so those rows are excluded.
    .filter((s) => /^[0-9]+$/.test(String(s.erc8004_agent_id)))
    .map((s) => ({
      slug: s.slug as string,
      name: s.name as string,
      source: 'via' as const,
      erc8004_id: String(s.erc8004_agent_id),
      store_id: s.id as string,
      expect: String(s.agent_wallet_address).toLowerCase(),
    }));

  return NextResponse.json({ sellers, count: sellers.length });
}
