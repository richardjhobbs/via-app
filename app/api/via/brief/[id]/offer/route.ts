/**
 * POST /api/via/brief/[id]/offer
 *
 * The canonical offer door: any agent on any channel submits ONE product against a
 * brief. The buyer's judge reads ONLY this asserted product against the brief (a
 * bounded, reliable task, never the index), records the offer with seller
 * attribution, and notifies the buyer. The seller stands behind the facts in the
 * offer , the platform invents nothing.
 *
 * Body: { title, description?, price_usdc?, url?, seller_mcp_url?, tags?,
 *         attributes?, seller_slug?, seller_name? }
 * `attributes` carries the seller's structured MCP facets (colours, sizes,
 * product_type, tags, sample SKUs) so the buyer's judge can confirm requirements a
 * bare title cannot.
 *
 * Phase 1: ungated. Phase 4 wraps this in an x402 micro-fee (or a VIA-seller credit
 * deduction) and enqueues the both-agent ERC-8004 reputation signals on settle.
 */
import { NextRequest, NextResponse } from 'next/server';
import { submitOffer, offerExists, briefDoorUrl, type OfferInput } from '@/lib/app/demand';
import { requireX402, FEE_OFFER_USDC } from '@/lib/app/x402-gate';
import { db } from '@/lib/app/db';
import { sellerOnboardInfo } from '@/lib/app/broadcast/nostr-protocol';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

/** Accept a plain attributes object, but bound its size so a pitch row can't be
 *  bloated. Returns null for non-objects, arrays, or oversized payloads. */
function sanitizeAttributes(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  try {
    const json = JSON.stringify(v);
    if (json.length > 4000) return null;
    return v as Record<string, unknown>;
  } catch { return null; }
}

function callerIdentity(req: NextRequest): Record<string, unknown> {
  const viaAgentId = req.headers.get('x-via-agent-id');
  const fwd = req.headers.get('x-forwarded-for');
  return {
    via_agent_id: viaAgentId ? Number(viaAgentId) : null,
    user_agent:   req.headers.get('user-agent'),
    ip:           fwd ? fwd.split(',')[0].trim() : null,
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ip = (req.headers.get('x-forwarded-for') ?? 'noip').split(',')[0].trim();
  if (rateLimited(ip)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const title = String(body.title ?? '').trim();
  if (title.length < 1 || title.length > 300) {
    return NextResponse.json({ error: 'title must be 1 to 300 characters' }, { status: 400 });
  }

  const offer: OfferInput = {
    title,
    description:    typeof body.description === 'string' ? body.description.slice(0, 2000) : null,
    price_usdc:     typeof body.price_usdc === 'number' ? body.price_usdc : null,
    url:            typeof body.url === 'string' ? body.url.slice(0, 500) : null,
    product_id:     typeof body.product_id === 'string' ? body.product_id.slice(0, 120) : null,
    seller_mcp_url: typeof body.seller_mcp_url === 'string' ? body.seller_mcp_url.slice(0, 500) : null,
    tags:           Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string').slice(0, 24) : [],
    attributes:     sanitizeAttributes(body.attributes),
    seller_slug:    typeof body.seller_slug === 'string' ? body.seller_slug.slice(0, 120) : null,
    seller_name:    typeof body.seller_name === 'string' ? body.seller_name.slice(0, 200) : null,
    seller_erc8004_id: typeof body.seller_erc8004_id === 'string' ? body.seller_erc8004_id.slice(0, 40) : null,
  };

  // Idempotency BEFORE charging: a polling agent that re-submits the same product
  // must never pay the per-item micro-fee twice. If it already offered this exact
  // item on this brief, return the prior outcome with no fee.
  if (offer.seller_slug && await offerExists(id, offer.seller_slug, offer.title)) {
    return NextResponse.json({ brief_id: id, status: 'already_offered' });
  }

  // x402 micro-fee: the seller pays per item it puts forward. Settled on-chain;
  // the payment tx anchors the seller's ERC-8004 reputation signal.
  const gate = await requireX402(req, `${briefDoorUrl(id)}/offer`, FEE_OFFER_USDC, `Submit one offer on VIA brief ${id}`);
  if (!gate.ok) return gate.response;
  offer.payment_tx_hash = gate.payment.txHash;

  const outcome = await submitOffer(id, offer, callerIdentity(req));
  if (outcome.status === 'not_found') {
    return NextResponse.json({ error: 'No such open, visible brief.' }, { status: 404 });
  }

  // Commercial gate at settlement, not discovery: the quote is recorded for any
  // agent, but to be PAID the sale must settle through VIA. If the quoting
  // seller is not a recognised live VIA seller, return the onboarding CTA so an
  // external agent knows how to register and capture the deal on-network.
  let recognised = false;
  if (offer.seller_slug) {
    const { data: known } = await db.from('app_sellers').select('active').eq('slug', offer.seller_slug).maybeSingle();
    recognised = known?.active === true;
  }

  return NextResponse.json({
    brief_id:   outcome.brief_id,
    verdict:    outcome.verdict,
    payment_tx: gate.payment.txHash,
    ...(recognised ? {} : { onboard: sellerOnboardInfo() }),
  });
}
