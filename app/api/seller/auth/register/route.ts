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
 * POST /api/seller/auth/register : self-serve seller onboarding commit.
 *
 * Body:
 *   {
 *     email:              string,
 *     password:           string,
 *     sellerName:         string,
 *     slug:               string,    // pre-validated client-side, normalised here too
 *     kind:               'product' | 'service' | 'mixed',
 *     description?:       string,
 *     headline?:          string,
 *     websiteUrl?:        string,
 *     walletAddress:      string,    // seller's payout wallet (USDC lands here)
 *     agentWalletAddress: string,    // Sales Agent's own EOA (thirdweb in-app wallet)
 *   }
 *
 * What it does:
 *   1. Creates an auto-confirmed Supabase Auth user with the supplied
 *      password and signs them in (sb-access-token / sb-refresh-token cookies).
 *   2. Inserts app_sellers (active=true) with BOTH wallets distinguished:
 *      wallet_address       = payout target,
 *      agent_wallet_address = Sales Agent's own EOA.
 *   3. Fires ERC-8004 registration via getvia.xyz/mcp `via_register_agent`,
 *      passing the AGENT's wallet (not the payout wallet). On success,
 *      records erc8004_agent_id on the row. Failure is non-fatal: the
 *      seller is created and can re-trigger from the dashboard.
 *   4. Returns { seller } so the wizard can redirect to the Sales Agent
 *      chat surface.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const email              = String(body.email ?? '').trim().toLowerCase();
  const password           = String(body.password ?? '');
  const sellerName         = String(body.sellerName ?? '').trim();
  const slugInput          = String(body.slug ?? '').trim().toLowerCase();
  const kind               = String(body.kind ?? '');
  const description        = body.description  ? String(body.description).trim()  : null;
  const headline           = body.headline     ? String(body.headline).trim()     : null;
  const websiteUrl         = body.websiteUrl   ? String(body.websiteUrl).trim()   : null;
  const walletAddress      = String(body.walletAddress ?? '').trim();
  const agentWalletAddress = String(body.agentWalletAddress ?? '').trim();

  // Catalog source captured in the wizard's catalog step.
  const catalogSourceRaw   = body.catalogSource ? String(body.catalogSource).trim().toLowerCase() : null;
  const catalogSource      = (['shopify','squarespace','csv','services'] as const).includes(catalogSourceRaw as 'shopify')
                              ? catalogSourceRaw
                              : null;
  const shopifyDomain      = body.shopifyDomain
                              ? String(body.shopifyDomain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
                              : null;
  const squarespaceShopUrl = body.squarespaceShopUrl
                              ? String(body.squarespaceShopUrl).trim()
                              : null;
  const sourceCurrencyRaw  = body.sourceCurrency ? String(body.sourceCurrency).trim().toUpperCase() : 'USD';
  const sourceCurrency     = /^[A-Z]{3}$/.test(sourceCurrencyRaw) ? sourceCurrencyRaw : 'USD';

  // ── Validate input ──────────────────────────────────────────────────
  if (!email || !email.includes('@'))                 return NextResponse.json({ error: 'valid email required' },          { status: 400 });
  if (!password || password.length < 8)               return NextResponse.json({ error: 'password must be 8+ characters' }, { status: 400 });
  if (!sellerName)                                    return NextResponse.json({ error: 'business name required' },         { status: 400 });
  if (!['product','service','mixed'].includes(kind))  return NextResponse.json({ error: "kind must be 'product', 'service', or 'mixed'" }, { status: 400 });
  if (!ethers.isAddress(walletAddress))               return NextResponse.json({ error: 'invalid payout wallet address' },  { status: 400 });
  if (!ethers.isAddress(agentWalletAddress))          return NextResponse.json({ error: 'invalid agent wallet address. Provision the Sales Agent wallet in step 3' }, { status: 400 });
  if (walletAddress.toLowerCase() === agentWalletAddress.toLowerCase()) {
    return NextResponse.json({ error: 'payout wallet and agent wallet must be different EOAs' }, { status: 400 });
  }
  const wallet      = walletAddress.toLowerCase();
  const agentWallet = agentWalletAddress.toLowerCase();

  // Normalise slug: alphanumerics + hyphens, max 60 chars.
  const slug = (slugInput || sellerName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  if (!slug) return NextResponse.json({ error: 'business name must contain alphanumeric characters' }, { status: 400 });

  // ── Slug uniqueness check ──────────────────────────────────────────
  const { data: existing } = await db.from('app_sellers').select('id').eq('slug', slug).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: `slug "${slug}" already taken. Please choose a different business name` }, { status: 409 });
  }

  // ── Create or recover the Supabase auth user ────────────────────────
  let userId: string;
  let accessToken: string;
  let refreshToken: string;

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: 'via_app_onboard', wallet_address: wallet, agent_wallet_address: agentWallet },
  });

  if (createErr) {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const found = list?.users?.find((u: { email?: string | null; id: string }) => u.email?.toLowerCase() === email);
    if (!found) return NextResponse.json({ error: 'could not create or find user account' }, { status: 500 });

    const { data: priorSeller } = await db.from('app_sellers').select('slug').eq('owner_user_id', found.id).maybeSingle();
    if (priorSeller) {
      return NextResponse.json({ error: `this email already owns "${priorSeller.slug}", sign in instead` }, { status: 409 });
    }
    // An account already exists for this email but owns no seller (e.g. a
    // buyer account, or a previous attempt whose seller insert failed). Do
    // NOT reset its password: an unauthenticated request must never be able
    // to take over an existing account. Reuse the account only if the
    // supplied password authenticates in the sign-in step below.
    userId = found.id;
  } else {
    userId = created.user.id;
  }

  // Sign in to mint a session.
  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session) {
    console.error('[onboard/register] signIn failed', signInErr);
    return NextResponse.json({ error: 'this email may already have an account. Sign in with your existing password, or use Login.' }, { status: 401 });
  }
  accessToken  = signIn.session.access_token;
  refreshToken = signIn.session.refresh_token;

  // ── Insert seller row ───────────────────────────────────────────────
  const { data: seller, error: sellerErr } = await db
    .from('app_sellers')
    .insert({
      slug,
      name:                 sellerName,
      kind,
      contact_email:        email,
      owner_user_id:        userId,
      website_url:          websiteUrl,
      description,
      headline,
      wallet_address:       wallet,
      agent_wallet_address: agentWallet,
      catalog_source:        catalogSource,
      shopify_domain:        catalogSource === 'shopify'     ? shopifyDomain      : null,
      squarespace_shop_url:  catalogSource === 'squarespace' ? squarespaceShopUrl : null,
      source_currency:       sourceCurrency,
      active:               true,
      // Flag the Sales Agent for Hermes provisioning. The operator runner
      // (via-agent-wiki/scripts/via-concierges/process-pending-concierges.ps1)
      // drains 'pending' rows, clones a Hermes profile per seller on the Box,
      // and POSTs back 'provisioned' + the live URL once cutover succeeds.
      hermes_concierge_status: 'pending',
    })
    .select('id, slug, name, kind')
    .single();

  if (sellerErr || !seller) {
    console.error('[onboard/register] app_sellers insert failed', sellerErr);
    if (sellerErr?.code === '23505') {
      return NextResponse.json({ error: 'slug taken (race). Pick a different name' }, { status: 409 });
    }
    return NextResponse.json({ error: 'failed to create seller record' }, { status: 500 });
  }

  // ── ERC-8004 registration for the Sales Agent ─────────────────────
  // Test mode (VIA_SKIP_ERC8004=1 or +test/+e2e email alias) writes a
  // synthetic placeholder and skips the on-chain mint to spare gas on
  // the registrar wallet during wizard testing.
  if (shouldSkipErc8004(email)) {
    const placeholder = syntheticTestAgentId();
    await db.from('app_sellers').update({ erc8004_agent_id: placeholder }).eq('id', seller.id);
    console.log(`[onboard/register] TEST MODE: skipped ERC-8004 mint for seller=${seller.slug}, placeholder=${placeholder}`);
  } else {
    // Real mint: calls getvia.xyz/mcp via_register_agent which signs the
    // on-chain register() with VIA_REGISTRAR_PRIVATE_KEY and records
    // agentWallet = the supplied wallet_address. Non-fatal on failure.
    registerAgentIdentity(
      seller.id,
      `${sellerName} Sales Agent`,
      agentWallet,
      'sales_agent',
    )
      .then(async ({ tokenId, txHash }) => {
        await db.from('app_sellers')
          .update({ erc8004_agent_id: tokenId.toString() })
          .eq('id', seller.id);
        console.log(`[onboard/register] erc8004 mint ok seller=${seller.slug} tokenId=${tokenId} tx=${txHash}`);
      })
      .catch((err) => {
        console.error(`[onboard/register] erc8004 mint failed seller=${seller.slug}:`, err);
      });
  }

  const response = NextResponse.json({
    seller: { id: seller.id, slug: seller.slug, name: seller.name, kind: seller.kind },
    redirect_to: `/seller/${seller.slug}/admin/sales-agent`,
  });
  setBrandAuthCookies(response, accessToken, refreshToken);
  return response;
}
