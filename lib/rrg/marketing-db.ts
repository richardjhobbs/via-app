/**
 * Agent Marketing System — Database types + query helpers
 *
 * Tables use 'mkt_' prefix. All queries use the shared Supabase client from db.ts.
 * See scripts/marketing-schema.sql for the CREATE TABLE statements.
 */

import { db } from './db';

// ── Types ──────────────────────────────────────────────────────────────────

export type MktAgentStatus = 'active' | 'paused' | 'retired';
export type CandidateTier = 'hot' | 'warm' | 'cold' | 'disqualified';
export type DiscoverySource =
  | 'chain_scan' | 'mcp_log' | 'manual' | 'referral' | 'registry'
  | 'mcp_registry' | 'olas_registry' | 'a2a_crawl' | 'astrasync'
  | 'rnwy' | 'agentscan' | 'virtuals' | 'ag0_sdk' | 'clawplaza' | '8004scan';
export type OutreachChannel = 'x402_ping' | 'a2a' | 'mcp' | 'email' | 'manual';
export type OutreachStatus = 'pending' | 'contacted' | 'engaged' | 'converted' | 'declined' | 'unresponsive';
export type MessageType =
  | 'intro' | 'follow_up' | 'offer' | 'reminder'
  | 'brand_intro' | 'full_catalogue' | 'product_drop' | 'restock';
export type MessageStatus = 'sent' | 'delivered' | 'opened' | 'replied' | 'bounced' | 'failed';
export type ConversionAction = 'mcp_connect' | 'browse' | 'submit_design' | 'purchase' | 'register_brand';
export type Attribution = 'direct' | 'assisted' | 'organic';
export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'rejected';
export type DiscoveryRunStatus = 'running' | 'completed' | 'failed';

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface MktAgent {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  wallet_address: string;
  erc8004_id: number | null;
  status: MktAgentStatus;
  commission_bps: number;
  max_daily_outreach: number;
  capabilities: string[];
  total_candidates_found: number;
  total_outreach_sent: number;
  total_conversions: number;
  total_commission_usdc: number;
}

export interface MktCandidate {
  id: string;
  created_at: string;
  updated_at: string;
  chain: string;
  wallet_address: string | null;
  erc8004_id: number | null;
  name: string | null;
  platform: string | null;
  metadata_url: string | null;
  discovered_by: string | null;
  discovery_run: string | null;
  discovery_source: DiscoverySource;
  score: number;
  tier: CandidateTier;
  scoring_notes: string | null;
  on_chain_txns: number;
  has_wallet: boolean;
  has_usdc: boolean;
  has_image_gen: boolean;
  has_mcp: boolean;
  has_a2a: boolean;
  erc8004_trust: string | null;
  outreach_status: OutreachStatus;
  last_contacted: string | null;
  contact_count: number;
  // Added by scan
  description: string | null;
  reachable: boolean;
  verified_endpoint: string | null;
  // Enhanced intel fields
  owner_email: string | null;
  owner_website: string | null;
  owner_socials: Record<string, string>;
  agent_tools: Array<{ name: string; description: string }>;
  agent_capabilities: string[];
  // RNWY commerce enrichment (April 2026)
  rnwy_overall_score: number | null;
  rnwy_commerce_score: number | null;
  rnwy_commerce_jobs: number | null;
  rnwy_commerce_revenue_usd: number | null;
  rnwy_sybil_severity: string | null;
  rnwy_sybil_signals: string[] | null;
  rnwy_badges: string[] | null;
  rnwy_tx_backed_review_pct: number | null;
  rnwy_enriched_at: string | null;
}

export interface MktDiscoveryRun {
  id: string;
  created_at: string;
  completed_at: string | null;
  marketing_agent: string;
  source: string;
  chain: string;
  status: DiscoveryRunStatus;
  agents_scanned: number;
  new_candidates: number;
  updated_candidates: number;
  notes: string | null;
}

/**
 * A reference to a product (or specific variant) featured in an outreach
 * message. Stored as JSON inside mkt_outreach.product_refs so a single
 * outreach record can pitch multiple SKUs (full-catalogue runs) or a single
 * variant (restock alerts).
 */
export interface MktProductRef {
  /** rrg_submissions.id (the drop row) */
  drop_id: string;
  /** rrg_submissions.token_id if minted on-chain */
  token_id?: number | null;
  title: string;
  price_usdc: string;
  /** rrg_product_variants.id if the message pitches a specific size/colour */
  variant_id?: string | null;
  variant_label?: string | null;
  /** Optional pre-built x402 / AP2 payment URI for one-shot agent purchase */
  x402_uri?: string | null;
}

