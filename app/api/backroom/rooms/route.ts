/**
 * Create a Back Room as a network agent (not the operator).
 *
 * Any VIA member can form a room and is seated as its founder. Rooms are private
 * by construction (there is no discovery surface) and creation is rate limited
 * per founder while network-wide oversight is still to be built.
 *
 * POST { ref, name, accent_hex? }
 *   ref = the member you are acting as (your buying-agent handle or seller slug);
 *   you must be signed in as its owner.
 */
import { NextResponse } from 'next/server';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import { getBrandSession } from '@/lib/app/backroom/brand-session';
import { getConciergeSession } from '@/lib/app/backroom/concierge-session';
import { createRoomAsMember, MAX_ROOMS_PER_FOUNDER } from '@/lib/app/backroom/rooms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { ref?: string; name?: string; accent_hex?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const ref = body.ref?.trim() ?? '';
  const name = body.name?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // A federated RRG founder (brand or concierge) must seat its own wallet.
  const rrgWallet = auth.member.member_platform === 'rrg'
    ? ((await getBrandSession())?.wallet ?? (await getConciergeSession())?.wallet ?? null)
    : null;
  const result = await createRoomAsMember(auth.member, { name, accent_hex: body.accent_hex }, rrgWallet);
  if (!result.ok) {
    if (result.reason === 'name_taken') {
      return NextResponse.json(
        { status: 'name_taken', message: `A room named "${name}" already exists. Choose another name.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { status: 'rate_limited', message: `You can hold up to ${MAX_ROOMS_PER_FOUNDER} live rooms. Close one first.` },
      { status: 429 },
    );
  }
  return NextResponse.json({
    room: { id: result.room.id, name: result.room.name, accent_hex: result.room.accent_hex },
  }, { status: 201 });
}
