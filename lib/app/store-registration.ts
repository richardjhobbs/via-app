/**
 * Agent self-serve store registration with a 24-hour moderation window.
 *
 * The web onboard wizard (app/api/seller/auth/register) provisions a thirdweb
 * in-app wallet and goes live immediately. This module is the agent-native
 * path: an autonomous agent registers a store over the central MCP
 * (app.getvia.xyz/mcp register_store) using two of its OWN EOAs and waits for
 * a human to approve it.
 *
 *   wallet_address       = the agent's payout wallet (USDC lands here)
 *   agent_wallet_address = the agent's identity EOA (ERC-8004 holder)
 *
 * No thirdweb dependency. The 2.5% network fee is structural and unchanged:
 * registerDrop is always called with creator = PLATFORM_WALLET (lib/app/
 * splits.ts), so the payout wallet the agent supplies never affects the split.
 *
 * Stores are created PENDING and inactive. list_sellers / find_seller and the
 * per-seller MCP all filter active=true, so a pending store is invisible until
 * approveAgentStore flips it live. The ERC-8004 mint is deferred to approval so
 * rejected / spam submissions never spend registrar gas.
 */

import { ethers } from 'ethers';
import { db } from './db';
import { supabaseAdmin } from './seller-auth';
import { registerAgentIdentity } from '@/lib/agent/erc8004';
import { shouldSkipErc8004, syntheticTestAgentId } from './test-mode';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');
const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h review SLA

export interface CreatePendingStoreInput {
  storeName:    string;
  slug?:        string;
  kind:         string;
  description?: string | null;
  headline?:    string | null;
  websiteUrl?:  string | null;
  payoutWallet: string;
  agentWallet:  string;
  email:        string;
  password:     string;
}

export type CreatePendingStoreResult =
  | { ok: true; slug: string; status: 'pending'; approval_eligible_at: string; dashboard_url: string }
  | { ok: false; code: string; error: string };

function normaliseSlug(input: string | undefined, fallback: string): string {
  return (input || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Create a pending agent store. Validates input, creates an auto-confirmed
 * Supabase auth user (so the agent's operator can log into the dashboard once
 * approved), and inserts an inactive app_sellers row in 'pending'. Does NOT
 * mint ERC-8004 — that happens in approveAgentStore.
 */
export async function createPendingAgentStore(
  input: CreatePendingStoreInput,
): Promise<CreatePendingStoreResult> {
  const email        = String(input.email ?? '').trim().toLowerCase();
  const password     = String(input.password ?? '');
  const storeName    = String(input.storeName ?? '').trim();
  const kind         = String(input.kind ?? '');
  const description  = input.description ? String(input.description).trim() : null;
  const headline     = input.headline    ? String(input.headline).trim()    : null;
  const websiteUrl   = input.websiteUrl  ? String(input.websiteUrl).trim()   : null;
  const payoutWallet = String(input.payoutWallet ?? '').trim();
  const agentWallet  = String(input.agentWallet ?? '').trim();

  // ── Validate ────────────────────────────────────────────────────────
  if (!email || !email.includes('@'))                return { ok: false, code: 'invalid_email',    error: 'A valid contact email is required. The operator behind this agent uses it to manage the store once approved.' };
  if (!password || password.length < 8)              return { ok: false, code: 'weak_password',    error: 'password must be 8+ characters. Keep it: it is the dashboard login for this store.' };
  if (!storeName)                                    return { ok: false, code: 'missing_name',      error: 'store_name is required.' };
  if (!['product', 'service', 'mixed'].includes(kind)) return { ok: false, code: 'invalid_kind',   error: "kind must be 'product', 'service', or 'mixed'." };
  if (!ethers.isAddress(payoutWallet))               return { ok: false, code: 'invalid_payout_wallet', error: 'payout_wallet is not a valid Base/EVM address.' };
  if (!ethers.isAddress(agentWallet))                return { ok: false, code: 'invalid_agent_wallet',  error: 'agent_wallet is not a valid Base/EVM address.' };
  if (payoutWallet.toLowerCase() === agentWallet.toLowerCase()) {
    return { ok: false, code: 'wallets_must_differ', error: 'payout_wallet and agent_wallet must be two different EOAs. The payout wallet receives USDC; the agent wallet holds the ERC-8004 identity.' };
  }

  const payout = payoutWallet.toLowerCase();
  const agent  = agentWallet.toLowerCase();
  const slug   = normaliseSlug(input.slug, storeName);
  if (!slug) return { ok: false, code: 'invalid_slug', error: 'store_name must contain alphanumeric characters.' };

  // ── Slug uniqueness ─────────────────────────────────────────────────
  const { data: existingSlug } = await db.from('app_sellers').select('id').eq('slug', slug).maybeSingle();
  if (existingSlug) {
    return { ok: false, code: 'slug_taken', error: `slug "${slug}" is already taken. Choose a different store_name or pass an explicit slug.` };
  }

  // ── Create or recover the auth user ─────────────────────────────────
  let userId: string;
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: 'via_agent_mcp', wallet_address: payout, agent_wallet_address: agent },
  });

  if (createErr) {
    // Email already exists. Only reuse it if it owns no seller yet; never reset
    // a password from an unauthenticated call (account-takeover guard).
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const found = list?.users?.find((u: { email?: string | null; id: string }) => u.email?.toLowerCase() === email);
    if (!found) return { ok: false, code: 'account_error', error: 'Could not create or find an account for this email.' };

    const { data: priorSeller } = await db.from('app_sellers').select('slug').eq('owner_user_id', found.id).maybeSingle();
    if (priorSeller) {
      return { ok: false, code: 'email_owns_store', error: `This email already owns "${priorSeller.slug}". Use that store, or register with a different email.` };
    }
    userId = found.id;
  } else {
    userId = created.user.id;
  }

  // ── Insert the pending, inactive seller row ─────────────────────────
  const now      = new Date();
  const eligible = new Date(now.getTime() + APPROVAL_WINDOW_MS);

  const { data: seller, error: sellerErr } = await db
    .from('app_sellers')
    .insert({
      slug,
      name:                 storeName,
      kind,
      contact_email:        email,
      owner_user_id:        userId,
      website_url:          websiteUrl,
      description,
      headline,
      wallet_address:       payout,
      agent_wallet_address: agent,
      active:               false,
      approval_status:      'pending',
      created_via:          'agent_mcp',
      submitted_at:         now.toISOString(),
      approval_eligible_at: eligible.toISOString(),
    })
    .select('id, slug')
    .single();

  if (sellerErr || !seller) {
    if (sellerErr?.code === '23505') {
      return { ok: false, code: 'slug_taken', error: 'slug taken (race). Pick a different store_name.' };
    }
    console.error('[store-registration] insert failed', sellerErr);
    return { ok: false, code: 'insert_failed', error: 'Failed to create the store record.' };
  }

  return {
    ok:                   true,
    slug:                 seller.slug,
    status:               'pending',
    approval_eligible_at: eligible.toISOString(),
    dashboard_url:        `${APP_BASE}/seller/${seller.slug}/admin`,
  };
}

