/**
 * The Door: a member's introductions.
 *
 * GET  ?ref=<member>            , the knocks waiting for this member.
 * POST { ref, intro_id, accept } , answer a knock. Accepting is a deliberate
 *   tap. Declining is silent: no notification, the other side is never told.
 *
 * The member owns their Door; any of the four member kinds may hold one, and
 * the signed-in session must own the ref (`handle` accepted as an alias).
 * Each knock is enriched with the counterpart's published taste card slug when
 * one exists, so the Door can show who is knocking in their own words.
 */
import { NextResponse } from 'next/server';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import { listKnocksForMember, respondToKnock } from '@/lib/app/backroom/introductions';
import { getPublishedCardForMember } from '@/lib/app/backroom/taste-cards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const ref = (params.get('ref') ?? params.get('handle'))?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const m = auth.member;

  const knocks = await listKnocksForMember(m.member_platform, m.member_ref);
  const enriched = await Promise.all(knocks.map(async (k) => {
    const card = await getPublishedCardForMember(k.other.member_platform, k.other.member_type, k.other.member_ref);
    return { ...k, other_card_slug: card?.slug ?? null };
  }));
  return NextResponse.json({ ref, handle: ref, count: enriched.length, knocks: enriched });
}

export async function POST(req: Request) {
  let body: { ref?: string; handle?: string; intro_id?: string; accept?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = (body.ref ?? body.handle)?.trim() ?? '';
  const introId = body.intro_id?.trim() ?? '';
  if (!ref || !introId || typeof body.accept !== 'boolean') {
    return NextResponse.json({ error: 'ref, intro_id and accept (boolean) required' }, { status: 400 });
  }
  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const m = auth.member;

  const result = await respondToKnock(introId, m.member_platform, m.member_ref, body.accept);
  const status = result.outcome === 'not_found' ? 404 : 200;
  return NextResponse.json(result, { status });
}
