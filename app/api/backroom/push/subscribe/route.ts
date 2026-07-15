/**
 * Subscribe a browser (the installed Back Room PWA) to web push for a member.
 *
 * GET                          , returns the VAPID public key for pushManager.subscribe.
 * POST { ref, subscription }   , store the browser's push subscription, owner only.
 */
import { NextResponse } from 'next/server';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import { saveSubscription, getVapidPublicKey } from '@/lib/app/backroom/push';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ vapidPublicKey: getVapidPublicKey() });
}

export async function POST(req: Request) {
  let body: { ref?: string; subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const ref = body.ref?.trim() ?? '';
  const sub = body.subscription;
  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: 'invalid subscription' }, { status: 400 });
  }

  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  await saveSubscription(auth.member, {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  return NextResponse.json({ status: 'subscribed' });
}
