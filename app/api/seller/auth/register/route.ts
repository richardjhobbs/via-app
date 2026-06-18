import { NextRequest, NextResponse } from 'next/server';
import { setBrandAuthCookies, supabaseAdmin } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { countWalletStores, WALLET_STORE_CAP } from '@/lib/app/store-registration';
import { deriveAgentWallet, platformAgentWalletsEnabled } from '@/lib/app/agent-wallet';

export const dynamic = 'force-dynamic';

const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h review SLA, matches the agent-MCP path

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
 *   }
 *   (agentWalletAddress is no longer accepted: the Sales Agent's wallet is always
 *    platform-derived from AGENT_WALLET_SEED so the platform-run agent can sign.)
 *
 * What it does:
 *   1. Creates an auto-confirmed Supabase Auth user with the supplied
 *      password and signs them in (sb-access-token / sb-refresh-token cookies).
 *   2. Inserts app_sellers PENDING and inactive (active=false,
 *      approval_status='pending', created_via='web_onboard'):
 *      wallet_address       = the human's payout wallet (thirdweb/external),
 *      agent_wallet_address = platform-derived from AGENT_WALLET_SEED + store id.
 *      The store is invisible to list_sellers / find_seller until a human
 *      approves it, exactly like the agent-MCP register_store path.
 *   3. Does NOT mint ERC-8004 here. The mint is deferred to approveAgentStore
 *      (admin approval), which links an existing identity or mints a fresh one
 *      against the agent wallet and surfaces any failure. This removes the old
 *      fire-and-forget mint whose silent failures left rows with a null
 *      erc8004_agent_id.
 *   4. Returns { seller } so the wizard can route the operator to the dashboard
 *      to brief the Sales Agent while the store waits for review.
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
  // body.agentWalletAddress is intentionally NOT read: the agent wallet is always
  // platform-derived server-side (the wizard no longer provisions one).

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
  // The agent wallet is platform-derived from AGENT_WALLET_SEED. Fail closed if
  // the seed is unconfigured , never fall back to a user-custodied wallet the
  // platform cannot sign.
  if (!platformAgentWalletsEnabled()) {
    return NextResponse.json({ error: 'platform-managed identity wallets are not enabled; contact VIA' }, { status: 503 });
  }
  const wallet = walletAddress.toLowerCase();

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

  // ── Per-wallet store cap ────────────────────────────────────────────
  if ((await countWalletStores(wallet)) >= WALLET_STORE_CAP) {
    return NextResponse.json({ error: `This wallet is already connected to ${WALLET_STORE_CAP} stores. Further stores for this wallet are blocked pending manual review by VIA.` }, { status: 409 });
  }

  // ── Create or recover the Supabase auth user ────────────────────────
  let userId: string;
  let accessToken: string;
  let refreshToken: string;

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: 'via_app_onboard', wallet_address: wallet, agent_wallet_address: null },
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

  // ── Insert the pending, inactive seller row ─────────────────────────
  // Web signups go through the SAME moderation gate as agent-MCP
  // registrations: created inactive in 'pending', invisible to list_sellers /
  // find_seller until a human approves. The ERC-8004 mint is deferred to
  // approval so spam never spends registrar gas and silent mint failures stop
  // leaving live stores with a null identity.
  const now      = new Date();
  const eligible = new Date(now.getTime() + APPROVAL_WINDOW_MS);

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
      agent_wallet_address: null,
      catalog_source:        catalogSource,
      shopify_domain:        catalogSource === 'shopify'     ? shopifyDomain      : null,
      squarespace_shop_url:  catalogSource === 'squarespace' ? squarespaceShopUrl : null,
      source_currency:       sourceCurrency,
      active:               false,
      approval_status:      'pending',
      created_via:          'web_onboard',
      submitted_at:         now.toISOString(),
      approval_eligible_at: eligible.toISOString(),
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

  // ── Platform-managed agent wallet ───────────────────────────────────
  // The agent wallet is derived from AGENT_WALLET_SEED + the store id (needs the
  // id, so it happens post-insert). The private key is never stored
  // (re-derivable); the platform-run agent signs x402 micro-fees with it and it
  // holds the ERC-8004 identity. The seller's payout stays on `wallet_address`.
  {
    const derived = deriveAgentWallet(seller.id);
    if (!derived) {
      console.error('[onboard/register] AGENT_WALLET_SEED unavailable post-insert for', seller.slug);
    } else {
      await db.from('app_sellers')
        .update({ agent_wallet_address: derived.address.toLowerCase() })
        .eq('id', seller.id);
    }
  }

  // ERC-8004 identity is NOT minted here. It is deferred to approveAgentStore
  // (admin approval), which links an existing identity for the agent wallet or
  // mints a fresh one and surfaces any failure. The operator can still log in
  // and brief the Sales Agent while the store waits for review.

  const response = NextResponse.json({
    seller: { id: seller.id, slug: seller.slug, name: seller.name, kind: seller.kind },
    status: 'pending',
    redirect_to: `/seller/${seller.slug}/admin/sales-agent`,
  });
  setBrandAuthCookies(response, accessToken, refreshToken);
  return response;
}
