import { NextRequest, NextResponse } from 'next/server';
import { setBrandAuthCookies, supabaseAdmin } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { registerAgentIdentity } from '@/lib/agent/erc8004';
import { shouldSkipErc8004, syntheticTestAgentId } from '@/lib/app/test-mode';

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
 *     agentWalletAddress: string,    // Buying Agent's own EOA (thirdweb in-app wallet)
 *   }
 *
 * Creates Supabase Auth user (auto-confirmed), signs them in, inserts an
 * app_buyers row, fires ERC-8004 registration via getvia.xyz/mcp using the
 * agent wallet. Non-fatal mint.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const email              = String(body.email ?? '').trim().toLowerCase();
  const password           = String(body.password ?? '');
  const handleInput        = String(body.handle ?? '').trim().toLowerCase();
  const displayName        = String(body.displayName ?? '').trim();
  const walletAddress      = String(body.walletAddress ?? '').trim();
  const agentWalletAddress = String(body.agentWalletAddress ?? '').trim();

  if (!email || !email.includes('@'))             return NextResponse.json({ error: 'valid email required' },          { status: 400 });
  if (!password || password.length < 8)           return NextResponse.json({ error: 'password must be 8+ characters' }, { status: 400 });
  if (!displayName)                               return NextResponse.json({ error: 'display name required' },          { status: 400 });
  if (!ethers.isAddress(walletAddress))           return NextResponse.json({ error: 'invalid funding wallet address' }, { status: 400 });
  if (!ethers.isAddress(agentWalletAddress))      return NextResponse.json({ error: 'invalid agent wallet address — provision the Buying Agent wallet in step 3' }, { status: 400 });
  if (walletAddress.toLowerCase() === agentWalletAddress.toLowerCase()) {
    return NextResponse.json({ error: 'funding wallet and agent wallet must be different EOAs' }, { status: 400 });
  }
  const funding     = walletAddress.toLowerCase();
  const agentWallet = agentWalletAddress.toLowerCase();

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
    user_metadata: { source: 'via_app_onboard_buyer', wallet_address: funding, agent_wallet_address: agentWallet },
  });

  if (createErr) {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const found = list?.users?.find((u: { email?: string | null; id: string }) => u.email?.toLowerCase() === email);
    if (!found) return NextResponse.json({ error: 'could not create or find user account' }, { status: 500 });
    const { data: priorBuyer } = await db.from('app_buyers').select('handle').eq('owner_user_id', found.id).maybeSingle();
    if (priorBuyer) return NextResponse.json({ error: `this email already owns "${priorBuyer.handle}" — sign in instead` }, { status: 409 });
    await supabaseAdmin.auth.admin.updateUserById(found.id, { password });
    userId = found.id;
  } else {
    userId = created.user.id;
  }

  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session) {
    console.error('[onboard/buyer/register] signIn failed', signInErr);
    return NextResponse.json({ error: 'account created but sign-in failed' }, { status: 500 });
  }

  const { data: buyer, error: buyerErr } = await db
    .from('app_buyers')
    .insert({
      handle,
      owner_user_id:        userId,
      display_name:         displayName,
      wallet_address:       funding,
      agent_wallet_address: agentWallet,
      public:               false,
    })
    .select('id, handle, display_name')
    .single();

  if (buyerErr || !buyer) {
    console.error('[onboard/buyer/register] app_buyers insert failed', buyerErr);
    if (buyerErr?.code === '23505') return NextResponse.json({ error: 'handle taken (race)' }, { status: 409 });
    return NextResponse.json({ error: 'failed to create buyer record' }, { status: 500 });
  }

  // ERC-8004 registration for the Buying Agent. Same test-mode gate as
  // the seller register endpoint — see lib/app/test-mode.ts.
  if (shouldSkipErc8004(email)) {
    const placeholder = syntheticTestAgentId();
    await db.from('app_buyers').update({ erc8004_agent_id: placeholder }).eq('id', buyer.id);
    console.log(`[onboard/buyer/register] TEST MODE — skipped ERC-8004 mint for handle=${buyer.handle}, placeholder=${placeholder}`);
  } else {
    registerAgentIdentity(
      buyer.id,
      `${displayName} — Buying Agent`,
      agentWallet,
      'buying_agent',
    )
      .then(async ({ tokenId, txHash }) => {
        await db.from('app_buyers')
          .update({ erc8004_agent_id: tokenId.toString() })
          .eq('id', buyer.id);
        console.log(`[onboard/buyer/register] erc8004 mint ok handle=${buyer.handle} tokenId=${tokenId} tx=${txHash}`);
      })
      .catch((err) => {
        console.error(`[onboard/buyer/register] erc8004 mint failed handle=${buyer.handle}:`, err);
      });
  }

  const response = NextResponse.json({
    buyer: { id: buyer.id, handle: buyer.handle, display_name: buyer.display_name },
    redirect_to: `/buyer/${buyer.handle}/admin`,
  });
  setBrandAuthCookies(response, signIn.session.access_token, signIn.session.refresh_token);
  return response;
}
