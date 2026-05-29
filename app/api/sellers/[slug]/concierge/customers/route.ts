import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isConciergeAuthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

interface CustomerSummary {
  wallet:        string | null;
  erc8004:       string | null;
  interactions:  number;
  purchases:     number;
  total_usdc:    number;
  last_seen:     string;
}

/**
 * GET /api/sellers/[slug]/concierge/customers?q=&limit=
 *
 * Rolling list of every buyer the seller has touched, derived from
 * app_mcp_interactions + app_purchases. Optional `q` substring filters
 * by wallet or ERC-8004 id. The Hermes Sales Agent uses this to scan
 * its known customer base before guessing.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await isConciergeAuthorized(req, slug))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url     = new URL(req.url);
  const q       = url.searchParams.get('q')?.trim().toLowerCase() || null;
  const limit   = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);

  const { data: seller } = await db
    .from('app_sellers')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (!seller) {
    return NextResponse.json({ error: 'seller not found' }, { status: 404 });
  }
  const sellerId = seller.id as string;

  const [{ data: interactions }, { data: purchases }] = await Promise.all([
    db.from('app_mcp_interactions')
      .select('agent_identity, request, created_at')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(2000),
    db.from('app_purchases')
      .select('buyer_wallet, buyer_agent_id, total_usdc, created_at')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false }),
  ]);

  const bucket = new Map<string, CustomerSummary>();
  function bumpInteraction(wallet: string | null, erc: string | null, when: string) {
    const key = `${wallet ?? ''}|${erc ?? ''}`;
    if (!wallet && !erc) return;
    const row = bucket.get(key) ?? {
      wallet, erc8004: erc, interactions: 0, purchases: 0, total_usdc: 0, last_seen: when,
    };
    row.interactions += 1;
    if (when > row.last_seen) row.last_seen = when;
    bucket.set(key, row);
  }
  function bumpPurchase(wallet: string | null, erc: string | null, amount: number, when: string) {
    const key = `${wallet ?? ''}|${erc ?? ''}`;
    if (!wallet && !erc) return;
    const row = bucket.get(key) ?? {
      wallet, erc8004: erc, interactions: 0, purchases: 0, total_usdc: 0, last_seen: when,
    };
    row.purchases += 1;
    row.total_usdc += amount;
    if (when > row.last_seen) row.last_seen = when;
    bucket.set(key, row);
  }

  for (const i of interactions ?? []) {
    const ident   = (i.agent_identity ?? {}) as Record<string, unknown>;
    const reqBody = (i.request as Record<string, unknown> | null) ?? {};
    const w = typeof reqBody.buyer_wallet === 'string' ? reqBody.buyer_wallet.toLowerCase() : null;
    const eFromIdent = ident.via_agent_id;
    const e = eFromIdent != null ? String(eFromIdent)
            : typeof reqBody.buyer_agent_id === 'string' ? reqBody.buyer_agent_id
            : null;
    bumpInteraction(w, e, i.created_at as string);
  }
  for (const p of purchases ?? []) {
    const w = (p.buyer_wallet as string | null)?.toLowerCase() || null;
    const e = (p.buyer_agent_id as string | null) || null;
    bumpPurchase(w, e, Number(p.total_usdc ?? 0), p.created_at as string);
  }

  let rows = Array.from(bucket.values());
  if (q) {
    rows = rows.filter(
      (r) => (r.wallet && r.wallet.includes(q)) || (r.erc8004 && r.erc8004.includes(q)),
    );
  }
  rows.sort((a, b) => b.last_seen.localeCompare(a.last_seen));

  return NextResponse.json({ customers: rows.slice(0, limit), total: rows.length });
}
