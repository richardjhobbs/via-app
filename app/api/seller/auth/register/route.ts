import { NextRequest, NextResponse } from 'next/server';
import { setBrandAuthCookies, supabaseAdmin } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

/**
 * POST /api/seller/auth/register — self-serve seller onboarding commit.
 *
 * Body:
 *   {
 *     email:        string,
 *     password:     string,
 *     sellerName:   string,
 *     slug:         string,       // pre-validated client-side, normalised here too
 *     kind:         'product' | 'service' | 'mixed',
 *     description?: string,
 *     headline?:    string,
 *     websiteUrl?:  string,
 *     walletAddress: string,      // checksummed Base address; payouts land here
 *   }
 *
 * What it does:
 *   1. Creates an auto-confirmed Supabase Auth user with the supplied
 *      password (so the wizard can proceed without an email round-trip).
 *      Falls back to updating an existing user's password if email reused.
 *   2. Signs the user in to get a session and sets sb-access-token /
 *      sb-refresh-token cookies.
 *   3. Inserts app_sellers with active=true and the wizard's data.
 *   4. Returns { seller: { id, slug, name } } so the wizard can redirect.
 *
 * Out of scope (separate endpoint or follow-up commit):
 *   - ERC-8004 minting for the seller entity + Sales Agent. The new seller
 *     can trigger it from the dashboard, and onboarding-step 4 calls
 *     /api/seller/identity/mint after this returns 200.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const email         = String(body.email ?? '').trim().toLowerCase();
  const password      = String(body.password ?? '');
  const sellerName    = String(body.sellerName ?? '').trim();
  const slugInput     = String(body.slug ?? '').trim().toLowerCase();
  const kind          = String(body.kind ?? '');
  const description   = body.description  ? String(body.description).trim()  : null;
  const headline      = body.headline     ? String(body.headline).trim()     : null;
  const websiteUrl    = body.websiteUrl   ? String(body.websiteUrl).trim()   : null;
  const walletAddress = String(body.walletAddress ?? '').trim();

  // ── Validate input ──────────────────────────────────────────────────
  if (!email || !email.includes('@'))                 return NextResponse.json({ error: 'valid email required' },          { status: 400 });
  if (!password || password.length < 8)               return NextResponse.json({ error: 'password must be 8+ characters' }, { status: 400 });
  if (!sellerName)                                    return NextResponse.json({ error: 'business name required' },         { status: 400 });
  if (!['product','service','mixed'].includes(kind))  return NextResponse.json({ error: "kind must be 'product', 'service', or 'mixed'" }, { status: 400 });
  if (!ethers.isAddress(walletAddress))               return NextResponse.json({ error: 'invalid Base wallet address' },    { status: 400 });
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
    return NextResponse.json({ error: `slug "${slug}" already taken — please choose a different business name` }, { status: 409 });
  }

  // ── Create or recover the Supabase auth user ────────────────────────
  let userId: string;
  let accessToken: string;
  let refreshToken: string;

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: 'via_app_onboard', wallet_address: wallet },
  });

  if (createErr) {
    // User already exists — verify they don't already own a seller, then
    // reset password to the one supplied so the session sign-in works.
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const found = list?.users?.find((u: { email?: string | null; id: string }) => u.email?.toLowerCase() === email);
    if (!found) return NextResponse.json({ error: 'could not create or find user account' }, { status: 500 });

    const { data: priorSeller } = await db.from('app_sellers').select('slug').eq('owner_user_id', found.id).maybeSingle();
    if (priorSeller) {
      return NextResponse.json({ error: `this email already owns "${priorSeller.slug}" — sign in instead` }, { status: 409 });
    }
    await supabaseAdmin.auth.admin.updateUserById(found.id, { password });
    userId = found.id;
  } else {
    userId = created.user.id;
  }

  // Sign in to mint a session.
  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session) {
    console.error('[onboard/register] signIn failed', signInErr);
    return NextResponse.json({ error: 'account created but sign-in failed; please use Login' }, { status: 500 });
  }
  accessToken  = signIn.session.access_token;
  refreshToken = signIn.session.refresh_token;

  // ── Insert seller row ───────────────────────────────────────────────
  const { data: seller, error: sellerErr } = await db
    .from('app_sellers')
    .insert({
      slug,
      name:          sellerName,
      kind,
      contact_email: email,
      owner_user_id: userId,
      website_url:   websiteUrl,
      description,
      headline,
      wallet_address: wallet,
      active:         true,
    })
    .select('id, slug, name, kind')
    .single();

  if (sellerErr || !seller) {
    console.error('[onboard/register] app_sellers insert failed', sellerErr);
    if (sellerErr?.code === '23505') {
      return NextResponse.json({ error: 'slug taken (race) — pick a different name' }, { status: 409 });
    }
    return NextResponse.json({ error: 'failed to create seller record' }, { status: 500 });
  }

  const response = NextResponse.json({
    seller: { id: seller.id, slug: seller.slug, name: seller.name, kind: seller.kind },
    redirect_to: `/seller/${seller.slug}/admin/sales-agent`,
  });
  setBrandAuthCookies(response, accessToken, refreshToken);
  return response;
}
