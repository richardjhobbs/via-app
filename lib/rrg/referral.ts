/**
 * Referral Partner System — Core Logic
 *
 * Handles partner registration, click tracking, and commission processing.
 * Human creators can opt-in as referral partners and earn 10% of the
 * platform's share when someone purchases via their referral link.
 */

import { randomBytes, createHash } from 'crypto';
import { db } from './db';

// ── Types ────────────────────────────────────────────────────────────────────

export type PartnerType = 'creator' | 'agent';

export interface ReferralPartner {
  id: string;
  created_at: string;
  updated_at: string;
  partner_type: PartnerType;
  /** Set when partner_type='creator', null otherwise. */
  creator_id: string | null;
  /** Set when partner_type='agent', null otherwise. */
  agent_id: string | null;
  wallet_address: string;
  referral_code: string;
  status: 'active' | 'paused' | 'suspended';
  commission_bps: number;
  total_clicks: number;
  total_conversions: number;
  total_commission_usdc: number;
}

export interface ReferralCommission {
  id: string;
  created_at: string;
  partner_id: string;
  purchase_id: string;
  revenue_usdc: number;
  commission_bps: number;
  commission_usdc: number;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  paid_at: string | null;
  tx_hash: string | null;
  notes: string | null;
}

// ── Partner Management ───────────────────────────────────────────────────────

/**
 * Generate a unique 8-character referral code.
 */
function generateReferralCode(): string {
  return randomBytes(6).toString('base64url').slice(0, 8);
}

async function uniqueReferralCode(): Promise<string> {
  let code = generateReferralCode();
  for (let i = 0; i < 5; i++) {
    const { data: collision } = await db
      .from('rrg_referral_partners')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle();
    if (!collision) return code;
    code = generateReferralCode();
  }
  return code;
}

/**
 * Register a creator as a referral partner.
 * Returns the existing partner if already registered.
 */
export async function registerPartner(
  creatorId: string,
  walletAddress: string,
): Promise<ReferralPartner | null> {
  const { data: existing } = await db
    .from('rrg_referral_partners')
    .select('*')
    .eq('creator_id', creatorId)
    .maybeSingle();
  if (existing) return existing as ReferralPartner;

  const { data, error } = await db
    .from('rrg_referral_partners')
    .insert({
      partner_type:   'creator',
      creator_id:     creatorId,
      agent_id:       null,
      wallet_address: walletAddress.toLowerCase(),
      referral_code:  await uniqueReferralCode(),
      status:         'active',
      commission_bps: 1000, // 10% of platform share
    })
    .select()
    .single();

  if (error) {
    console.error('[referral] registerPartner error:', error);
    return null;
  }
  return data as ReferralPartner;
}

/**
 * Register an AI agent as a referral partner.
 * Returns the existing partner if already registered (by agent_id OR by wallet).
 *
 * Agents earn the same default commission (10% of platform share) as human
 * creators. The partner is keyed by `agent_id` (agent_agents.id) and uses
 * the agent's wallet for payouts via auto-payout.ts.
 */
export async function registerAgentPartner(
  agentId: string,
  walletAddress: string,
): Promise<ReferralPartner | null> {
  // Look up by agent_id first, then by wallet (handles wallet-only callers)
  const wallet = walletAddress.toLowerCase();
  const { data: byAgent } = await db
    .from('rrg_referral_partners')
    .select('*')
    .eq('agent_id', agentId)
    .maybeSingle();
  if (byAgent) return byAgent as ReferralPartner;

  const { data: byWallet } = await db
    .from('rrg_referral_partners')
    .select('*')
    .eq('wallet_address', wallet)
    .maybeSingle();
  if (byWallet) return byWallet as ReferralPartner;

  const { data, error } = await db
    .from('rrg_referral_partners')
    .insert({
      partner_type:   'agent',
      creator_id:     null,
      agent_id:       agentId,
      wallet_address: wallet,
      referral_code:  await uniqueReferralCode(),
      status:         'active',
      commission_bps: 1000,
    })
    .select()
    .single();

  if (error) {
    console.error('[referral] registerAgentPartner error:', error);
    return null;
  }
  return data as ReferralPartner;
}

/**
 * Look up a partner by their referral code.
 */
export async function getPartnerByCode(code: string): Promise<ReferralPartner | null> {
  const { data } = await db
    .from('rrg_referral_partners')
    .select('*')
    .eq('referral_code', code)
    .maybeSingle();

  return data as ReferralPartner | null;
}

/**
 * Look up a partner by their creator ID.
 */
export async function getPartnerByCreatorId(creatorId: string): Promise<ReferralPartner | null> {
  const { data } = await db
    .from('rrg_referral_partners')
    .select('*')
    .eq('creator_id', creatorId)
    .maybeSingle();

  return data as ReferralPartner | null;
}

/**
 * Look up a partner by their agent ID (for agent-typed partners).
 */
export async function getPartnerByAgentId(agentId: string): Promise<ReferralPartner | null> {
  const { data } = await db
    .from('rrg_referral_partners')
    .select('*')
    .eq('agent_id', agentId)
    .maybeSingle();
  return data as ReferralPartner | null;
}

