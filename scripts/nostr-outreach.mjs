/**
 * scripts/nostr-outreach.mjs
 *
 * Tier 6 of the NOSTR exposure plan: outreach DISCOVERY. Reads the wider Nostr
 * network, scores events as outreach candidates (buyers posting demand VIA could
 * match, or sellers/brands worth recruiting), and persists them to
 * app_nostr_outreach for Rosie to work. DISCOVERY ONLY , this process never posts.
 * Engagement (Rosie replying / following) goes through the content endpoint and
 * stays human-approved.
 *
 * Per-relay Relay.connect with reconnect (same resilient pattern as the inbound
 * listener). Live-only (since=start). Never targets our own identities.
 *
 * Persistent process (pm2). Run: node nostr-outreach.mjs
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (required, via-agent-mcp)
 *   OUTREACH_RELAYS    csv, default nostr.band + damus + nos.lol + primal
 *   OUTREACH_CATEGORIES csv, empty = built-in VIA vocabulary
 *   OUTREACH_MIN_SCORE  default 2
 *   OWN_PUBKEYS        csv hex, our identities to never flag as candidates
 *   DISCORD_OUTREACH_WEBHOOK  optional; ping a channel Rosie reads
 */
import { createClient } from '@supabase/supabase-js';
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';
useWebSocketImplementation(WebSocket);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTREACH_RELAYS = (process.env.OUTREACH_RELAYS
  || 'wss://relay.nostr.band,wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net')
  .split(',').map((s) => s.trim()).filter(Boolean);
const OUTREACH_MIN_SCORE = Number(process.env.OUTREACH_MIN_SCORE || 2);
const OWN_PUBKEYS = new Set((process.env.OWN_PUBKEYS || '').split(',').map((s) => s.trim()).filter(Boolean));
const DISCORD_OUTREACH_WEBHOOK = process.env.DISCORD_OUTREACH_WEBHOOK || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

// --- targeting (pure scoring) ---
const BUY_PHRASES = [
  'looking for', 'anyone selling', 'where can i buy', 'where to buy', 'recommendations for',
  'recommend a', 'need a', 'want to buy', 'in search of', 'iso ', 'wtb', 'hunting for',
  'trying to find', 'any good', 'best place to buy',
];
const SELL_PHRASES = ['for sale', 'now available', 'just dropped', 'shop now', 'restocked', 'new collection', 'limited drop'];
const DEFAULT_CATEGORIES = [
  'denim', 'selvedge', 'sneakers', 'streetwear', 'vintage', 'fashion', 'jacket', 'boots',
  'watch', 'vinyl', 'record', 'coffee', 'fragrance', 'leather', 'cap', 'eyewear', 'workwear',
];
const CATS = (process.env.OUTREACH_CATEGORIES ? process.env.OUTREACH_CATEGORIES.split(',') : DEFAULT_CATEGORIES)
  .map((c) => c.trim().toLowerCase()).filter(Boolean);

function score(event) {
  if (!event || OWN_PUBKEYS.has(event.pubkey)) return null;
  const text = String(event.content || '').toLowerCase();
  if (!text) return null;
  const matched = [];
  let signal = null;
  for (const p of BUY_PHRASES) if (text.includes(p)) { matched.push(`buy:${p.trim()}`); signal = 'demand'; }
  for (const p of SELL_PHRASES) if (text.includes(p)) { matched.push(`sell:${p.trim()}`); signal = signal || 'supply'; }
  const hitCats = CATS.filter((c) => text.includes(c));
  for (const c of hitCats) matched.push(`cat:${c}`);
  if (event.kind === 30402) { signal = signal || 'supply'; matched.push('nip99:listing'); }
  const s = (signal ? 1 : 0) + hitCats.length + (matched.some((m) => m.startsWith('buy:')) ? 1 : 0);
  if (s < OUTREACH_MIN_SCORE || !signal) return null;
  return { signal, category: hitCats[0] || null, matched, score: s };
}

// --- persistence + notify ---
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function notifyDiscord(card) {
  if (!DISCORD_OUTREACH_WEBHOOK) return;
  try {
    await fetch(DISCORD_OUTREACH_WEBHOOK, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content:
        `**Nostr outreach candidate** (${card.signal}, score ${card.score})\n`
        + `npub: ${card.candidate_npub}\ncategory: ${card.category || 'n/a'} | matched: ${card.matched.join(', ')}\n`
        + `> ${card.content.slice(0, 240)}` }),
    });
  } catch (e) { console.error('[outreach] discord notify failed:', e?.message || e); }
}

const seen = new Set();
async function persist(event, verdict) {
  if (seen.has(event.id)) return;
  seen.add(event.id);
  if (seen.size > 50000) seen.clear();
  const card = {
    event_id: event.id, pubkey: event.pubkey, candidate_npub: nip19.npubEncode(event.pubkey),
    kind: event.kind, signal: verdict.signal, category: verdict.category, score: verdict.score,
    matched: verdict.matched, content: String(event.content || '').slice(0, 600),
  };
  const { error } = await db.from('app_nostr_outreach').upsert(card, { onConflict: 'event_id', ignoreDuplicates: true });
  if (error) { console.error('[outreach] persist failed:', error.message); return; }
  console.log(`[outreach] ${verdict.signal} score ${verdict.score} ${card.candidate_npub} (${verdict.matched.join(',')})`);
  await notifyDiscord(card);
}

// --- relay subscriptions ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START = Math.floor(Date.now() / 1000);

async function watch(url) {
  const filters = [{ kinds: [1], since: START }, { kinds: [30402], since: START }];
  for (;;) {
    try {
      const relay = await Relay.connect(url);
      console.log(`[outreach] connected ${url}`);
      relay.subscribe(filters, { onevent(e) { const v = score(e); if (v) persist(e, v); } });
      while (relay.connected) await sleep(5000);
      console.log(`[outreach] ${url} disconnected; reconnecting`);
    } catch (e) {
      console.error(`[outreach] ${url} connect failed: ${e?.message || e}`);
    }
    await sleep(5000);
  }
}

console.log(`[outreach] discovery on ${OUTREACH_RELAYS.length} relays, minScore ${OUTREACH_MIN_SCORE}, ${CATS.length} categories; discovery only (engagement is gated)`);
for (const url of OUTREACH_RELAYS) watch(url);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
