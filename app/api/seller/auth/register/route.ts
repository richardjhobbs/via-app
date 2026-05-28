import { NextRequest, NextResponse } from 'next/server';
import { setBrandAuthCookies, supabaseAdmin } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

/**
 * POST /api/seller/auth/register — brand self-registration (application)
 *
 * Body: { email, wallet, sellerName, applicationText, oauthRegistration: true }
 *
 * Creates a Supabase Auth user, an app_sellers record (status: 'pending'),
 * and an app_seller_members record. The brand is NOT active until a
 * super-admin approves it via /api/rrg/admin/brands/approve.
 */
export async function POST(req: NextRequest) {
  try {
    const { email, wallet, sellerName, applicationText, oauthRegistration } = await req.json();

    const isOAuth = oauthRegistration === true;

    if (!email || !wallet || !sellerName?.trim()) {
      return NextResponse.json(
        { error: 'Email, wallet address, and brand name are required' },
        { status: 400 },
      );
    }

    // Validate wallet address
    if (!ethers.isAddress(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    const walletLower = wallet.toLowerCase();

    // Generate a slug from brand name
    const slug = sellerName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);

    if (!slug) {
      return NextResponse.json({ error: 'Brand name must contain alphanumeric characters' }, { status: 400 });
    }

    // Check if slug already exists
    const { data: existingBrand } = await db
      .from('app_sellers')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (existingBrand) {
      return NextResponse.json(
        { error: 'A brand with a similar name already exists. Please choose a different name.' },
        { status: 409 },
      );
    }

    // ── Create or find Supabase Auth user ──────────────────────────────
    const effectivePassword = isOAuth
      ? randomBytes(32).toString('base64url')
      : randomBytes(32).toString('base64url'); // always random — brands use OAuth

    let userId: string;
    let accessToken: string;
    let refreshToken: string;

    const { data: adminUser, error: adminErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: effectivePassword,
      email_confirm: true,
      user_metadata: { brand_wallet: walletLower },
    });

    if (adminErr) {
      // User may already exist (e.g. registered as creator)
      const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
      const existingUser = users?.find((u) => u.email === email);
      if (!existingUser) {
        return NextResponse.json(
          { error: 'Could not create account. Please try again.' },
          { status: 409 },
        );
      }
      userId = existingUser.id;

      // Check if they already have a brand membership
      const { data: existingMember } = await db
        .from('app_seller_members')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (existingMember) {
        return NextResponse.json(
          { error: 'A brand account already exists for this email. Please use Login instead.' },
          { status: 409 },
        );
      }

      // Generate session tokens
      const tempPassword = randomBytes(32).toString('base64url');
      await supabaseAdmin.auth.admin.updateUserById(existingUser.id, { password: tempPassword });
      const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password: tempPassword,
      });
      if (signInErr || !signIn.session) {
        return NextResponse.json({ error: 'Account exists but session creation failed' }, { status: 500 });
      }
      accessToken  = signIn.session.access_token;
      refreshToken = signIn.session.refresh_token;
    } else {
      userId = adminUser.user.id;
      const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password: effectivePassword,
      });
      if (signInErr || !signIn.session) {
        return NextResponse.json({ error: 'Account created but sign-in failed' }, { status: 500 });
      }
      accessToken  = signIn.session.access_token;
      refreshToken = signIn.session.refresh_token;
    }

    // ── Create brand record (pending) ──────────────────────────────────
    const { data: brand, error: brandErr } = await db
      .from('app_sellers')
      .insert({
        name:             sellerName.trim(),
        slug,
        contact_email:    email,
        wallet_address:   walletLower,
        status:           'pending',
        application_text: applicationText?.trim() || null,
        created_by:       userId,
      })
      .select('id, name, slug, status')
      .single();

    if (brandErr) {
      console.error('[brand/register] brand insert failed:', brandErr);
      if (brandErr.code === '23505') {
        return NextResponse.json({ error: 'Brand name or slug already taken' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to create brand record' }, { status: 500 });
    }

    // ── Create brand membership ────────────────────────────────────────
    const { error: memberErr } = await db
      .from('app_seller_members')
      .insert({
        brand_id: brand.id,
        user_id:  userId,
        role:     'admin',
      });

    if (memberErr) {
      console.error('[brand/register] member insert failed:', memberErr);
      return NextResponse.json({ error: 'Failed to create brand membership' }, { status: 500 });
    }

    const response = NextResponse.json({
      user: { id: userId, email },
      brand: {
        id:     brand.id,
        name:   brand.name,
        slug:   brand.slug,
        status: brand.status,
      },
      pending: true,
      message: 'Your brand application has been submitted and is pending review.',
    });

    setBrandAuthCookies(response, accessToken, refreshToken);
    return response;
  } catch (err) {
    console.error('[/api/seller/auth/register]', err);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
