/**
 * A member's Back Room preferences.
 *
 * GET  ?ref=<your member>              , read email-digest + vibe.
 * POST { ref, email_digest?, vibe? }   , set either or both.
 */
import { NextResponse } from 'next/server';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import { getEmailDigestPref, setEmailDigestPref, getVibePref, setVibePref } from '@/lib/app/backroom/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get('ref')?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const [email_digest, vibe] = await Promise.all([
    getEmailDigestPref(auth.member),
    getVibePref(auth.member),
  ]);
  return NextResponse.json({ email_digest, vibe });
}

export async function POST(req: Request) {
  let body: { ref?: string; email_digest?: boolean; vibe?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = body.ref?.trim() ?? '';
  const hasDigest = typeof body.email_digest === 'boolean';
  const hasVibe = typeof body.vibe === 'string';
  if (!ref || (!hasDigest && !hasVibe)) {
    return NextResponse.json({ error: 'ref and one of email_digest (boolean) or vibe (string) required' }, { status: 400 });
  }
  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const out: { status: 'ok'; email_digest?: boolean; vibe?: string } = { status: 'ok' };
  if (hasDigest) { await setEmailDigestPref(auth.member, body.email_digest as boolean); out.email_digest = body.email_digest; }
  if (hasVibe) { out.vibe = await setVibePref(auth.member, body.vibe as string); }
  return NextResponse.json(out);
}
