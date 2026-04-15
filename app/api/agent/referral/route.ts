/**
 * POST /api/agent/referral — Register the calling agent as a referral partner
 * GET  /api/agent/referral — Get the calling agent's partner stats + commissions
 *
 * Authenticates via the agent session cookie. Same model as the creator
 * endpoint at /api/creator/referral, just keyed on agent_id instead of
 * creator_id. Agents earn the same 10%-of-platform-share commission.
 */

import { NextResponse } from 'next/server';
import { getSessionAgent } from '@/lib/agent/auth';
import {
  registerAgentPartner,
  getPartnerByAgentId,
  getPartnerStats,
} from '@/lib/rrg/referral';

export const dynamic = 'force-dynamic';

// POST — opt in as a referral partner
export async function POST() {
  const agent = await getSessionAgent();
  if (!agent) return NextResponse.json({ error: 'No active agent session' }, { status: 401 });
  if (!agent.wallet_address) {
    return NextResponse.json({ error: 'Agent has no wallet_address — cannot register for payouts' }, { status: 400 });
  }

  const partner = await registerAgentPartner(agent.id, agent.wallet_address);
  if (!partner) return NextResponse.json({ error: 'Failed to register' }, { status: 500 });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com';
  return NextResponse.json({
    partner: {
      id:             partner.id,
      partnerType:    partner.partner_type,
      referralCode:   partner.referral_code,
      status:         partner.status,
      commissionRate: `${partner.commission_bps / 100}%`,
      walletAddress:  partner.wallet_address,
    },
    linkTemplate: `${siteUrl}/rrg/drop/{tokenId}?ref=${partner.referral_code}`,
  });
}

// GET — partner stats + commission history
export async function GET() {
  const agent = await getSessionAgent();
  if (!agent) return NextResponse.json({ error: 'No active agent session' }, { status: 401 });

  const partner = await getPartnerByAgentId(agent.id);
  if (!partner) return NextResponse.json({ registered: false });

  const stats = await getPartnerStats(partner.id);
  if (!stats) return NextResponse.json({ registered: false });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com';
  return NextResponse.json({
    registered: true,
    partner: {
      id:                  stats.partner.id,
      partnerType:         stats.partner.partner_type,
      referralCode:        stats.partner.referral_code,
      status:              stats.partner.status,
      commissionRate:      `${stats.partner.commission_bps / 100}%`,
      walletAddress:       stats.partner.wallet_address,
      totalClicks:         stats.partner.total_clicks,
      totalConversions:    stats.partner.total_conversions,
      totalCommissionUsdc: parseFloat(String(stats.partner.total_commission_usdc)),
      pendingUsdc:         stats.pendingUsdc,
      paidUsdc:            stats.paidUsdc,
      conversionRate:      stats.partner.total_clicks > 0
        ? parseFloat((stats.partner.total_conversions / stats.partner.total_clicks * 100).toFixed(1))
        : 0,
    },
    linkTemplate: `${siteUrl}/rrg/drop/{tokenId}?ref=${stats.partner.referral_code}`,
    commissions: stats.commissions.map(c => ({
      id:             c.id,
      date:           c.created_at,
      revenueUsdc:    parseFloat(String(c.revenue_usdc)),
      commissionUsdc: parseFloat(String(c.commission_usdc)),
      status:         c.status,
      notes:          c.notes,
    })),
  });
}
