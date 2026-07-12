/**
 * The Door: a member's introductions.
 *
 * GET  ?handle=<buyer>          , the knocks waiting for this member.
 * POST { handle, intro_id, accept } , answer a knock. Accepting is a deliberate
 *   tap. Declining is silent: no notification, the other side is never told.
 *
 * The member owns their Door; only the signed-in owner of the handle may read
 * or answer it.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { listKnocksForMember, respondToKnock } from '@/lib/app/backroom/introductions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireOwnedBuyer(handle: string): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const user = await getBuyerUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: 'not authenticated' }, { status: 401 }) };
  const { data } = await db.from('app_buyers').select('owner_user_id').eq('handle', handle).maybeSingle();
  if (!data || (data as { owner_user_id: string }).owner_user_id !== user.id) {
    return { ok: false, res: NextResponse.json({ error: 'not authorized for this member' }, { status: 403 }) };
  }
  return { ok: true };
}

export async function GET(req: Request) {
  const handle = new URL(req.url).searchParams.get('handle')?.trim() ?? '';
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
  const auth = await requireOwnedBuyer(handle);
  if (!auth.ok) return auth.res;

  const knocks = await listKnocksForMember('via', handle);
  return NextResponse.json({ handle, count: knocks.length, knocks });
}

export async function POST(req: Request) {
  let body: { handle?: string; intro_id?: string; accept?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const handle = body.handle?.trim() ?? '';
  const introId = body.intro_id?.trim() ?? '';
  if (!handle || !introId || typeof body.accept !== 'boolean') {
    return NextResponse.json({ error: 'handle, intro_id and accept (boolean) required' }, { status: 400 });
  }
  const auth = await requireOwnedBuyer(handle);
  if (!auth.ok) return auth.res;

  const result = await respondToKnock(introId, 'via', handle, body.accept);
  const status = result.outcome === 'not_found' ? 404 : 200;
  return NextResponse.json(result, { status });
}
