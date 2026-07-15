/**
 * Web push for the Back Room PWA.
 *
 * A member subscribes a browser (the PWA) once; the endpoint + keys are stored
 * against their (platform, type, ref) triple. When someone else writes to a room
 * (chat or table), pushToRoom fans a notification out to every other active
 * member's subscriptions. Dead endpoints (404/410) are pruned on send.
 *
 * The identity wallet story does not apply here: push endpoints are per-browser,
 * not per-wallet, and carry no signing power. Everything runs through the
 * service-role db client (the table has RLS on with no policies).
 */
import webpush from 'web-push';
import { db } from '../db';
import { listRoomMembers, type Author } from './rooms';

let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:hello@getvia.xyz';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  vapidReady = true;
  return true;
}

export function getVapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
}

interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Store (or refresh) a browser's push subscription for a member. */
export async function saveSubscription(member: Author, sub: BrowserSubscription): Promise<void> {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return;
  await db.from('app_push_subscriptions').upsert(
    {
      member_platform: member.member_platform,
      member_type: member.member_type,
      member_ref: member.member_ref,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
    { onConflict: 'endpoint' },
  );
}

/** Remove a browser's push subscription (member turned it off, or it went stale). */
export async function deleteSubscription(endpoint: string): Promise<void> {
  if (!endpoint) return;
  await db.from('app_push_subscriptions').delete().eq('endpoint', endpoint);
}

interface SubRow { endpoint: string; p256dh: string; auth: string }

function sameMember(a: Author, b: { member_platform: string; member_type: string; member_ref: string }): boolean {
  return a.member_platform === b.member_platform && a.member_type === b.member_type && a.member_ref === b.member_ref;
}

/**
 * Notify every active member of a room, except the author, of new activity.
 * Best-effort: a missing VAPID config or an unreachable endpoint never throws
 * (this is called from write routes via after(), and must not surface an error).
 */
export async function pushToRoom(input: {
  roomId: string;
  exceptMember: Author;
  title: string;
  body: string;
  url: string;
}): Promise<void> {
  if (!ensureVapid()) { console.warn('[push] VAPID not configured, skipping push'); return; }

  const members = (await listRoomMembers(input.roomId))
    .filter((m) => m.status === 'active' && !sameMember(input.exceptMember, m));
  if (members.length === 0) return;

  // Collect subscriptions for the recipient triples. Refs can collide across
  // platforms, so match the full triple, not the ref alone.
  const refs = [...new Set(members.map((m) => m.member_ref))];
  const { data } = await db
    .from('app_push_subscriptions')
    .select('member_platform, member_type, member_ref, endpoint, p256dh, auth')
    .in('member_ref', refs);
  const rows = ((data ?? []) as Array<SubRow & { member_platform: string; member_type: string; member_ref: string }>)
    .filter((r) => members.some((m) => sameMember(
      { member_platform: m.member_platform, member_type: m.member_type, member_ref: m.member_ref },
      r,
    )));
  if (rows.length === 0) return;

  const payload = JSON.stringify({ title: input.title, body: input.body, url: input.url, tag: input.roomId });
  const dead: string[] = [];
  const ok: string[] = [];

  await Promise.allSettled(
    rows.map((r) =>
      webpush
        .sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload)
        .then(() => { ok.push(r.endpoint); })
        .catch((err: { statusCode?: number }) => {
          if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(r.endpoint);
        }),
    ),
  );

  if (dead.length > 0) await db.from('app_push_subscriptions').delete().in('endpoint', dead);
  if (ok.length > 0) await db.from('app_push_subscriptions').update({ last_ok_at: new Date().toISOString() }).in('endpoint', ok);
}
