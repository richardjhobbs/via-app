import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { db } from '@/lib/app/db';
import { clientIp, isRateLimited } from '@/lib/app/rate-limit';
import { generateStoreKey, hashStoreKey } from '@/lib/app/store-keys';

export const dynamic = 'force-dynamic';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

/**
 * POST /api/sellers/[slug]/agent/auth
 *
 * The single gate for agent-native catalogue management. The owning agent
 * presents the email + password it set at register_store. We issue a store
 * management key ONLY when ALL of these hold:
 *   1. The email + password authenticate (Supabase).
 *   2. That user owns this store (owner_user_id).
 *   3. The store is authorised and live (active=true) with a contact_email on
 *      record (the human behind it). Pending / rejected stores are refused.
 *
 * On success we mint a fresh key (rotating any prior one), persist only its
 * SHA-256 hash, and return the plaintext ONCE. The agent then calls the
 * management MCP at manage_mcp_url with that key in the x-via-store-key header.
 *
 * Body:     { email, password }
 * Returns:  { store_key, seller_id, slug, manage_mcp_url }
 *
 * Auth/ownership failures collapse into one generic 401 (no credential or
 * existence oracle). Authorisation failure (store not live) is a distinct 403
 * so a legitimate owner knows their store still needs approval.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (isRateLimited(`agent-auth|${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a minute and try again.' }, { status: 429 });
  }

  let body: { email?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const email    = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  // Load the store first; collapse "no such store" into the generic 401 below.
  const { data: seller } = await db
    .from('app_sellers')
    .select('id, slug, owner_user_id, active, approval_status, contact_email')
    .eq('slug', slug)
    .maybeSingle();

  // Authenticate.
  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session || !seller || signIn.user.id !== seller.owner_user_id) {
    // Bad credentials, unknown store, or credentials that are valid but do not
    // own this store: one generic answer, no oracle.
    return NextResponse.json({ error: 'Invalid email or password for this store' }, { status: 401 });
  }

  // Authorisation: the seller agent must be authorised (live) with a human
  // email on record. A pending agent store (active=false) is refused here.
  if (!seller.active || !seller.contact_email) {
    return NextResponse.json({
      error: 'not_authorised',
      message: 'This store is not yet authorised for agent management. It must be approved (active) and have a contact email on record. Check get_store_status; approval happens within 24 hours of registration.',
      approval_status: seller.approval_status ?? null,
    }, { status: 403 });
  }

  // Mint + persist (hash only). Rotates any prior key.
  const storeKey = generateStoreKey();
  const { error: updErr } = await db
    .from('app_sellers')
    .update({ agent_api_key_hash: hashStoreKey(storeKey), updated_at: new Date().toISOString() })
    .eq('id', seller.id);
  if (updErr) {
    console.error('[agent/auth] key persist failed', updErr);
    return NextResponse.json({ error: 'could not issue a store key right now, retry shortly' }, { status: 500 });
  }

  return NextResponse.json({
    store_key:      storeKey,
    seller_id:      seller.id,
    slug:           seller.slug,
    manage_mcp_url: `${APP_BASE}/sellers/${seller.slug}/manage/mcp`,
    note: 'Store this key securely. Send it as the x-via-store-key header to the management MCP. It is shown once and rotates each time you authenticate here. The key lets you create, list, and publish products for this store.',
  });
}
