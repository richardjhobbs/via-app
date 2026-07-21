import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/app/seller-auth';
import { setBuyerAuthCookies, getBuyerUser } from '@/lib/app/buyer-auth';
import { verifyHandoffToken } from '@/lib/app/rrg-handoff';
import { importConcierge } from '@/lib/app/rrg-concierge-import';
import { resolveRrgConcierge } from '@/lib/app/backroom/rrg-federation';

// Find-or-create the Supabase auth user for an email. Returns the user id.
async function findOrCreateUser(email: string, walletAddress: string, source: string): Promise<string | null> {
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { source, wallet_address: walletAddress.toLowerCase() },
  });
  if (!createErr) return created.user.id;
  const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
  const found = list?.users?.find((u: { email?: string | null; id: string }) => u.email?.toLowerCase() === email);
  return found?.id ?? null;
}

// Mint a session for a user WITHOUT their password: generate a magic-link
// token server-side and consume it immediately. Used only where ownership is
// already proven by a stronger signal (the signed RRG handoff).
async function mintPasswordlessSession(email: string): Promise<{ access: string; refresh: string } | null> {
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkErr || !tokenHash) return null;
  const { data: otp, error: otpErr } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
  if (otpErr || !otp.session) return null;
  return { access: otp.session.access_token, refresh: otp.session.refresh_token };
}

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

/**
 * POST /api/buyer/link-rrg , complete the "Bring my concierge to VIA" handoff.
 *
 * Body: { token: string, email?: string, password?: string }
 *
 * The signed handoff token (minted by RRG, verified against the shared
 * VIA_PLATFORM_SECRET) is the ownership proof for the RRG concierge. The VIA
 * side still needs an owner account to attach the buyer to:
 *   - if the caller already has a VIA buyer session, that user owns the import;
 *   - otherwise email+password create-or-sign-in a VIA account (same logic as
 *     /api/buyer/auth/register), and the session cookies are set on the response.
 *
 * Then importConcierge creates (or re-links) the buyer with the SAME funding
 * wallet, its own platform-derived identity, and the imported persona/memories.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const token = String(body.token ?? '').trim();
  if (!token) return NextResponse.json({ error: 'missing handoff token' }, { status: 400 });

  const verified = verifyHandoffToken(token);
  if (!verified.ok) return NextResponse.json({ error: `invalid handoff: ${verified.error}` }, { status: 401 });
  const payload = verified.payload;

  // Resolve the owner: an existing VIA session wins; otherwise email+password.
  let ownerUserId: string | null = null;
  let newSession: { access: string; refresh: string } | null = null;

  const session = await getBuyerUser();
  const email    = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (session) {
    ownerUserId = session.id;
  } else if (email && email.includes('@') && password.length >= 8) {
    // Explicit credentials: create-or-find the auth user, then sign in (mirrors
    // register). We never reset an existing account's password; reuse only if
    // the password matches.
    const userId = await findOrCreateUser(email, payload.wallet_address, 'via_app_rrg_link');
    if (!userId) return NextResponse.json({ error: 'could not create or find your account' }, { status: 500 });
    ownerUserId = userId;

    const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr || !signIn.session) {
      return NextResponse.json(
        { error: 'this email already has an account; sign in with your existing password first', needsAuth: true },
        { status: 401 },
      );
    }
    newSession = { access: signIn.session.access_token, refresh: signIn.session.refresh_token };
  } else {
    // No session, no credentials: finish automatically. The signed handoff
    // token was minted INSIDE the owner's RRG session, so it already proves
    // this person controls the concierge. Resolve the concierge's owner email
    // over the secret-gated federation channel and open the VIA session
    // passwordless; only if RRG exposes no email do we fall back to the form.
    const resolved = await resolveRrgConcierge(payload.wallet_address);
    const rrgEmail = resolved && resolved !== 'unavailable' ? (resolved.email?.trim().toLowerCase() || null) : null;
    if (rrgEmail) {
      const userId = await findOrCreateUser(rrgEmail, payload.wallet_address, 'via_app_rrg_link_auto');
      if (userId) {
        const minted = await mintPasswordlessSession(rrgEmail);
        if (minted) {
          ownerUserId = userId;
          newSession = minted;
        }
      }
    }
    if (!ownerUserId) {
      return NextResponse.json(
        { error: 'sign in to your VIA account to finish linking', needsAuth: true },
        { status: 401 },
      );
    }
  }

  const result = await importConcierge({
    rrgAgentId:   payload.rrg_agent_id,
    walletAddress: payload.wallet_address,
    displayName:   payload.display_name,
    ownerUserId:   ownerUserId as string,
  });

  if (!result.ok || !result.buyer) {
    return NextResponse.json({ error: result.error ?? 'import failed' }, { status: 502 });
  }

  const response = NextResponse.json({
    buyer: result.buyer,
    already_linked: result.alreadyLinked ?? false,
    memories: result.memories ?? null,
    redirect_to: `/buyer/${result.buyer.handle}/admin/buying-agent`,
  });
  if (newSession) setBuyerAuthCookies(response, newSession.access, newSession.refresh);
  return response;
}
