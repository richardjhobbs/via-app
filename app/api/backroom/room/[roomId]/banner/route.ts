/**
 * A room's banner image, shown at the top of the room page. Founder-only (or a
 * superadmin).
 *
 * POST   multipart { ref, file }   , upload/replace the banner.
 * DELETE ?ref=<founder>            , clear the banner.
 *
 * The image goes in the public app-product-images bucket (world-readable, no
 * per-request signing, same bucket the storefront pictures use) under one
 * deterministic key per room, so re-uploads overwrite and the public URL stays
 * stable. The URL is written onto app_rooms.banner_url.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isAdminFromCookies } from '@/lib/app/auth';
import { loadRoom, isFounder } from '@/lib/app/backroom/rooms';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'app-product-images';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png',  'png'],
  ['image/webp', 'webp'],
]);

/** Founder (acting as `ref`) or a superadmin. Returns null on success, else a response. */
async function requireFounderOrAdmin(roomId: string, ref: string): Promise<NextResponse | null> {
  if (await isAdminFromCookies()) return null;
  if (!ref) return NextResponse.json({ error: 'ref required (the founder you are acting as)' }, { status: 400 });
  const owned = await resolveOwnedMember(ref);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  if (!(await isFounder(roomId, owned.member))) {
    return NextResponse.json({ error: 'only the room founder or a superadmin can set the banner' }, { status: 403 });
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data with a file field' }, { status: 400 }); }

  const ref = (form.get('ref') as string | null)?.trim() ?? '';
  const denied = await requireFounderOrAdmin(roomId, ref);
  if (denied) return denied;

  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const ext = ALLOWED.get(file.type);
  if (!ext) return NextResponse.json({ error: 'Image must be JPEG, PNG, or WebP' }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image must be 8 MB or smaller' }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const path = `rooms/${roomId}/banner.${ext}`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 502 });

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
  const bannerUrl = `${pub.publicUrl}?v=${Date.now().toString(36)}`;

  const { error: updErr } = await db
    .from('app_rooms')
    .update({ banner_url: bannerUrl, updated_at: new Date().toISOString() })
    .eq('id', roomId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ banner_url: bannerUrl });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  const ref = new URL(req.url).searchParams.get('ref')?.trim() ?? '';
  const denied = await requireFounderOrAdmin(roomId, ref);
  if (denied) return denied;

  // Best-effort remove the stored objects (any of the allowed extensions).
  const paths = [...ALLOWED.values()].map((ext) => `rooms/${roomId}/banner.${ext}`);
  await db.storage.from(BUCKET).remove(paths).catch(() => {});

  const { error: updErr } = await db
    .from('app_rooms')
    .update({ banner_url: null, updated_at: new Date().toISOString() })
    .eq('id', roomId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ status: 'ok' });
}
