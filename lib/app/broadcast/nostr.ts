/**
 * lib/app/broadcast/nostr.ts
 *
 * NOSTR broadcast adapter. When a buyer broadcasts an intent, the platform
 * publishes its TEASER (category + product type + one attribute + the door URL) as
 * a signed NOSTR event to the configured relays. Any seller agent watching the
 * relay sees the teaser, self-selects, and , if interested , goes to the door URL
 * to pay the micro-fee, unlock the full brief, and respond. The platform does NOT
 * evaluate sellers; the relay is the broadcast, the seller decides on its own side.
 *
 * Only the teaser + the door pointer ever go on the relay. The full structured
 * brief and the offer stay behind the x402 door. The NOSTR keypair is the
 * PLATFORM's relay identity (env NOSTR_PLATFORM_SK), not a per-agent key , agent
 * identity remains the wallet.
 *
 * Configuration (both required, else this no-ops cleanly):
 *   NOSTR_PLATFORM_SK , platform secret key, 64-char hex or nsec1...
 *   NOSTR_RELAYS      , comma-separated wss:// relay URLs
 */
import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools/pure';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';
import type { TeaserBrief } from '../demand';
import { buildDemandEvent, buildHumanNote, buildOfferReceiptEvent, type OfferReceiptInput } from './nostr-protocol';

// Node has no dependable global WebSocket across versions; give nostr-tools one.
useWebSocketImplementation(WebSocket as unknown as typeof globalThis.WebSocket);

const PUBLISH_TIMEOUT_MS = 4000;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) throw new Error('bad hex secret key');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function resolveSecretKey(raw: string): Uint8Array {
  const v = raw.trim().replace(/^["']|["']$/g, '');
  if (v.startsWith('nsec')) {
    const d = nip19.decode(v);
    if (d.type !== 'nsec') throw new Error('secret key is not a valid nsec');
    return d.data;
  }
  return hexToBytes(v);
}

export interface NostrPublishResult { ok: boolean; relays: number; eventId?: string; npub?: string }

/** Sign an event template with the given secret key and publish to the configured
 *  relays (NOSTR_RELAYS). Best-effort, bounded, never throws. ok:false when the
 *  relay set is unset. relay.getvia.xyz is first in the prod set, so the VPS
 *  broadcaster picks the event up and fans it out to the wider network. */
async function publishWithKey(sk: Uint8Array, tmpl: EventTemplate): Promise<NostrPublishResult> {
  const relaysRaw = process.env.NOSTR_RELAYS;
  if (!relaysRaw) return { ok: false, relays: 0 };
  const relays = relaysRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (relays.length === 0) return { ok: false, relays: 0 };

  const pool = new SimplePool();
  try {
    const event = finalizeEvent(tmpl, sk);
    const publishes = pool.publish(relays, event);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, PUBLISH_TIMEOUT_MS));
    const settled = await Promise.race([Promise.allSettled(publishes), timeout]);
    const ok = Array.isArray(settled) ? settled.some((r) => r.status === 'fulfilled') : false;
    return { ok, relays: relays.length, eventId: event.id, npub: nip19.npubEncode(getPublicKey(sk)) };
  } catch (e) {
    console.warn('[nostr] publish failed:', e);
    return { ok: false, relays: relays.length };
  } finally {
    try { pool.close(relays); } catch { /* ignore */ }
  }
}

/** Sign with the platform key (NOSTR_PLATFORM_SK) and publish. */
async function publishSignedEvent(tmpl: EventTemplate): Promise<NostrPublishResult> {
  const skRaw = process.env.NOSTR_PLATFORM_SK;
  if (!skRaw) return { ok: false, relays: 0 };
  let sk: Uint8Array;
  try { sk = resolveSecretKey(skRaw); }
  catch (e) { console.warn('[nostr] bad NOSTR_PLATFORM_SK:', e); return { ok: false, relays: 0 }; }
  return publishWithKey(sk, tmpl);
}

/** The content identities Priscilla (human depth) and Rosie (agent depth) post
 *  under. Their nsecs live in env, never logged. The via platform identity is NOT
 *  exposed here , it only ever publishes automated demand/offer events. */
const CONTENT_KEY_ENV: Record<string, string> = {
  priscilla: 'NOSTR_NSEC_PRISCILLA',
  rosie: 'NOSTR_NSEC_ROSIE',
};

export function isContentIdentity(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONTENT_KEY_ENV, name);
}

/** Sign an approved content event with a named content identity and publish.
 *  Returns ok:false (relays:0) if the identity is unknown or its key is unset. */
export async function publishContentAs(identity: string, tmpl: EventTemplate): Promise<NostrPublishResult> {
  const envName = CONTENT_KEY_ENV[identity];
  const skRaw = envName ? process.env[envName] : undefined;
  if (!skRaw) return { ok: false, relays: 0 };
  let sk: Uint8Array;
  try { sk = resolveSecretKey(skRaw); }
  catch (e) { console.warn(`[nostr] bad ${envName}:`, e); return { ok: false, relays: 0 }; }
  return publishWithKey(sk, tmpl);
}

/** A queued content row (app_nostr_content) approved for publishing. */
export interface StoredContent {
  identity: string;
  kind:     number;            // 1 note | 30023 long-form
  content:  string;
  title?:   string | null;
  summary?: string | null;
  slug?:    string | null;
  reply_to?: { event_id?: string; pubkey?: string; relay?: string } | null;
}

/** Build the Nostr event from an approved content row and publish it under the
 *  row's identity. Used by the admin approval route, so the agent never holds
 *  the publish path. kind 1 and kind 30023 (NIP-23 long-form) are supported. */
export async function publishStoredContent(c: StoredContent): Promise<NostrPublishResult> {
  const now = Math.floor(Date.now() / 1000);
  const tags: string[][] = [];
  const rt = c.reply_to;
  if (rt?.event_id) {
    tags.push(['e', rt.event_id, rt.relay ?? '', 'reply']);
    if (rt.pubkey) tags.push(['p', rt.pubkey]);
  }
  if (c.kind === 30023) {
    tags.push(['d', (c.slug && c.slug.trim()) || `via-${now}`]);
    if (c.title?.trim()) tags.push(['title', c.title.trim()]);
    if (c.summary?.trim()) tags.push(['summary', c.summary.trim()]);
    tags.push(['published_at', String(now)]);
  }
  tags.push(['t', 'via']);
  return publishContentAs(c.identity, { kind: c.kind, created_at: now, tags, content: c.content });
}

/** Publish one teaser to the configured relays as BOTH events: the addressable
 *  VIA Demand event (kind 30495, agent-native) and a kind:1 human note (rendered
 *  in generic client feeds; addressable kinds are not). Both are awaited , a
 *  fire-and-forget publish never runs on Vercel serverless after the response.
 *  The return reflects the Demand event (the canonical agent rail); the human
 *  note is best-effort reach on top and never fails the broadcast. */
export async function publishTeaserToNostr(teaser: TeaserBrief): Promise<NostrPublishResult> {
  const demand = await publishSignedEvent(buildDemandEvent(teaser));
  const note = await publishSignedEvent(buildHumanNote(teaser));
  if (note.ok) console.log(`[nostr] human note ${teaser.brief_id} published to ${note.relays} relay(s)`);
  return demand;
}

/** Push one offer back to an inbound buyer's pubkey (VIA Offer Receipt event),
 *  so it can accept by settling THROUGH VIA. Best-effort, never throws. */
export async function publishOfferReceiptToNostr(input: OfferReceiptInput): Promise<NostrPublishResult> {
  return publishSignedEvent(buildOfferReceiptEvent(input));
}
