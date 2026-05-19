/**
 * GET /api/brand/[slug]/concierge/customer
 *
 * Full who/what/when for one customer of this brand: identity, trust,
 * transactions, MCP interaction events, communications. Backs the Hermes
 * concierge MCP `get_customer` tool. Composes rrg_customer_get (which itself
 * joins agent_agents / rrg_brand_agent_trust / rrg_purchases /
 * mcp_interactions / rrg_customer_memory at read time).
 *
 * Auth: isConciergeAuthorized (superadmin x-admin-secret, or this brand's
 * x-concierge-secret bound to {slug}). Read-only.
 * Query: wallet | erc8004 | tg (at least one), limit (default 50).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isConciergeAuthorized, adminUnauthorized } from '@/lib/rrg/auth';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!(await isConciergeAuthorized(req, slug))) return adminUnauthorized();

  const url = new URL(req.url);
  const wallet = url.searchParams.get('wallet');
  const erc8004Raw = url.searchParams.get('erc8004');
  const tgRaw = url.searchParams.get('tg');
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);

  const erc8004 = erc8004Raw && /^\d+$/.test(erc8004Raw) ? Number(erc8004Raw) : null;
  const tg = tgRaw && /^\d+$/.test(tgRaw) ? Number(tgRaw) : null;

  if (!wallet && erc8004 === null && tg === null) {
    return NextResponse.json(
      { error: 'Provide one of wallet, erc8004, tg.' },
      { status: 400 },
    );
  }

  const { data, error } = await db.rpc('rrg_customer_get', {
    p_slug: slug,
    p_wallet: wallet,
    p_erc8004: erc8004,
    p_telegram_user_id: tg,
    p_limit: limit,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? { ok: false, error: 'no result' });
}
