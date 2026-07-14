/**
 * Knock on a taste card: request an introduction.
 *
 * POST { as_ref? } , signed-in session required. The knocker must have their
 * OWN published card (identity for identity: the recipient sees who is
 * asking, in that person's own published words). as_ref picks which owned
 * member knocks; omitted, the first owned member with a published card is
 * used.
 *
 * A knock is human intent, so the context pack uses NO LLM: the shared
 * references are the literal intersection of the two published cards. It
 * lands in the existing double-opt-in introductions machinery; the response
 * is the same whether the knock is new or already exists, so nothing about
 * prior state leaks, and a decline stays silent.
 */
import { NextResponse } from 'next/server';
import { sessionMembers, resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import { getPublishedCardBySlug, getPublishedCardForMember, type TasteCard } from '@/lib/app/backroom/taste-cards';
import { proposeIntroduction, type Party } from '@/lib/app/backroom/introductions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function intersect(a: string[], b: string[]): string[] {
  const bSet = new Set(b.map((s) => s.toLowerCase()));
  return a.filter((s) => bSet.has(s.toLowerCase()));
}

/** The literal overlap of two published cards; computed, never generated. */
function knockContextPack(knocker: TasteCard, target: TasteCard): Record<string, unknown> {
  const shared = [
    ...intersect(knocker.references, target.references),
    ...intersect(knocker.obsessions, target.obsessions),
    ...intersect(knocker.vocab, target.vocab),
  ];
  return {
    why: 'They knocked on your taste card',
    shared_references: Array.from(new Set(shared.map((s) => s.trim()))).slice(0, 8),
    they_make: knocker.headline || knocker.display_name,
    opening_thread: '',
    card_slug: knocker.slug,
    source: 'knock',
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const target = await getPublishedCardBySlug(slug);
  if (!target) return NextResponse.json({ error: 'no published card at this address' }, { status: 404 });

  let body: { as_ref?: string } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  // Who is knocking: a member this session owns, holding a published card.
  let knockerCard: TasteCard | null = null;
  let knocker: Party | null = null;
  if (body.as_ref?.trim()) {
    const auth = await resolveOwnedMember(body.as_ref.trim());
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    knocker = auth.member;
    knockerCard = await getPublishedCardForMember(auth.member.member_platform, auth.member.member_type, auth.member.member_ref);
  } else {
    const members = await sessionMembers();
    if (!members.length) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
    for (const m of members) {
      const card = await getPublishedCardForMember(m.platform, m.type, m.ref);
      if (card) {
        knocker = { member_platform: m.platform, member_type: m.type, member_ref: m.ref };
        knockerCard = card;
        break;
      }
    }
    if (!knocker) {
      return NextResponse.json({ error: 'publish your own card before knocking', needs_card: true }, { status: 403 });
    }
  }
  if (!knockerCard) {
    return NextResponse.json({ error: 'publish your own card before knocking', needs_card: true }, { status: 403 });
  }

  const isSelf = knocker!.member_platform === target.member_platform
    && knocker!.member_type === target.member_type
    && knocker!.member_ref === target.member_ref;
  if (isSelf) return NextResponse.json({ error: 'that is your own card' }, { status: 400 });

  const targetParty: Party = {
    member_platform: target.member_platform,
    member_type: target.member_type,
    member_ref: target.member_ref,
  };
  await proposeIntroduction(knocker!, targetParty, knockContextPack(knockerCard, target));

  // Neutral either way: 'proposed' and 'exists' answer identically so a knock
  // can never be used to probe prior state or a silent decline.
  return NextResponse.json({ ok: true, message: 'Knock delivered.' });
}
