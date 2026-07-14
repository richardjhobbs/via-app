/**
 * Graduate a room's co-created work into a product for sale on VIA.
 *
 * POST { handle, title, description?, price_usd, cocreators:[{platform,type,ref,pct,role?}],
 *        deliverable_object_id? }
 *
 * Founder-only. Creates (or reuses) the room's store, creates the digital
 * product, locks the agreed split to each participant's payout wallet, copies
 * an optional table file into the paid deliverable, and marks it posted-for-sale
 * on the table. The store is pending VIA approval before it can sell.
 */
import { NextResponse } from 'next/server';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { isFounder, type Author, type MemberPlatform, type MemberType } from '@/lib/app/backroom/rooms';
import { graduateRoomToStore, type CoCreatorInput } from '@/lib/app/backroom/graduation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CoCreatorBody { platform?: string; type?: string; ref?: string; pct?: number; role?: string }

export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;

  let body: {
    handle?: string; ref?: string; title?: string; description?: string;
    price_usd?: number; cocreators?: CoCreatorBody[]; deliverable_object_id?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = (body.ref ?? body.handle)?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });

  const auth = await requireRoomMember(ref, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!(await isFounder(roomId, auth.member))) {
    return NextResponse.json({ error: 'only a room founder can graduate the room to a store' }, { status: 403 });
  }

  const cocreators: CoCreatorInput[] = (body.cocreators ?? []).map((c): CoCreatorInput => ({
    member: {
      member_platform: (c.platform as MemberPlatform) ?? 'via',
      member_type: (c.type as MemberType) ?? 'buyer',
      member_ref: String(c.ref ?? '').trim(),
    } as Author,
    pct: Number(c.pct ?? 0),
    role: c.role,
  }));

  const result = await graduateRoomToStore(roomId, auth.member, {
    title: String(body.title ?? '').trim(),
    description: body.description,
    priceUsd: Number(body.price_usd ?? 0),
    cocreators,
    deliverableObjectId: body.deliverable_object_id,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
