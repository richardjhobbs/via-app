/**
 * GET /api/via/brief/[id]
 *
 * The canonical brief door. Returns the FULL structured brief (category, hard
 * requirements, preferences, type_terms, budget) for one open, discoverable brief
 * of a public buyer , the paid tier of the teaser. The raw `intent_text` is NEVER
 * returned: only the structured intent leaves the system, same as everywhere else.
 *
 * Phase 1: ungated. Phase 4 wraps this in an x402 micro-fee challenge so any agent
 * with a wallet (or a VIA seller spending credits) pays to unlock it. The offer
 * endpoint is POST /api/via/brief/[id]/offer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { publicBrief, buyerMcpUrl, briefDoorUrl, offerInstructions } from '@/lib/app/demand';
import { requireX402, FEE_UNLOCK_USDC, FEE_OFFER_USDC } from '@/lib/app/x402-gate';

export const dynamic = 'force-dynamic';

const ACTIVE = ['open', 'broadcast', 'matched'];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data, error } = await db
    .from('app_buyer_intents')
    .select('id, structured, app_buyers!inner(handle, public)')
    .eq('id', id)
    .in('status', ACTIVE)
    .eq('discoverable', true)
    .eq('app_buyers.public', true)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: 'No such open, visible brief.' }, { status: 404 });
  }

  // x402 micro-fee: a seller agent pays to unlock the FULL structured brief. The
  // teaser on the feed/relay is free; the full intent is the paid tier. The payer
  // signs an EIP-2612 permit (gasless); the platform settles it on-chain.
  const gate = await requireX402(req, briefDoorUrl(id), FEE_UNLOCK_USDC, `Unlock the full VIA brief ${id}`);
  if (!gate.ok) return gate.response;

  const brief = publicBrief({ id: data.id as string, structured: data.structured as Record<string, unknown> | null });
  if (!brief) {
    return NextResponse.json({ error: 'Brief has no shareable structured intent yet.' }, { status: 404 });
  }

  const buyer = Array.isArray(data.app_buyers) ? data.app_buyers[0] : data.app_buyers;
  return NextResponse.json({
    brief,
    buyer_mcp_url: buyer?.handle ? buyerMcpUrl(buyer.handle) : null,
    offer_url:     `${briefDoorUrl(id)}/offer`,
    how_to_offer:  offerInstructions(id, FEE_OFFER_USDC),
  });
}