/**
 * Look up a partner by wallet address — useful for agents that authenticate
 * by signing a message from their wallet.
 */
export async function getPartnerByWallet(walletAddress: string): Promise<ReferralPartner | null> {
  const { data } = await db
    .from('rrg_referral_partners')
    .select('*')
    .eq('wallet_address', walletAddress.toLowerCase())
    .maybeSingle();
  return data as ReferralPartner | null;
}

// ── Click Tracking ───────────────────────────────────────────────────────────

/**
 * Record a referral link click. Non-blocking, never throws.
 */
export async function recordReferralClick(
  partnerCode: string,
  tokenId?: number,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  try {
    const partner = await getPartnerByCode(partnerCode);
    if (!partner || partner.status !== 'active') return;

    // Hash IP for dedup (never store raw IP)
    const ipHash = ipAddress
      ? createHash('sha256').update(ipAddress).digest('hex')
      : null;

    await db
      .from('rrg_referral_clicks')
      .insert({
        partner_id: partner.id,
        token_id: tokenId ?? null,
        ip_hash: ipHash,
        user_agent: userAgent?.slice(0, 500) ?? null,
      });

    // Increment click counter
    await db
      .from('rrg_referral_partners')
      .update({
        total_clicks: partner.total_clicks + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', partner.id);
  } catch (err) {
    console.error('[referral] recordClick error:', err);
  }
}

// ── Commission Processing ────────────────────────────────────────────────────

/**
 * Process a referral commission after a purchase.
 * Called fire-and-forget from confirm/claim routes.
 *
 * @param referralCode  - The referral code from the cookie
 * @param purchaseId    - The purchase record ID
 * @param platformUsdc  - The platform's share of revenue (commission is % of THIS, not total)
 * @param buyerWallet   - The buyer's wallet (for self-referral check)
 * @param creatorWallet - The drop creator's wallet (for self-referral check)
 */
export async function processReferralCommission(
  referralCode: string,
  purchaseId: string,
  platformUsdc: number,
  buyerWallet: string,
  creatorWallet: string,
): Promise<void> {
  try {
    const partner = await getPartnerByCode(referralCode);
    if (!partner) return;
    if (partner.status !== 'active') return;

    const partnerWallet = partner.wallet_address.toLowerCase();
    const buyerLower = buyerWallet.toLowerCase();
    const creatorLower = creatorWallet.toLowerCase();

    // Self-referral checks
    if (partnerWallet === buyerLower) {
      console.log('[referral] blocked: partner is the buyer');
      return;
    }
    if (partnerWallet === creatorLower) {
      console.log('[referral] blocked: partner is the creator');
      return;
    }

    // No commission on $0 platform share
    if (platformUsdc <= 0) return;

    // Calculate commission: 10% of platform share
    const commissionBps = partner.commission_bps;
    const commissionUsdc = parseFloat(((platformUsdc * commissionBps) / 10000).toFixed(6));

    // Insert commission record
    await db
      .from('rrg_referral_commissions')
      .insert({
        partner_id: partner.id,
        purchase_id: purchaseId,
        revenue_usdc: platformUsdc,
        commission_bps: commissionBps,
        commission_usdc: commissionUsdc,
        status: 'pending',
        notes: `Referral purchase by ${buyerLower.slice(0, 10)}…`,
      });

    // Tag the purchase record
    await db
      .from('rrg_purchases')
      .update({
        referral_partner_id: partner.id,
        referral_code: referralCode,
      })
      .eq('id', purchaseId);

    // Update partner stats
    await db
      .from('rrg_referral_partners')
      .update({
        total_conversions: partner.total_conversions + 1,
        total_commission_usdc: parseFloat(String(partner.total_commission_usdc)) + commissionUsdc,
        updated_at: new Date().toISOString(),
      })
      .eq('id', partner.id);

    console.log(
      `[referral] commission: $${commissionUsdc.toFixed(2)} for partner ${partner.referral_code} ` +
      `(${commissionBps}bps of $${platformUsdc.toFixed(2)} platform share)`,
    );
  } catch (err) {
    // Never propagate — fire-and-forget
    console.error('[referral] commission error:', err);
  }
}

// ── Partner Stats ────────────────────────────────────────────────────────────

/**
 * Get partner stats and recent commissions for the dashboard.
 */
export async function getPartnerStats(partnerId: string) {
  const { data: partner } = await db
    .from('rrg_referral_partners')
    .select('*')
    .eq('id', partnerId)
    .single();

  if (!partner) return null;

  // Get commission breakdown
  const { data: commissions } = await db
    .from('rrg_referral_commissions')
    .select('*')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(20);

  const pending = (commissions ?? [])
    .filter(c => c.status === 'pending')
    .reduce((sum, c) => sum + parseFloat(String(c.commission_usdc)), 0);

  const paid = (commissions ?? [])
    .filter(c => c.status === 'paid')
    .reduce((sum, c) => sum + parseFloat(String(c.commission_usdc)), 0);

  return {
    partner: partner as ReferralPartner,
    commissions: (commissions ?? []) as ReferralCommission[],
    pendingUsdc: pending,
    paidUsdc: paid,
  };
}