export interface ApproveAgentStoreResult {
  ok:                boolean;
  slug:              string;
  erc8004_agent_id?: string | null;
  mcp_url?:          string;
  mint_error?:      string;
  error?:            string;
}

/**
 * Approve a pending agent store: flip it active, then mint its ERC-8004
 * identity against the agent's own wallet. Mint failure is non-fatal — the
 * store is live and the mint can be retried — but it is surfaced so the
 * operator sees the gap.
 */
export async function approveAgentStore(slug: string, reviewedBy: string): Promise<ApproveAgentStoreResult> {
  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, contact_email, agent_wallet_address, approval_status, erc8004_agent_id')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !seller)                       return { ok: false, slug, error: `store "${slug}" not found` };
  if (seller.approval_status === 'approved')  return { ok: false, slug, error: `store "${slug}" is already approved` };
  if (seller.approval_status !== 'pending')   return { ok: false, slug, error: `store "${slug}" is not pending (status: ${seller.approval_status ?? 'none'})` };

  const { error: updErr } = await db
    .from('app_sellers')
    .update({
      active:          true,
      approval_status: 'approved',
      reviewed_at:     new Date().toISOString(),
      reviewed_by:     reviewedBy,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', seller.id);
  if (updErr) return { ok: false, slug, error: `failed to activate store: ${updErr.message}` };

  // ── ERC-8004 mint against the agent's own wallet ────────────────────
  const mcpUrl = `${APP_BASE}/sellers/${seller.slug}/mcp`;
  if (shouldSkipErc8004(seller.contact_email)) {
    const placeholder = syntheticTestAgentId();
    await db.from('app_sellers').update({ erc8004_agent_id: placeholder }).eq('id', seller.id);
    return { ok: true, slug: seller.slug, erc8004_agent_id: placeholder, mcp_url: mcpUrl };
  }

  try {
    const { tokenId, txHash } = await registerAgentIdentity(
      seller.id,
      `${seller.name} Sales Agent`,
      seller.agent_wallet_address as string,
      'sales_agent',
    );
    const agentId = tokenId.toString();
    await db.from('app_sellers').update({ erc8004_agent_id: agentId }).eq('id', seller.id);
    console.log(`[store-registration] approved + minted seller=${seller.slug} tokenId=${agentId} tx=${txHash}`);
    return { ok: true, slug: seller.slug, erc8004_agent_id: agentId, mcp_url: mcpUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[store-registration] approve mint failed seller=${seller.slug}:`, msg);
    // Store is live; mint can be retried from the dashboard / admin.
    return { ok: true, slug: seller.slug, erc8004_agent_id: null, mcp_url: mcpUrl, mint_error: msg };
  }
}

/** Reject a pending agent store. It stays inactive and invisible. */
export async function rejectAgentStore(slug: string, reason: string, reviewedBy: string): Promise<{ ok: boolean; slug: string; error?: string }> {
  const cleanReason = reason.trim().slice(0, 120) || 'does not meet quality guidelines';
  const { data, error } = await db
    .from('app_sellers')
    .update({
      active:          false,
      approval_status: `rejected:${cleanReason}`,
      reviewed_at:     new Date().toISOString(),
      reviewed_by:     reviewedBy,
      updated_at:      new Date().toISOString(),
    })
    .eq('slug', slug)
    .eq('approval_status', 'pending')
    .select('slug')
    .maybeSingle();
  if (error)  return { ok: false, slug, error: error.message };
  if (!data)  return { ok: false, slug, error: `store "${slug}" not found or not pending` };
  return { ok: true, slug: data.slug };
}
