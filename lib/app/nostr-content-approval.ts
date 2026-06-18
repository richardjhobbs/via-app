/**
 * lib/app/nostr-content-approval.ts
 *
 * Discord approve-card gate for VIA Nostr content, modelled on RRG's
 * lib/rrg/blast-approval.ts (Rosie's outreach approval). When an agent queues a
 * post via draft_nostr_content (status 'pending' in app_nostr_content), this posts
 * an Approve/Reject card to the identity's existing Discord webhook
 * (DISCORD_WEBHOOK_ROSIE / DISCORD_WEBHOOK_PRISCILLA). The Approve/Reject links
 * carry an HMAC token bound to the row id + action (derived from ADMIN_SECRET, same
 * pattern as blast-approval), so the link self-authenticates , no admin cookie
 * needed and an agent cannot forge it. Approve publishes to Nostr (via
 * publishStoredContent) and the post then surfaces on /demand; the card is edited
 * to show the outcome.
 */
import crypto from 'crypto';
import { db } from './db';
import { publishStoredContent, type StoredContent } from './broadcast/nostr';
import { sendDiscordCardReturningId, editDiscordCard, type DiscordEmbed, type DiscordEmbedField } from './discord-card';

const APP = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');
const COLOR_PENDING = 0xc9a477;   // VIA brass
const COLOR_POSTED = 0x2b9a66;    // live green
const COLOR_REJECTED = 0x6e665c;  // grey

export type ContentAction = 'approve' | 'reject';

interface ContentRow {
  id: string;
  identity: string;
  kind: number;
  content: string;
  title: string | null;
  summary: string | null;
  slug: string | null;
  reply_to: StoredContent['reply_to'];
  status: string;
  discord_message_id: string | null;
}

function webhookFor(identity: string): string | null {
  if (identity === 'rosie') return process.env.DISCORD_WEBHOOK_ROSIE ?? null;
  if (identity === 'priscilla') return process.env.DISCORD_WEBHOOK_PRISCILLA ?? null;
  return process.env.DISCORD_WEBHOOK_ROSIE ?? null;
}

