import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isConciergeAuthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

interface AggregatedCustomer {
  identifier:    { wallet: string | null; erc8004: string | null; contact: string | null };
  first_seen:    string | null;
  last_seen:     string | null;
  interactions:  number;
  purchases:     number;
  total_usdc:    number;
  recent_tools:  string[];
  notes:         Array<{ id: string; channel: string; note: string; created_at: string }>;
}

/**
 * GET /api/sellers/[slug]/concierge/customer?wallet=&erc8004=&tg=
 *
 * Look up a single buyer the seller has interacted with. The Hermes
 * Sales Agent calls this when it has a wallet / ERC-8004 / contact
 * hint and wants the full picture before replying. Aggregates from
 * app_mcp_interactions, app_purchases, and app_seller_customer_notes.
 *
 * VIA does not have a Telegram bot layer like RRG, so the `tg` param
 * is accepted for forward-compatibility but matched against the
 * `contact` field on app_seller_customer_notes only.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await isConciergeAuthorized(req, slug))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url     = new URL(req.url);
  const wallet  = url.searchParams.get('wallet')?.trim().toLowerCase() || null;
  const erc8004 = url.searchParams.get('erc8004')?.trim() || null;
  const tg      = url.searchParams.get('tg')?.trim() || null;
  if (!wallet && !erc8004 && !tg) {
    return NextResponse.json({ error: 'one of wallet, erc8004, or tg is required' }, { status: 400 });
  }

  const { data: seller } = await db
    .from('app_sellers')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (!seller) {
    return NextResponse.json({ error: 'seller not found' }, { status: 404 });
  }
  const sellerId = seller.id as string;

  // Pull every interaction for this seller and filter in-memory. The
  // agent_identity column is jsonb so a server-side jsonb match would
  // be brittle across the via_agent_id / wallet / contact shapes; this
  // surface is low traffic, the seller's call volume is bounded.
  const [{ data: interactions }, { data: purchases }, { data: notes }] = await Promise.all([
    db.from('app_mcp_interactions')
      .select('tool_name, agent_identity, request, created_at')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(1000),
    db.from('app_purchases')
      .select('buyer_wallet, buyer_agent_id, qty, total_usdc, status, created_at')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false }),
    db.from('app_seller_customer_notes')
      .select('id, channel, note, created_at, buyer_wallet, buyer_agent_id, contact')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  function matchesInteraction(row: { agent_identity: Record<string, unknown>; request: unknown }): boolean {
    const ident = row.agent_identity ?? {};
    if (wallet) {
      const reqBody = (row.request as Record<string, unknown> | null) ?? {};
      const wList = [reqBody.buyer_wallet, ident.wallet, ident.buyer_wallet]
        .map((v) => (typeof v === 'string' ? v.toLowerCase() : null))
        .filter((v): v is string => Boolean(v));
      if (wList.includes(wallet)) return true;
    }
    if (erc8004) {
      const viaId = ident.via_agent_id;
      const reqBody = (row.request as Record<string, unknown> | null) ?? {};
      const candidates = [viaId, reqBody.buyer_agent_id].map((v) => (v == null ? null : String(v))).filter(Boolean);
      if (candidates.includes(erc8004)) return true;
    }
    if (tg) {
      const reqBody = (row.request as Record<string, unknown> | null) ?? {};
      if (typeof reqBody.contact === 'string' && reqBody.contact.trim() === tg) return true;
    }
    return false;
  }

  const matchedInteractions = (interactions ?? []).filter(matchesInteraction);
  const matchedPurchases = (purchases ?? []).filter((p) => {
    if (wallet && (p.buyer_wallet as string | null)?.toLowerCase() === wallet) return true;
    if (erc8004 && (p.buyer_agent_id as string | null) === erc8004) return true;
    return false;
  });
  const matchedNotes = (notes ?? []).filter((n) => {
    if (wallet && (n.buyer_wallet as string | null)?.toLowerCase() === wallet) return true;
    if (erc8004 && (n.buyer_agent_id as string | null) === erc8004) return true;
    if (tg && (n.contact as string | null) === tg) return true;
    return false;
  });

  if (matchedInteractions.length === 0 && matchedPurchases.length === 0 && matchedNotes.length === 0) {
    return NextResponse.json({ customer: null });
  }

  const allDates = [
    ...matchedInteractions.map((i) => i.created_at as string),
    ...matchedPurchases.map((p) => p.created_at as string),
    ...matchedNotes.map((n) => n.created_at as string),
  ].sort();

  const aggregated: AggregatedCustomer = {
    identifier:   { wallet, erc8004, contact: tg },
    first_seen:   allDates[0] ?? null,
    last_seen:    allDates[allDates.length - 1] ?? null,
    interactions: matchedInteractions.length,
    purchases:    matchedPurchases.length,
    total_usdc:   matchedPurchases.reduce((sum, p) => sum + Number(p.total_usdc ?? 0), 0),
    recent_tools: Array.from(new Set(matchedInteractions.slice(0, 10).map((i) => i.tool_name as string))),
    notes:        matchedNotes.slice(0, 20).map((n) => ({
      id:         n.id as string,
      channel:    n.channel as string,
      note:       n.note as string,
      created_at: n.created_at as string,
    })),
  };

  return NextResponse.json({ customer: aggregated });
}
