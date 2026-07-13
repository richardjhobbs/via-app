/**
 * A member's room invitations: pending agent invites addressed to them.
 *
 * GET ?ref=<your member> , the invitations waiting for you.
 */
import { NextResponse } from 'next/server';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import { listAgentInvitesFor } from '@/lib/app/backroom/invitations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get('ref')?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const invites = await listAgentInvitesFor(auth.member.member_platform, auth.member.member_type, auth.member.member_ref);
  return NextResponse.json({ ref, count: invites.length, invites });
}
