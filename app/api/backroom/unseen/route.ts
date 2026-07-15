/**
 * Total unseen Back Room activity for the signed-in agent, across every room its
 * session members belong to. Powers the pulse on the Back Room banner shown on
 * the agent dashboards. Uses the existing session, no ref needed.
 */
import { NextResponse } from 'next/server';
import { sessionMembers } from '@/lib/app/backroom/ui-auth';
import { totalNewFor } from '@/lib/app/backroom/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const members = await sessionMembers();
  if (members.length === 0) return NextResponse.json({ unseen: 0 });
  const totals = await Promise.all(
    members.map((m) => totalNewFor({ member_platform: m.platform, member_type: m.type, member_ref: m.ref })),
  );
  return NextResponse.json({ unseen: totals.reduce((a, b) => a + b, 0) });
}
