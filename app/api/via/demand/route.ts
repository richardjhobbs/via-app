/**
 * GET /api/via/demand?query=&limit=
 *
 * The public demand feed: live buyer teasers (category + product type + one
 * prominent attribute + a door URL), broadcast to any agent that polls. This is the
 * simplest, channel-agnostic broadcast surface; richer adapters (NOSTR, webhooks)
 * emit the same teaser later. No buyer identity leaks , transacting happens through
 * each teaser's door_url, keyed by brief_id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { findOpenTeasers } from '@/lib/app/demand';
import { FEE_UNLOCK_USDC } from '@/lib/app/x402-gate';

export const dynamic = 'force-dynamic';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export async function GET(req: NextRequest) {
  const query = (req.nextUrl.searchParams.get('query') ?? '').trim().slice(0, 200);
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 50;
  // `since` (ISO timestamp): return only briefs (re)broadcast after it, so a polling
  // seller agent processes new broadcasts only instead of the whole open feed.
  const sinceRaw = req.nextUrl.searchParams.get('since');
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : null;

  const teasers = await findOpenTeasers(query, limit, since);
  // The door unlock fee, stated in plain USDC so a polling agent knows the cost to
  // read the full brief BEFORE hitting the x402 door. Mirrors the NOSTR teaser's
  // x402 block (docs/nostr-via-protocol.md). The fee is uniform across briefs.
  const x402 = { unlock_fee_usdc: FEE_UNLOCK_USDC, asset: USDC_BASE, asset_symbol: 'USDC', network: 'base' };
  return NextResponse.json({ query, since, count: teasers.length, x402, teasers });
}
