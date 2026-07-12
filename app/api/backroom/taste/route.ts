/**
 * Back Room taste profile: read and save.
 *
 * GET  ?handle=<buyer>   , the member's active taste profile (empty if none).
 * PUT  { handle, fields } , save an edited profile (the member owns and edits it).
 *
 * The profile is the member's own. Only the signed-in owner of the buyer handle
 * may read or write it (same owner session as the buyer admin).
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { getActiveProfile, saveProfile, EMPTY_TASTE, type TasteFields } from '@/lib/app/backroom/taste';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireOwnedBuyer(handle: string): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const user = await getBuyerUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: 'not authenticated' }, { status: 401 }) };
  const { data } = await db
    .from('app_buyers')
    .select('owner_user_id')
    .eq('handle', handle)
    .maybeSingle();
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

  const profile = await getActiveProfile('via', 'buyer', handle);
  return NextResponse.json({ handle, profile: profile ?? { id: null, version: 0, ...EMPTY_TASTE } });
}

export async function PUT(req: Request) {
  let body: { handle?: string; fields?: Partial<TasteFields> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const handle = body.handle?.trim() ?? '';
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
  const auth = await requireOwnedBuyer(handle);
  if (!auth.ok) return auth.res;

  const f = body.fields ?? {};
  const fields: TasteFields = {
    references: Array.isArray(f.references) ? f.references.map(String) : [],
    obsessions: Array.isArray(f.obsessions) ? f.obsessions.map(String) : [],
    aesthetic_vocab: Array.isArray(f.aesthetic_vocab) ? f.aesthetic_vocab.map(String) : [],
    anti_references: Array.isArray(f.anti_references) ? f.anti_references.map(String) : [],
    voice_text: typeof f.voice_text === 'string' ? f.voice_text : '',
  };
  const saved = await saveProfile('via', 'buyer', handle, fields);
  return NextResponse.json({ handle, profile: saved });
}