// ── HMAC token (bound to id + action), same construction as blast-approval ──
export function signContentToken(id: string, action: ContentAction): string | null {
  const root = process.env.ADMIN_SECRET;
  if (!root) return null;
  return crypto.createHmac('sha256', root).update(`${id}:${action}`).digest('hex');
}
export function verifyContentToken(id: string, action: ContentAction, token: string | null): boolean {
  if (!token) return false;
  const expected = signContentToken(id, action);
  if (!expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function actionUrl(id: string, action: ContentAction): string {
  return `${APP}/api/nostr/${action}?id=${id}&t=${signContentToken(id, action)}`;
}

function pendingEmbed(row: ContentRow): DiscordEmbed {
  const kindLabel = row.kind === 30023 ? 'long-form article' : 'note';
  const fields: DiscordEmbedField[] = [
    { name: 'Identity', value: row.identity, inline: true },
    { name: 'Kind', value: `${row.kind} (${kindLabel})`, inline: true },
  ];
  if (row.title) fields.push({ name: 'Title', value: row.title.slice(0, 1024) });
  fields.push({ name: 'Content', value: (row.content || '(empty)').slice(0, 1024) });
  fields.push({ name: 'Approve and publish', value: actionUrl(row.id, 'approve').slice(0, 1024) });
  fields.push({ name: 'Reject', value: actionUrl(row.id, 'reject').slice(0, 1024) });
  return {
    title: `Nostr post ready: ${row.identity}`,
    color: COLOR_PENDING,
    description: `${row.identity} drafted a Nostr post. Review it, then approve or reject. Nothing is published until you approve. On approve it posts to Nostr and appears on ${APP}/demand.`,
    fields,
    footer: { text: 'Approve to publish, or Reject to discard. Nothing sent yet.' },
  };
}

function outcomeEmbed(row: ContentRow, posted: boolean, eventId?: string | null): DiscordEmbed {
  return posted
    ? {
        title: `Nostr post published: ${row.identity}`,
        color: COLOR_POSTED,
        description: `Published to Nostr and live on ${APP}/demand.`,
        fields: [
          { name: 'Identity', value: row.identity, inline: true },
          { name: 'Event', value: (eventId ?? 'n/a').slice(0, 32), inline: true },
        ],
        footer: { text: 'Approved and published.' },
      }
    : {
        title: `Nostr post rejected: ${row.identity}`,
        color: COLOR_REJECTED,
        description: 'This draft was rejected. Nothing was published.',
        footer: { text: 'Rejected.' },
      };
}

async function getRow(id: string): Promise<ContentRow | null> {
  const { data } = await db
    .from('app_nostr_content')
    .select('id, identity, kind, content, title, summary, slug, reply_to, status, discord_message_id')
    .eq('id', id)
    .maybeSingle();
  return (data as ContentRow) ?? null;
}

async function editCard(row: ContentRow, embed: DiscordEmbed): Promise<void> {
  const webhook = webhookFor(row.identity);
  if (!webhook || !row.discord_message_id) return;
  try { await editDiscordCard(webhook, row.discord_message_id, { embeds: [embed] }); } catch { /* best-effort */ }
}

/** Post the approve card for a freshly-queued draft. Best-effort; the row stays
 *  approvable from the admin page even if the card fails to post. */
export async function postApprovalCard(id: string): Promise<boolean> {
  const row = await getRow(id);
  if (!row) return false;
  const webhook = webhookFor(row.identity);
  if (!webhook) return false;
  try {
    const messageId = await sendDiscordCardReturningId(webhook, { embeds: [pendingEmbed(row)] });
    if (messageId) {
      await db.from('app_nostr_content').update({ discord_message_id: messageId }).eq('id', id);
      return true;
    }
  } catch { /* card failure must not lose the row */ }
  return false;
}

export interface ContentDecisionResult { ok: boolean; status: string; event_id?: string | null; error?: string }

/** Approve + publish. Idempotent on status: a non-pending row is left untouched. */
export async function approveContent(id: string): Promise<ContentDecisionResult> {
  const row = await getRow(id);
  if (!row) return { ok: false, status: 'not_found', error: 'draft not found' };
  if (row.status !== 'pending') return { ok: false, status: row.status, error: `already ${row.status}` };

  // Claim the row so a double-click / link prefetch cannot double-publish.
  const { data: claimed } = await db
    .from('app_nostr_content')
    .update({ status: 'approving', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (!claimed) {
    const fresh = await getRow(id);
    return { ok: false, status: fresh?.status ?? 'unknown', error: 'already handled' };
  }

  const content: StoredContent = {
    identity: row.identity, kind: row.kind, content: row.content,
    title: row.title, summary: row.summary, slug: row.slug, reply_to: row.reply_to,
  };
  const result = await publishStoredContent(content);
  if (!result.ok) {
    // Roll back to pending so it can be retried.
    await db.from('app_nostr_content').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', id);
    return { ok: false, status: 'publish_failed', error: 'no relay accepted (or identity key/relays unset)' };
  }
  await db
    .from('app_nostr_content')
    .update({
      status: 'posted', event_id: result.eventId ?? null, npub: result.npub ?? null,
      relays_ok: result.relays ?? null, approved_by: 'discord', posted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  await editCard(row, outcomeEmbed(row, true, result.eventId));
  return { ok: true, status: 'posted', event_id: result.eventId };
}

export async function rejectContent(id: string): Promise<ContentDecisionResult> {
  const row = await getRow(id);
  if (!row) return { ok: false, status: 'not_found', error: 'draft not found' };
  if (row.status !== 'pending') return { ok: false, status: row.status, error: `already ${row.status}` };
  await db.from('app_nostr_content').update({ status: 'rejected', approved_by: 'discord', updated_at: new Date().toISOString() }).eq('id', id);
  await editCard(row, outcomeEmbed(row, false));
  return { ok: true, status: 'rejected' };
}
