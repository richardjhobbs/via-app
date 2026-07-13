/**
 * Room membership: list members, and (founder or superadmin) remove / block /
 * restore one.
 *
 * GET  ?ref=<your member>            , the room's members, plus whether you found it.
 * POST { ref?, target_platform, target_type, target_ref, action }
 *   action = remove | block | restore. Only the room's founder (acting as `ref`)
 *   or a superadmin may moderate. A blocked member cannot be vouched back in; a
 *   removed member can.
 */
import { NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/app/auth';
import { loadRoom, isFounder, listRoomMembers, setMemberStatus, type MemberPlatform, type MemberType, type Author } from '@/lib/app/backroom/rooms';
import { requireRoomMember, resolveOwnedMember } from '@/lib/app/backroom/ui-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const ref = new URL(req.url).searchParams.get('ref')?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  const auth = await requireRoomMember(ref, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const members = await listRoomMembers(roomId);
  const youFound = await isFounder(roomId, auth.member);
  return NextResponse.json({ room: { id: room.id, name: room.name }, you_are_founder: youFound, members });
}

export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  let body: { ref?: string; target_platform?: string; target_type?: string; target_ref?: string; action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const action = body.action;
  const statusFor: Record<string, 'removed' | 'blocked' | 'active'> = { remove: 'removed', block: 'blocked', restore: 'active' };
  if (!action || !(action in statusFor)) return NextResponse.json({ error: "action must be remove, block or restore" }, { status: 400 });

  const target: Author = {
    member_platform: body.target_platform as MemberPlatform,
    member_type: body.target_type as MemberType,
    member_ref: body.target_ref?.trim() ?? '',
  };
  if (!target.member_platform || !target.member_type || !target.member_ref) {
    return NextResponse.json({ error: 'target_platform, target_type and target_ref required' }, { status: 400 });
  }

  // Superadmin may always moderate; otherwise the caller must be the room's founder.
  let authorized = await isAdminFromCookies();
  if (!authorized) {
    const ref = body.ref?.trim() ?? '';
    if (!ref) return NextResponse.json({ error: 'ref required (the founder you are acting as)' }, { status: 400 });
    const owned = await resolveOwnedMember(ref);
    if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
    authorized = await isFounder(roomId, owned.member);
    if (!authorized) return NextResponse.json({ error: 'only the room founder or a superadmin can do that' }, { status: 403 });
  }

  const ok = await setMemberStatus(roomId, target, statusFor[action]);
  if (!ok) return NextResponse.json({ error: 'update failed' }, { status: 500 });
  return NextResponse.json({ status: 'ok', action, target });
}
