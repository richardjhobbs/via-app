import { NextRequest, NextResponse } from 'next/server';
import { setBrandAuthCookies, supabaseAdmin } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { mintBuyerIdentity } from '@/lib/app/buyer-identity';
import { deriveAgentWallet, platformAgentWalletsEnabled } from '@/lib/app/agent-wallet';
import { shouldSkipErc8004, syntheticTestAgentId } from '@/lib/app/test-mode';
import { grantWelcomeCredits } from '@/lib/app/buyer-credits';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

/**
 * POST /api/buyer/auth/register — self-serve Buying Agent onboarding commit.
 *
 * Body:
 *   {
 *     email:              string,
 *     password:           string,    // 8+ chars
 *     handle:             string,    // pre-validated client-side, normalised here
 *     displayName:        string,
 *     walletAddress:      string,    // buyer's funding wallet (x402 payments come from here)
 *   }
 *   (agentWalletAddress is no longer accepted: the Buying Agent's identity wallet
 *    is always platform-derived from AGENT_WALLET_SEED.)
 *
 * Creates Supabase Auth user (auto-confirmed), signs them in, inserts an
 * app_buyers row (wallet_address = the human's funding wallet), then mints the
 * ERC-8004 identity to a platform-DERIVED agent wallet via mintBuyerIdentity.
 * Mint is awaited; failure rolls back the buyer row.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const email              = String(body.email ?? '').trim().toLowerCase();
  const password           = String(body.password ?? '');
  const handleInput        = String(body.handle ?? '').trim().toLowerCase();
  const displayName        = String(body.displayName ?? '').trim();
  const walletAddress      = String(body.walletAddress ?? '').trim();
  // body.agentWalletAddress is intentionally NOT read: the Buying Agent's identity
  // wallet is always platform-derived from AGENT_WALLET_SEED (see mintBuyerIdentity).

  if (!email || !email.includes('@'))             return NextResponse.json({ error: 'valid email required' },          { status: 400 });
  if (!password || password.length < 8)           return NextResponse.json({ error: 'password must be 8+ characters' }, { status: 400 });
  if (!displayName)                               return NextResponse.json({ error: 'display name required' },          { status: 400 });
  if (!ethers.isAddress(walletAddress)) return NextResponse.json({ error: 'invalid wallet address' }, { status: 400 });
  // The funding wallet (where the owner holds the USDC their agent spends, via
  // thirdweb or an external wallet) is the human's. The AGENT identity wallet is
  // SEPARATE and platform-derived. Fail closed if the seed is unconfigured.
  const funding = walletAddress.toLowerCase();
  if (!shouldSkipErc8004(email) && !platformAgentWalletsEnabled()) {
    return NextResponse.json({ error: 'platform-managed identity wallets are not enabled; contact VIA' }, { status: 503 });
  }

  const handle = handleInput
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  if (!handle) return NextResponse.json({ error: 'handle must contain alphanumeric characters' }, { status: 400 });

  // Handle uniqueness check
  const { data: existing } = await db.from('app_buyers').select('id').eq('handle', handle).maybeSingle();
  if (existing) return NextResponse.json({ error: `handle "${handle}" already taken` }, { status: 409 });

  let userId: string;
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: 'via_app_onboard_buyer', wallet_address: funding, agent_wallet_address: null },
  });

  if (createErr) {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const found = list?.users?.find((u: { email?: string | null; id: string }) => u.email?.toLowerCase() === email);
    if (!found) return NextResponse.json({ error: 'could not create or find user account' }, { status: 500 });
    const { data: priorBuyer } = await db.from('app_buyers').select('handle').eq('owner_user_id', found.id).maybeSingle();
    if (priorBuyer) return NextResponse.json({ error: `this email already owns "${priorBuyer.handle}", sign in instead` }, { status: 409 });
    // Account exists for this email but owns no buyer profile (e.g. a seller
    // account). Do NOT reset its password: an unauthenticated request must
    // never take over an existing account. Reuse it only if the supplied
    // password authenticates in the sign-in step below.
    userId = found.id;
  } else {
    userId = created.user.id;
  }

  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session) {
    console.error('[onboard/buyer/register] signIn failed', signInErr);
    return NextResponse.json({ error: 'this email may already have an account. Sign in with your existing password, or use Login.' }, { status: 401 });
  }

  const { data: buyer, error: buyerErr } = await db
    .from('app_buyers')
    .insert({
      handle,
      owner_user_id:        userId,
      display_name:         displayName,
      wallet_address:       funding,
      agent_wallet_address: null,
      public:               false,
    })
    .select('id, handle, display_name')
    .single();

  if (buyerErr || !buyer) {
    console.error('[onboard/buyer/register] app_buyers insert failed', buyerErr);
    if (buyerErr?.code === '23505') return NextResponse.json({ error: 'handle taken (race)' }, { status: 409 });
    return NextResponse.json({ error: 'failed to create buyer record' }, { status: 500 });
  }

  // The Buying Agent identity wallet is platform-derived; the ERC-8004 identity
  // is minted to it ON REGISTRATION (awaited). The human's funding wallet stays
  // on wallet_address. mintBuyerIdentity derives the dedicated wallet (it sees
  // agent_wallet_address=null), links-or-mints, and is idempotent. If it fails we
  // roll back the buyer row so a retry works. Test-mode writes a synthetic
  // placeholder + derived wallet and skips the on-chain mint (lib/app/test-mode.ts).
  if (shouldSkipErc8004(email)) {
    const placeholder = syntheticTestAgentId();
    const derived = deriveAgentWallet(buyer.id);
    await db.from('app_buyers')
      .update({ erc8004_agent_id: placeholder, ...(derived ? { agent_wallet_address: derived.address.toLowerCase() } : {}) })
      .eq('id', buyer.id);
    console.log(`[onboard/buyer/register] TEST MODE — skipped ERC-8004 mint for handle=${buyer.handle}, placeholder=${placeholder}`);
  } else {
    const mint = await mintBuyerIdentity(buyer.id, 'web_onboard');
    if (!mint.ok) {
      console.error(`[onboard/buyer/register] erc8004 mint failed handle=${buyer.handle}: ${mint.error}`);
      // Roll back the half-created buyer so a retry with the same handle works
      // (the auth user is reused by the existing-account recovery path above).
      await db.from('app_buyers').delete().eq('id', buyer.id);
      return NextResponse.json({ error: 'Could not mint your Buying Agent identity right now. Please retry in a moment.' }, { status: 502 });
    }
    console.log(`[onboard/buyer/register] erc8004 mint ok handle=${buyer.handle} id=${mint.erc8004_agent_id} wallet=${mint.agent_wallet_address}`);
  }

  // Welcome / CAC grant: 1,000 credits (1.0 USD) to fund the agent's DeepSeek
  // usage. Non-fatal , a missed grant must not fail an otherwise-good signup
  // (it is idempotent and can be re-granted).
  try {
    await grantWelcomeCredits(buyer.id);
  } catch (err) {
    console.error(`[onboard/buyer/register] welcome-credit grant failed handle=${buyer.handle}:`, err);
  }

  const response = NextResponse.json({
    buyer: { id: buyer.id, handle: buyer.handle, display_name: buyer.display_name },
    redirect_to: `/buyer/${buyer.handle}/admin/buying-agent`,
  });
  setBrandAuthCookies(response, signIn.session.access_token, signIn.session.refresh_token);
  return response;
}
