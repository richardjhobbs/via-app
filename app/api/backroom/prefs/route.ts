/**
 * A member's Back Room notification preferences.
 *
 * GET  ?ref=<your member>          , read the email-digest preference.
 * POST { ref, email_digest }       , set it.
 */
import { NextResponse } from 'next/server';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import { getEmailDigestPref, setEmailDigestPref } from '@/lib/app/backroom/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get('ref')?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ email_digest: await getEmailDigestPref(auth.member) });
}

export async function POST(req: Request) {
  let body: { ref?: string; email_digest?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = body.ref?.trim() ?? '';
  if (!ref || typeof body.email_digest !== 'boolean') return NextResponse.json({ error: 'ref and email_digest (boolean) required' }, { status: 400 });
  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await setEmailDigestPref(auth.member, body.email_digest);
  return NextResponse.json({ status: 'ok', email_digest: body.email_digest });
}
