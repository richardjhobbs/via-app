/**
 * The member's own taste card: curate, publish, unpublish.
 *
 * GET  ?ref=<member>                 , the card (null if none) + a suggested slug.
 * PUT  { ref, card }                 , save curation (subset-validated, capped).
 * POST { ref, action }               , 'publish' or 'unpublish'. Publishing is
 *                                      the explicit consent gate.
 *
 * Owner-auth for any of the four member kinds via resolveOwnedMember.
 */
import { NextResponse } from 'next/server';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import {
  getCardForMember, saveCard, publishCard, unpublishCard, suggestSlug, cardUrl,
  type CardInput, type CardMember,
} from '@/lib/app/backroom/taste-cards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireMember(ref: string): Promise<{ ok: true; member: CardMember } | { ok: false; res: NextResponse }> {
  if (!ref) return { ok: false, res: NextResponse.json({ error: 'ref required' }, { status: 400 }) };
  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return { ok: false, res: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  return { ok: true, member: auth.member };
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const ref = (params.get('ref') ?? params.get('handle'))?.trim() ?? '';
  const auth = await requireMember(ref);
  if (!auth.ok) return auth.res;
  const m = auth.member;

  const card = await getCardForMember(m.member_platform, m.member_type, m.member_ref);
  return NextResponse.json({
    ref,
    card,
    card_url: card ? cardUrl(card) : null,
    suggested_slug: card ? card.slug : await suggestSlug(m.member_ref, m),
  });
}

export async function PUT(req: Request) {
  let body: { ref?: string; handle?: string; card?: CardInput };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = (body.ref ?? body.handle)?.trim() ?? '';
  const auth = await requireMember(ref);
  if (!auth.ok) return auth.res;

  const result = await saveCard(auth.member, body.card ?? {});
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ref, card: result.card, card_url: cardUrl(result.card) });
}

export async function POST(req: Request) {
  let body: { ref?: string; handle?: string; action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = (body.ref ?? body.handle)?.trim() ?? '';
  const action = body.action?.trim() ?? '';
  if (action !== 'publish' && action !== 'unpublish') {
    return NextResponse.json({ error: 'action must be publish or unpublish' }, { status: 400 });
  }
  const auth = await requireMember(ref);
  if (!auth.ok) return auth.res;

  const result = action === 'publish' ? await publishCard(auth.member) : await unpublishCard(auth.member);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ref, card: result.card, card_url: cardUrl(result.card) });
}
