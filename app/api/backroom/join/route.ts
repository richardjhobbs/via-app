/**
 * Redeem a person invitation for the signed-in member: join and mark accepted.
 *
 * POST { token, ref }
 */
import { NextResponse } from 'next/server';
import { resolveOwnedMember, ownedLinkedRrgWallet } from '@/lib/app/backroom/ui-auth';
import { getBrandSession } from '@/lib/app/backroom/brand-session';
import { getConciergeSession } from '@/lib/app/backroom/concierge-session';
import { redeemPersonInvite, invitationByToken } from '@/lib/app/backroom/invitations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { token?: string; ref?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const token = body.token?.trim() ?? '';
  const ref = body.ref?.trim() ?? '';
  if (!token || !ref) return NextResponse.json({ error: 'token and ref required' }, { status: 400 });

  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const invite = await invitationByToken(token);
  if (!invite) return NextResponse.json({ error: 'invitation is not valid or has expired' }, { status: 404 });

  const brandWallet = auth.member.member_platform === 'rrg'
    ? ((await getBrandSession())?.wallet ?? (await getConciergeSession())?.wallet ?? (await ownedLinkedRrgWallet(ref)))
    : null;
  const result = await redeemPersonInvite(token, auth.member, brandWallet);
  if (result.outcome === 'joined') {
    return NextResponse.json({ status: 'joined', room_id: invite.room_id });
  }
  const msg = result.outcome === 'full' ? 'That room is full.' : result.outcome === 'blocked' ? 'You cannot join that room.' : 'Could not join.';
  return NextResponse.json({ status: result.outcome, message: msg }, { status: 409 });
}
