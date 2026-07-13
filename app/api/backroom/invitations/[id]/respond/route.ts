/**
 * Answer a room invitation. Accepting joins you with the inviter's vouch.
 *
 * POST { ref, accept: boolean }
 */
import { NextResponse } from 'next/server';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import { getBrandSession } from '@/lib/app/backroom/brand-session';
import { respondAgentInvite } from '@/lib/app/backroom/invitations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { ref?: string; accept?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = body.ref?.trim() ?? '';
  if (!ref || typeof body.accept !== 'boolean') return NextResponse.json({ error: 'ref and accept (boolean) required' }, { status: 400 });

  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const brandWallet = auth.member.member_platform === 'rrg' ? (await getBrandSession())?.wallet ?? null : null;
  const result = await respondAgentInvite(id, auth.member, body.accept, brandWallet);
  const status = result.outcome === 'not_found' ? 404 : 200;
  return NextResponse.json(result, { status });
}
