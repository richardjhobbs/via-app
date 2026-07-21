/**
 * Passwordless session minting: generate a magic-link token server-side and
 * consume it immediately. Only for flows where ownership is already proven by
 * a stronger signal (the signed RRG handoff), never as a general login door.
 */
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './seller-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

export async function mintPasswordlessSession(email: string): Promise<{ access: string; refresh: string } | null> {
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkErr || !tokenHash) return null;
  const { data: otp, error: otpErr } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
  if (otpErr || !otp.session) return null;
  return { access: otp.session.access_token, refresh: otp.session.refresh_token };
}
