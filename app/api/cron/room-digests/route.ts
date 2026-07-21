/**
 * Daily Back Room digest. For each member whose rooms saw activity by others
 * in the last 24 hours (chat or table additions), email a summary, at most
 * once per 24h, and only when there is something to tell. Deliberately NOT
 * gated on the seen-markers: a member who reads their rooms daily still gets
 * the daily summary (the in-app pulse is the seen-based surface). Members who
 * turned the digest off are skipped. Secured by the Vercel cron secret.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { supabaseAdmin } from '@/lib/app/seller-auth';
import { roomActivityCountsFor } from '@/lib/app/backroom/notifications';
import type { Author } from '@/lib/app/backroom/rooms';
import { resolveRrgConcierge } from '@/lib/app/backroom/rrg-federation';
import { sendRoomDigestEmail } from '@/lib/app/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Owner email for a member. VIA buyer/seller resolve locally; an RRG concierge
// over federation. RRG brand contact email is not federated, so brands (which
// have their own dashboards) are not digested by email here.
async function memberEmail(platform: string, type: string, ref: string): Promise<string | null> {
  try {
    if (platform === 'via' && type === 'seller') {
      const { data } = await db.from('app_sellers').select('contact_email, owner_user_id').eq('slug', ref).maybeSingle();
      const row = data as { contact_email: string | null; owner_user_id: string | null } | null;
      if (row?.contact_email) return row.contact_email;
      if (row?.owner_user_id) { const { data: u } = await supabaseAdmin.auth.admin.getUserById(row.owner_user_id); return u?.user?.email ?? null; }
      return null;
    }
    if (platform === 'via' && type === 'buyer') {
      const { data } = await db.from('app_buyers').select('owner_user_id').eq('handle', ref).maybeSingle();
      const id = (data as { owner_user_id: string | null } | null)?.owner_user_id;
      if (!id) return null;
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      return u?.user?.email ?? null;
    }
    if (platform === 'rrg' && type === 'buyer') {
      const c = await resolveRrgConcierge(ref);
      return c && c !== 'unavailable' ? c.email : null;
    }
    return null;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { data: mrows } = await db.from('app_room_members')
    .select('member_platform, member_type, member_ref').eq('status', 'active');
  const seen = new Set<string>();
  const members: Author[] = [];
  for (const m of (mrows ?? []) as Author[]) {
    const k = `${m.member_platform}/${m.member_type}/${m.member_ref}`;
    if (!seen.has(k)) { seen.add(k); members.push(m); }
  }

  const { data: prows } = await db.from('app_room_member_prefs').select('member_platform, member_type, member_ref, email_digest, last_digest_at');
  const prefs = new Map<string, { email_digest: boolean; last_digest_at: string | null }>();
  for (const p of (prows ?? []) as { member_platform: string; member_type: string; member_ref: string; email_digest: boolean; last_digest_at: string | null }[]) {
    prefs.set(`${p.member_platform}/${p.member_type}/${p.member_ref}`, { email_digest: p.email_digest, last_digest_at: p.last_digest_at });
  }

  const gate = Date.now() - 20 * 60 * 60 * 1000; // no more than one per ~24h
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();
  let sent = 0;

  for (const m of members) {
    const key = `${m.member_platform}/${m.member_type}/${m.member_ref}`;
    const pref = prefs.get(key);
    if (pref?.email_digest === false) continue;
    if (pref?.last_digest_at && new Date(pref.last_digest_at).getTime() > gate) continue;

    const counts = await roomActivityCountsFor(m, sinceIso);
    if (counts.size === 0) continue;

    const ids = [...counts.keys()];
    const { data: rrows } = await db.from('app_rooms').select('id, name').in('id', ids);
    const nameById = new Map<string, string>();
    for (const r of (rrows ?? []) as { id: string; name: string }[]) nameById.set(r.id, r.name);
    const rooms = ids
      .map((id) => ({ name: nameById.get(id) ?? 'a room', count: counts.get(id) ?? 0 }))
      .filter((r) => r.count > 0);
    if (rooms.length === 0) continue;

    const email = await memberEmail(m.member_platform, m.member_type, m.member_ref);
    if (!email) continue;

    try { await sendRoomDigestEmail({ to: email, rooms }); sent++; }
    catch (e) { console.warn('[cron/room-digests] send failed:', e); continue; }

    await db.from('app_room_member_prefs').upsert({
      member_platform: m.member_platform, member_type: m.member_type, member_ref: m.member_ref,
      email_digest: pref?.email_digest ?? true, last_digest_at: nowIso, updated_at: nowIso,
    }, { onConflict: 'member_platform,member_type,member_ref' });
  }

  return NextResponse.json({ status: 'ok', members: members.length, sent });
}
