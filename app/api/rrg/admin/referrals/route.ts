/**
 * GET  /api/rrg/admin/referrals — List RRG Marketing Programme members
 *                                 (a.k.a. referral partners) with payout summary
 * POST /api/rrg/admin/referrals — Update a commission row
 *                                 (approve / mark_paid / reject / reset)
 *
 * Admin-only. Backed by the `mkt_*` tables (mkt_agents, mkt_candidates,
 * mkt_conversions, mkt_commissions) — the single programme for BOTH humans
 * and AI agents. There is no human/agent table split — identity is just a
 * Base wallet.
 */

import { NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/rrg/auth';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await isAdminFromCookies()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 1. All marketing/referral partners
  const { data: agents, error: aErr } = await db
    .from('mkt_agents')
    .select('*')
    .order('created_at', { ascending: false });
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  // 2. All commissions
  const { data: commissions, error: cErr } = await db
    .from('mkt_commissions')
    .select('*')
    .order('created_at', { ascending: false });
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  // 3. All candidates (to count referrals per partner)
  const { data: candidates } = await db
    .from('mkt_candidates')
    .select('id, discovered_by, name, wallet_address, outreach_status, tier, created_at');

  const commsByPartner = new Map<string, typeof commissions>();
  for (const c of commissions ?? []) {
    const arr = commsByPartner.get(c.marketing_agent_id) ?? [];
    arr.push(c);
    commsByPartner.set(c.marketing_agent_id, arr);
  }
  const candsByPartner = new Map<string, typeof candidates>();
  for (const cand of candidates ?? []) {
    if (!cand.discovered_by) continue;
    const arr = candsByPartner.get(cand.discovered_by) ?? [];
    arr.push(cand);
    candsByPartner.set(cand.discovered_by, arr);
  }

  const enriched = (agents ?? []).map(a => {
    const comms = commsByPartner.get(a.id) ?? [];
    const pending  = comms.filter(c => c.status === 'pending').reduce((s, c) => s + parseFloat(String(c.commission_usdc)), 0);
    const approved = comms.filter(c => c.status === 'approved').reduce((s, c) => s + parseFloat(String(c.commission_usdc)), 0);
    const paid     = comms.filter(c => c.status === 'paid').reduce((s, c) => s + parseFloat(String(c.commission_usdc)), 0);
    const rejected = comms.filter(c => c.status === 'rejected').reduce((s, c) => s + parseFloat(String(c.commission_usdc)), 0);

    const cands = candsByPartner.get(a.id) ?? [];
    const converted = cands.filter(c => c.outreach_status === 'converted').length;

    return {
      id:                a.id,
      name:              a.name,
      wallet_address:    a.wallet_address,
      erc8004_id:        a.erc8004_id,
      status:            a.status,
      commission_bps:    a.commission_bps,
      total_candidates:  cands.length,
      converted_candidates: converted,
      total_outreach:    a.total_outreach_sent,
      total_conversions: a.total_conversions,
      total_commission_usdc: parseFloat(String(a.total_commission_usdc)),
      pending_usdc:      pending,
      approved_usdc:     approved,
      paid_usdc:         paid,
      rejected_usdc:     rejected,
      commission_count:  comms.length,
      created_at:        a.created_at,
      updated_at:        a.updated_at,
      commissions:       comms.map(c => ({
        id:              c.id,
        date:            c.created_at,
        candidate_id:    c.candidate_id,
        conversion_id:   c.conversion_id,
        revenue_usdc:    parseFloat(String(c.revenue_usdc)),
        commission_usdc: parseFloat(String(c.commission_usdc)),
        status:          c.status,
        paid_at:         c.paid_at,
        tx_hash:         c.tx_hash,
        notes:           c.notes,
      })),
      recent_referrals: cands.slice(0, 10).map(c => ({
        id:             c.id,
        name:           c.name,
        wallet:         c.wallet_address,
        tier:           c.tier,
        status:         c.outreach_status,
        date:           c.created_at,
      })),
    };
  });

  return NextResponse.json({
    partners: enriched,
    totals: {
      partner_count:        enriched.length,
      total_referrals:      enriched.reduce((s, p) => s + p.total_candidates, 0),
      converted_referrals:  enriched.reduce((s, p) => s + p.converted_candidates, 0),
      pending_usdc:         enriched.reduce((s, p) => s + p.pending_usdc, 0),
      approved_usdc:        enriched.reduce((s, p) => s + p.approved_usdc, 0),
      paid_usdc:            enriched.reduce((s, p) => s + p.paid_usdc, 0),
    },
  });
}

export async function POST(req: Request) {
  if (!await isAdminFromCookies()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { commission_id, action, tx_hash } = body as { commission_id?: string; action?: 'approve' | 'mark_paid' | 'reject' | 'reset'; tx_hash?: string };

  if (!commission_id || !action) {
    return NextResponse.json({ error: 'commission_id and action required' }, { status: 400 });
  }

  let updates: Record<string, unknown> = {};
  switch (action) {
    case 'approve':   updates = { status: 'approved' }; break;
    case 'mark_paid': updates = { status: 'paid', paid_at: new Date().toISOString(), tx_hash: tx_hash ?? null }; break;
    case 'reject':    updates = { status: 'rejected' }; break;
    case 'reset':     updates = { status: 'pending', paid_at: null, tx_hash: null }; break;
    default: return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  const { error } = await db.from('mkt_commissions').update(updates).eq('id', commission_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, commission_id, ...updates });
}