export interface MktOutreach {
  id: string;
  created_at: string;
  candidate_id: string;
  marketing_agent: string;
  channel: OutreachChannel;
  message_type: MessageType;
  message_body: string | null;
  message_hash: string | null;
  status: MessageStatus;
  response_body: string | null;
  responded_at: string | null;
  cost_usdc: number;
  /** Brand this outreach is about. NULL for platform-recruitment messages. */
  brand_id: string | null;
  /** Products / variants featured in the message body. Empty for non-brand outreach. */
  product_refs: MktProductRef[];
  /** Campaign that scheduled this outreach. NULL for ad-hoc single sends. */
  campaign_id: string | null;
}

export interface MktConversion {
  id: string;
  created_at: string;
  candidate_id: string;
  marketing_agent: string;
  action: ConversionAction;
  action_ref: string | null;
  outreach_id: string | null;
  attribution: Attribution;
  revenue_usdc: number;
  /** Brand the conversion is attributed to. NULL for platform-only actions. */
  brand_id: string | null;
}

export interface MktCommission {
  id: string;
  created_at: string;
  marketing_agent: string;
  conversion_id: string | null;
  candidate_id: string | null;
  revenue_usdc: number;
  commission_bps: number;
  commission_usdc: number;
  status: CommissionStatus;
  paid_at: string | null;
  tx_hash: string | null;
  notes: string | null;
}

// ── Marketing Agent helpers ────────────────────────────────────────────────

export async function getMarketingAgent(id: string): Promise<MktAgent | null> {
  const { data } = await db
    .from('mkt_agents')
    .select('*')
    .eq('id', id)
    .single();
  return data ?? null;
}

export async function getMarketingAgentByWallet(wallet: string): Promise<MktAgent | null> {
  const { data } = await db
    .from('mkt_agents')
    .select('*')
    .eq('wallet_address', wallet)
    .single();
  return data ?? null;
}

export async function getActiveMarketingAgents(): Promise<MktAgent[]> {
  const { data } = await db
    .from('mkt_agents')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  return data ?? [];
}

export async function updateMarketingAgentStats(
  agentId: string,
  updates: Partial<Pick<MktAgent, 'total_candidates_found' | 'total_outreach_sent' | 'total_conversions' | 'total_commission_usdc'>>,
): Promise<void> {
  await db
    .from('mkt_agents')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', agentId);
}

// ── Candidate helpers ──────────────────────────────────────────────────────

