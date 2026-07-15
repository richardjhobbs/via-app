/**
 * Unsubscribe a browser from Back Room web push (member turned it off).
 *
 * POST { ref, endpoint } , owner only. Removes the stored subscription so no
 * further pushes go to this browser.
 */
import { NextResponse } from 'next/server';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import { deleteSubscription } from '@/lib/app/backroom/push';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { ref?: string; endpoint?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const ref = body.ref?.trim() ?? '';
  const endpoint = body.endpoint?.trim() ?? '';
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });

  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  await deleteSubscription(endpoint);
  return NextResponse.json({ status: 'unsubscribed' });
}
