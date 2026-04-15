/**
 * GET  /api/rrg/admin/referrals — List all referral partners with payout summary
 * POST /api/rrg/admin/referrals — Update commission status (approve / paid / rejected)
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/rrg/auth';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await isAdminFromCookies()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: partners, error: pErr } = await db
    .from('rrg_referral_partners')
    .select('*')
    .order('created_at', { ascending: false });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  // Pull all commissions in one query, group by partner_id
  const { data: commissions, error: cErr } = await db
    .from('rrg_referral_commissions')
    .select('*')
    .order('created_at', { ascending: false });
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  // Resolve display names — agents from agent_agents, creators from rrg_creators
  const agentIds   = (partners ?? []).filter(p => p.partner_type === 'agent').map(p => p.agent_id).filter(Boolean) as string[];
  const creatorIds = (partners ?? []).filter(p => p.partner_type === 'creator').map(p => p.creator_id).filter(Boolean) as string[];

  const agentMap = new Map<string, { name: string; via_agent_id: number | null }>();
  if (agentIds.length > 0) {
    const { data: agents } = await db
      .from('agent_agents')
      .select('id, name, erc8004_agent_id')
      .in('id', agentIds);
    for (const a of agents ?? []) agentMap.set(a.id, { name: a.name, via_agent_id: a.erc8004_agent_id });
  }

  const creatorMap = new Map<string, { display_name: string | null; email: string | null }>();
  if (creatorIds.length > 0) {
    const { data: creators } = await db
      .from('rrg_creators')
      .select('id, display_name, email')
      .in('id', creatorIds);
    for (const c of creators ?? []) creatorMap.set(c.id, { display_name: c.display_name, email: c.email });
  }

  const commsByPartner = new Map<string, typeof commissions>();
  for (const c of commissions ?? []) {
    const arr = commsByPartner.get(c.partner_id) ?? [];
    arr.push(c);
    commsByPartner.set(c.partner_id, arr);
  }

  const enriched = (partners ?? []).map(p => {
    const comms = commsByPartner.get(p.id) ?? [];
    const pending = comms.filter(c => c.status === 'pending').reduce((s, c) => s + parseFloat(String(c.commission_usdc)), 0);
    const approved = comms.filter(c => c.status === 'approved').reduce((s, c) => s + parseFloat(String(c.commission_usdc)), 0);
    const paid     = comms.filter(c => c.status === 'paid').reduce((s, c) => s + parseFloat(String(c.commission_usdc)), 0);
    const rejected = comms.filter(c => c.status === 'rejected').reduce((s, c) => s + parseFloat(String(c.commission_usdc)), 0);

    let displayName = '—';
    if (p.partner_type === 'agent' && p.agent_id) {
      const a = agentMap.get(p.agent_id);
      if (a) displayName = a.via_agent_id ? `${a.name} (VIA #${a.via_agent_id})` : a.name;
    } else if (p.partner_type === 'creator' && p.creator_id) {
      const c = creatorMap.get(p.creator_id);
      if (c) displayName = c.display_name || c.email || `creator/${p.creator_id.slice(0, 8)}`;
    }

    return {
      id:              p.id,
      partner_type:    p.partner_type,
      display_name:    displayName,
      referral_code:   p.referral_code,
      wallet_address:  p.wallet_address,
      status:          p.status,
      commission_bps:  p.commission_bps,
      total_clicks:    p.total_clicks,
      total_conversions: p.total_conversions,
      total_commission_usdc: parseFloat(String(p.total_commission_usdc)),
      pending_usdc:    pending,
      approved_usdc:   approved,
      paid_usdc:       paid,
      rejected_usdc:   rejected,
      commission_count: comms.length,
      created_at:      p.created_at,
      updated_at:      p.updated_at,
      commissions:     comms.map(c => ({
        id:             c.id,
        date:           c.created_at,
        purchase_id:    c.purchase_id,
        revenue_usdc:   parseFloat(String(c.revenue_usdc)),
        commission_usdc:parseFloat(String(c.commission_usdc)),
        status:         c.status,
        paid_at:        c.paid_at,
        tx_hash:        c.tx_hash,
        notes:          c.notes,
      })),
    };
  });

  return NextResponse.json({
    partners: enriched,
    totals: {
      partner_count:        enriched.length,
      agent_partner_count:  enriched.filter(p => p.partner_type === 'agent').length,
      creator_partner_count:enriched.filter(p => p.partner_type === 'creator').length,
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

  const { error } = await db.from('rrg_referral_commissions').update(updates).eq('id', commission_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, commission_id, ...updates });
}