export async function getCandidateByWallet(wallet: string): Promise<MktCandidate | null> {
  const { data } = await db
    .from('mkt_candidates')
    .select('*')
    .eq('wallet_address', wallet)
    .order('score', { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

export async function getCandidateByErc8004Id(agentId: number, chain = 'base'): Promise<MktCandidate | null> {
  const { data } = await db
    .from('mkt_candidates')
    .select('*')
    .eq('erc8004_id', agentId)
    .eq('chain', chain)
    .single();
  return data ?? null;
}

export async function getCandidatesByTier(tier: CandidateTier): Promise<MktCandidate[]> {
  const { data } = await db
    .from('mkt_candidates')
    .select('*')
    .eq('tier', tier)
    .order('score', { ascending: false });
  return data ?? [];
}

export async function getCandidatesForOutreach(
  tier?: CandidateTier,
  limit = 20,
): Promise<MktCandidate[]> {
  let query = db
    .from('mkt_candidates')
    .select('*')
    .eq('outreach_status', 'pending')
    .neq('tier', 'disqualified')
    // Only target verified reachable agents
    .eq('reachable', true);

  if (tier) {
    query = query.eq('tier', tier);
  }

  const { data } = await query
    .order('score', { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * Get candidates for re-contact — previously contacted agents who should
 * receive the updated outreach message.
 */
export async function getCandidatesForResend(
  limit = 20,
): Promise<MktCandidate[]> {
  const { data } = await db
    .from('mkt_candidates')
    .select('*')
    .eq('outreach_status', 'contacted')
    .eq('reachable', true)
    .neq('tier', 'disqualified')
    .order('last_contacted', { ascending: true })
    .limit(limit);
  return data ?? [];
}

export async function upsertCandidate(
  candidate: Partial<MktCandidate> & { wallet_address?: string; erc8004_id?: number },
): Promise<{ data: MktCandidate | null; error: string | null }> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('mkt_candidates')
    .upsert(
      {
        ...candidate,
        updated_at: now,
        ...(candidate.created_at ? {} : { created_at: now }),
      },
      { onConflict: candidate.wallet_address ? 'wallet_address' : 'erc8004_id' },
    )
    .select()
    .single();
  return {
    data: data ?? null,
    error: error ? `upsert failed: ${error.message} (code: ${error.code})` : null,
  };
}

export async function getCandidatesPaginated(
  page: number,
  perPage: number,
  filters?: {
    tier?: CandidateTier;
    outreach_status?: OutreachStatus;
    discovery_source?: DiscoverySource;
    min_score?: number;
    chain?: string;
    reachable?: boolean;
  },
): Promise<{ candidates: MktCandidate[]; totalCount: number }> {
  const offset = (page - 1) * perPage;

  let query = db
    .from('mkt_candidates')
    .select('*', { count: 'exact' });

  if (filters?.tier) query = query.eq('tier', filters.tier);
  if (filters?.outreach_status) query = query.eq('outreach_status', filters.outreach_status);
  if (filters?.discovery_source) query = query.eq('discovery_source', filters.discovery_source);
  if (filters?.min_score) query = query.gte('score', filters.min_score);
  if (filters?.chain) query = query.eq('chain', filters.chain);
  if (filters?.reachable !== undefined) query = query.eq('reachable', filters.reachable);

  const { data, count } = await query
    .order('score', { ascending: false })
    .range(offset, offset + perPage - 1);

  return { candidates: data ?? [], totalCount: count ?? 0 };
}

// ── Discovery Run helpers ──────────────────────────────────────────────────

export async function createDiscoveryRun(
  marketingAgentId: string,
  source: string,
  chain = 'base',
): Promise<MktDiscoveryRun | null> {
  const { data } = await db
    .from('mkt_discovery_runs')
    .insert({ marketing_agent: marketingAgentId, source, chain })
    .select()
    .single();
  return data ?? null;
}

export async function completeDiscoveryRun(
  runId: string,
  results: { agents_scanned: number; new_candidates: number; updated_candidates: number; notes?: string },
): Promise<void> {
  await db
    .from('mkt_discovery_runs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      ...results,
    })
    .eq('id', runId);
}

export async function failDiscoveryRun(runId: string, notes: string): Promise<void> {
  await db
    .from('mkt_discovery_runs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      notes,
    })
    .eq('id', runId);
}

export async function getRecentDiscoveryRuns(limit = 10): Promise<MktDiscoveryRun[]> {
  const { data } = await db
    .from('mkt_discovery_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * Prune old discovery runs — keep only the most recent N per source.
 * Prevents unbounded table growth.
 */
export async function pruneDiscoveryRuns(keepPerSource = 50): Promise<number> {
  // Get all distinct sources
  const { data: sources } = await db
    .from('mkt_discovery_runs')
    .select('source')
    .limit(100);

  if (!sources) return 0;

  const uniqueSources = [...new Set(sources.map(s => s.source))];
  let totalDeleted = 0;

  for (const source of uniqueSources) {
    // Get the Nth newest run for this source (the cutoff)
    const { data: cutoffRuns } = await db
      .from('mkt_discovery_runs')
      .select('created_at')
      .eq('source', source)
      .order('created_at', { ascending: false })
      .range(keepPerSource - 1, keepPerSource - 1);

    if (!cutoffRuns || cutoffRuns.length === 0) continue;

    const cutoffDate = cutoffRuns[0].created_at;

    // Delete runs older than the cutoff
    const { count } = await db
      .from('mkt_discovery_runs')
      .delete({ count: 'exact' })
      .eq('source', source)
      .lt('created_at', cutoffDate);

    totalDeleted += count ?? 0;
  }

  return totalDeleted;
}

// ── Outreach helpers ───────────────────────────────────────────────────────

export async function createOutreach(
  outreach:
    & Omit<MktOutreach, 'id' | 'created_at' | 'status' | 'response_body' | 'responded_at' | 'brand_id' | 'product_refs' | 'campaign_id'>
    & Partial<Pick<MktOutreach, 'brand_id' | 'product_refs' | 'campaign_id'>>,
): Promise<MktOutreach | null> {
  const { data } = await db
    .from('mkt_outreach')
    .insert({
      brand_id: null,
      product_refs: [],
      campaign_id: null,
      ...outreach,
    })
    .select()
    .single();
  return data ?? null;
}

export async function updateOutreachStatus(
  outreachId: string,
  status: MessageStatus,
  responseBody?: string,
): Promise<void> {
  await db
    .from('mkt_outreach')
    .update({
      status,
      ...(responseBody ? { response_body: responseBody, responded_at: new Date().toISOString() } : {}),
    })
    .eq('id', outreachId);
}

export async function getOutreachForCandidate(candidateId: string): Promise<MktOutreach[]> {
  const { data } = await db
    .from('mkt_outreach')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function getTodayOutreachCount(marketingAgentId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count } = await db
    .from('mkt_outreach')
    .select('id', { count: 'exact', head: true })
    .eq('marketing_agent', marketingAgentId)
    .gte('created_at', today.toISOString());

  return count ?? 0;
}

// ── Conversion helpers ─────────────────────────────────────────────────────

export async function recordConversion(
  conversion:
    & Omit<MktConversion, 'id' | 'created_at' | 'brand_id'>
    & Partial<Pick<MktConversion, 'brand_id'>>,
): Promise<MktConversion | null> {
  const { data } = await db
    .from('mkt_conversions')
    .insert({ brand_id: null, ...conversion })
    .select()
    .single();
  return data ?? null;
}

export async function getConversionsForCandidate(candidateId: string): Promise<MktConversion[]> {
  const { data } = await db
    .from('mkt_conversions')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function getConversionsByAgent(
  marketingAgentId: string,
  limit = 50,
): Promise<MktConversion[]> {
  const { data } = await db
    .from('mkt_conversions')
    .select('*')
    .eq('marketing_agent', marketingAgentId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

// ── Commission helpers ─────────────────────────────────────────────────────

export async function createCommission(
  commission: Omit<MktCommission, 'id' | 'created_at' | 'paid_at' | 'tx_hash'>,
): Promise<MktCommission | null> {
  const { data } = await db
    .from('mkt_commissions')
    .insert(commission)
    .select()
    .single();
  return data ?? null;
}

export async function getCommissionsByAgent(
  marketingAgentId: string,
  status?: CommissionStatus,
): Promise<MktCommission[]> {
  let query = db
    .from('mkt_commissions')
    .select('*')
    .eq('marketing_agent', marketingAgentId);

  if (status) {
    query = query.eq('status', status);
  }

  const { data } = await query.order('created_at', { ascending: false });
  return data ?? [];
}

export async function markCommissionPaid(
  commissionId: string,
  txHash: string,
): Promise<void> {
  await db
    .from('mkt_commissions')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      tx_hash: txHash,
    })
    .eq('id', commissionId);
}

export async function getPendingCommissionTotal(
  marketingAgentId: string,
): Promise<number> {
  const { data } = await db
    .from('mkt_commissions')
    .select('commission_usdc')
    .eq('marketing_agent', marketingAgentId)
    .in('status', ['pending', 'approved']);

  let total = 0;
  for (const c of data ?? []) {
    total += parseFloat(String(c.commission_usdc ?? '0'));
  }
  return total;
}

// ── Dashboard stats ────────────────────────────────────────────────────────

export async function getMarketingDashboardStats(): Promise<{
  totalCandidates: number;
  reachableCount: number;
  unreachableCount: number;
  byOutreachStatus: Record<OutreachStatus, number>;
  totalOutreachSent: number;
  totalConversions: number;
  totalCommissionUsdc: number;
  pendingCommissionUsdc: number;
}> {
  // Total candidates (exact count, no row limit)
  const { count: totalCandidates } = await db
    .from('mkt_candidates')
    .select('id', { count: 'exact', head: true });

  // Reachable count
  const { count: reachableCount } = await db
    .from('mkt_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('reachable', true);

  // Count per outreach status (only for reachable agents)
  const statuses: OutreachStatus[] = ['pending', 'contacted', 'engaged', 'converted', 'declined', 'unresponsive'];
  const byOutreachStatus: Record<OutreachStatus, number> = {
    pending: 0, contacted: 0, engaged: 0, converted: 0, declined: 0, unresponsive: 0,
  };
  for (const status of statuses) {
    const { count } = await db
      .from('mkt_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('outreach_status', status)
      .eq('reachable', true);
    byOutreachStatus[status] = count ?? 0;
  }

  // Outreach count
  const { count: totalOutreachSent } = await db
    .from('mkt_outreach')
    .select('id', { count: 'exact', head: true });

  // Conversions count
  const { count: totalConversions } = await db
    .from('mkt_conversions')
    .select('id', { count: 'exact', head: true });

  // Commission totals
  const { data: commissions } = await db
    .from('mkt_commissions')
    .select('commission_usdc, status');

  let totalCommissionUsdc = 0;
  let pendingCommissionUsdc = 0;
  for (const c of commissions ?? []) {
    const amt = parseFloat(String(c.commission_usdc ?? '0'));
    totalCommissionUsdc += amt;
    if (c.status === 'pending' || c.status === 'approved') {
      pendingCommissionUsdc += amt;
    }
  }

  return {
    totalCandidates: totalCandidates ?? 0,
    reachableCount: reachableCount ?? 0,
    unreachableCount: (totalCandidates ?? 0) - (reachableCount ?? 0),
    byOutreachStatus,
    totalOutreachSent: totalOutreachSent ?? 0,
    totalConversions: totalConversions ?? 0,
    totalCommissionUsdc,
    pendingCommissionUsdc,
  };
}
