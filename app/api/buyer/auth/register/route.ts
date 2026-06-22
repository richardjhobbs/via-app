import { NextRequest, NextResponse } from 'next/server';
import { setBrandAuthCookies, supabaseAdmin } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { mintBuyerIdentity } from '@/lib/app/buyer-identity';
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
 * app_buyers row (wallet_address = the buyer's in-app wallet), then mints the
 * ERC-8004 identity ONTO that same in-app wallet via mintBuyerIdentity , one
 * wallet is identity + spend + recognition + delivery. Mint is awaited; failure
 * rolls back the buyer row. (Seller identities stay on platform-derived wallets;
 * buyers do not, see lib/app/buyer-identity.ts.)
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
  // The in-app wallet (the deterministic thirdweb wallet tied to the buyer's
  // email, or the external wallet they onboarded with) is the buyer's single
  // wallet: it holds the USDC the agent spends AND carries the ERC-8004 identity.
  const inAppWallet = walletAddress.toLowerCase();

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
    user_metadata: { source: 'via_app_onboard_buyer', wallet_address: inAppWallet, agent_wallet_address: null },
  });

  if (createErr) {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const found = list?.users?.find((u: { email?: string | null; id: string }) => u.email?.toLowerCase() === email);
    if (!found) return NextResponse.json({ error: 'could not create or find user account' }, { status: 500 });
    const { data: priorBuyer } = await db.from('app_buyers').select('handle').eq('owner_user_id', found.id).maybeSingle();
    if (priorBuyer) return NextResponse.json({ error: `This email already runs the Buying Agent "${priorBuyer.handle}". Sign in instead.`, existing_account: true, owns_buyer: true, email }, { status: 409 });
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
    return NextResponse.json({ error: 'This email already has a VIA account, but that password does not match it. Sign in with your existing password, or reset it.', existing_account: true, owns_buyer: false, email }, { status: 401 });
  }

  const { data: buyer, error: buyerErr } = await db
    .from('app_buyers')
    .insert({
      handle,
      owner_user_id:        userId,
      display_name:         displayName,
      wallet_address:       inAppWallet,
      agent_wallet_address: null,
      // Discoverable by default: a Buying Agent exists to source offers, and the
      // demand feed leaks no identity (structured brief only). Owner can switch
      // to private from the dashboard.
      public:               true,
    })
    .select('id, handle, display_name')
    .single();

  if (buyerErr || !buyer) {
    console.error('[onboard/buyer/register] app_buyers insert failed', buyerErr);
    if (buyerErr?.code === '23505') return NextResponse.json({ error: 'handle taken (race)' }, { status: 409 });
    return NextResponse.json({ error: 'failed to create buyer record' }, { status: 500 });
  }

  // The ERC-8004 identity is minted ONTO the buyer's in-app wallet ON
  // REGISTRATION (awaited): one wallet is identity + spend + recognition +
  // delivery. mintBuyerIdentity reads wallet_address, links-or-mints, and is
  // idempotent. If it fails we roll back the buyer row so a retry works.
  // Test-mode writes a synthetic placeholder, sets agent_wallet_address to the
  // same in-app wallet, and skips the on-chain mint (lib/app/test-mode.ts).
  if (shouldSkipErc8004(email)) {
    const placeholder = syntheticTestAgentId();
    await db.from('app_buyers')
      .update({ erc8004_agent_id: placeholder, agent_wallet_address: inAppWallet })
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
