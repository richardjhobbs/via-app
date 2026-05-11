/**
 * GET /api/rrg/agent/inbox
 *
 * Per-agent fetch of inbound A2A / MCP outreach messages addressed to a
 * specific ERC-8004 agent. Used by the four-step Inbound Message Reception
 * Protocol: a recipient agent's heartbeat polls this endpoint, runs the
 * protocol on every entry returned (Accept, Research, Interact, Relay),
 * and updates its own `since` cursor.
 *
 * Canonical spec: via-agent-wiki/shared/inbound-message-reception-protocol.md
 * Notion mirror: https://www.notion.so/35ddbc7b67f2812baddeddc8811a7eeb
 *
 * Query params:
 *   erc8004_id  (required, integer)  the receiving agent's ERC-8004 ID
 *   chain       (optional, default 'base')
 *   since       (optional, ISO 8601) only entries created after this point
 *   limit       (optional, default 50, max 200)
 *
 * Auth: x-agent-api-key header validated against RRG_AGENT_INBOX_KEY env.
 * Single shared key for the cohort during DrHobbs prototype; split per-agent
 * once Brand Concierges / Personal Shoppers adopt the protocol.
 *
 * Response shape:
 *   {
 *     count: number,
 *     entries: Array<{
 *       outreach_id: string,
 *       created_at: string,
 *       channel: string,
 *       message_type: string,
 *       status: string,
 *       brand: { id, slug, name, ships_from?, ships_to? } | null,
 *       message_body: string,
 *       product_refs: MktProductRef[],
 *       sender: { name, erc8004_id, agent_card_url },
 *     }>
 *   }
 */

import { NextResponse } from 'next/server';
import { db, getBrandById, type RrgBrand } from '@/lib/rrg/db';
import { getShippingConfig } from '@/lib/rrg/shipping';

export const dynamic = 'force-dynamic';

const PLATFORM_AGENT = {
  name: 'RRG Platform Agent',
  erc8004_id: 33313,
  agent_card_url: 'https://realrealgenuine.com/.well-known/agent-card.json',
};

function authOk(req: Request): boolean {
  const secret = process.env.RRG_AGENT_INBOX_KEY;
  if (!secret) return false;
  const header = req.headers.get('x-agent-api-key');
  return !!header && header === secret;
}

function shippingDescriptor(brand: RrgBrand): { from?: string; to?: string } {
  const cfg = getShippingConfig(brand.brand_data);
  if (!cfg) return {};
  const from = cfg.shipsFromCountry;
  let to: string | undefined;
  if (cfg.internationalFlatUsd === null || cfg.internationalFlatUsd === undefined) {
    to = from ? `${from} only` : 'domestic only';
  } else if (cfg.excludedCountries && cfg.excludedCountries.length > 0) {
    to = `worldwide except: ${cfg.excludedCountries.join(', ')}`;
  } else {
    to = 'worldwide';
  }
  return { from, to };
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const erc8004IdRaw = url.searchParams.get('erc8004_id');
  const chain = url.searchParams.get('chain') ?? 'base';
  const sinceRaw = url.searchParams.get('since');
  const limitRaw = url.searchParams.get('limit');

  const erc8004_id = erc8004IdRaw ? parseInt(erc8004IdRaw, 10) : NaN;
  if (!Number.isFinite(erc8004_id)) {
    return NextResponse.json(
      { error: 'erc8004_id query param required (integer)' },
      { status: 400 },
    );
  }

  const limit = Math.min(
    Math.max(parseInt(limitRaw ?? '50', 10) || 50, 1),
    200,
  );

  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw))
    ? new Date(sinceRaw).toISOString()
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Find the candidate row(s) for this agent on this chain. Discovery scanner
  // can record duplicates by wallet — collect all matching candidate_ids.
  const { data: candidates, error: candErr } = await db
    .from('mkt_candidates')
    .select('id')
    .eq('erc8004_id', erc8004_id)
    .eq('chain', chain);

  if (candErr) {
    return NextResponse.json({ error: `candidate lookup failed: ${candErr.message}` }, { status: 500 });
  }

  const candidateIds = (candidates ?? []).map((c) => c.id as string);
  if (candidateIds.length === 0) {
    return NextResponse.json({ count: 0, entries: [] });
  }

  // Fetch outreach addressed to any of those candidate rows since the cursor.
  const { data: outreach, error: oErr } = await db
    .from('mkt_outreach')
    .select('id, created_at, candidate_id, brand_id, channel, message_type, status, message_body, product_refs')
    .in('candidate_id', candidateIds)
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (oErr) {
    return NextResponse.json({ error: `outreach lookup failed: ${oErr.message}` }, { status: 500 });
  }

  const rows = outreach ?? [];

  // Resolve brand metadata once per unique brand_id to keep the response
  // human-readable on the agent side. Brand row carries shipping info that
  // the recipient agent can use in Step 3 (Interact / get_quote).
  const brandIds = [...new Set(rows.map((r) => r.brand_id).filter((b): b is string => !!b))];
  const brandMap = new Map<string, RrgBrand>();
  for (const bid of brandIds) {
    const b = await getBrandById(bid);
    if (b) brandMap.set(bid, b);
  }

  const entries = rows.map((r) => {
    const brand = r.brand_id ? brandMap.get(r.brand_id) ?? null : null;
    const ship = brand ? shippingDescriptor(brand) : {};
    return {
      outreach_id: r.id,
      created_at: r.created_at,
      channel: r.channel,
      message_type: r.message_type,
      status: r.status,
      brand: brand
        ? {
            id: brand.id,
            slug: brand.slug,
            name: brand.name,
            ships_from: ship.from ?? null,
            ships_to: ship.to ?? null,
          }
        : null,
      message_body: r.message_body,
      product_refs: r.product_refs ?? [],
      sender: PLATFORM_AGENT,
    };
  });

  return NextResponse.json({ count: entries.length, entries });
}
