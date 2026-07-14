/**
 * Back Room taste profile: read and save.
 *
 * GET  ?ref=<member>      , the member's active taste profile (empty if none).
 * PUT  { ref, fields }    , save an edited profile (the member owns and edits it).
 *
 * The profile is the member's own. Any of the four member kinds may hold one;
 * the signed-in session must own the ref (buyer handle, seller slug, or the
 * federated RRG brand session). `handle` is accepted as an alias for `ref`.
 */
import { NextResponse } from 'next/server';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import { getActiveProfile, getDraftProfile, saveProfile, EMPTY_TASTE, type TasteFields } from '@/lib/app/backroom/taste';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const ref = (params.get('ref') ?? params.get('handle'))?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const m = auth.member;

  const profile = await getActiveProfile(m.member_platform, m.member_type, m.member_ref);
  // Surface a pending agent-drafted profile (brand seeding) only while there is
  // no active profile; a human save consumes the draft.
  const draft = profile ? null : await getDraftProfile(m.member_platform, m.member_type, m.member_ref);
  return NextResponse.json({ ref, handle: ref, member: m, profile: profile ?? { id: null, version: 0, ...EMPTY_TASTE }, draft });
}

export async function PUT(req: Request) {
  let body: { ref?: string; handle?: string; fields?: Partial<TasteFields> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = (body.ref ?? body.handle)?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const m = auth.member;

  const f = body.fields ?? {};
  const fields: TasteFields = {
    references: Array.isArray(f.references) ? f.references.map(String) : [],
    obsessions: Array.isArray(f.obsessions) ? f.obsessions.map(String) : [],
    aesthetic_vocab: Array.isArray(f.aesthetic_vocab) ? f.aesthetic_vocab.map(String) : [],
    anti_references: Array.isArray(f.anti_references) ? f.anti_references.map(String) : [],
    places: Array.isArray(f.places) ? f.places.map(String) : [],
    work: Array.isArray(f.work) ? f.work.map(String) : [],
    voice_text: typeof f.voice_text === 'string' ? f.voice_text : '',
  };
  const saved = await saveProfile(m.member_platform, m.member_type, m.member_ref, fields);
  return NextResponse.json({ ref, handle: ref, member: m, profile: saved });
}
