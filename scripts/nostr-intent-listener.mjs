/**
 * scripts/nostr-intent-listener.mjs
 *
 * The "open intent over NOSTR" listener. Subscribes to the configured relays
 * (the VIA relay + any public mirrors) for VIA Intent Request events
 * (kind NOSTR_VIA_INTENT_KIND, tag t=via-intent-request) published by EXTERNAL
 * agents that have no VIA account, and forwards each to the trusted ingest
 * endpoint POST /api/via/nostr/intent, which creates + broadcasts the brief.
 *
 * Uses the per-relay nostr-tools Relay primitive (NOT SimplePool.subscribeMany,
 * whose REQ envelope breaks live delivery on the khatru relay). Each relay is
 * watched in its own connect+subscribe loop that reconnects on drop.
 *
 * This is a PERSISTENT process (events arrive in real time) — run under pm2 or
 * systemd on the VPS, not as a 10-minute cron like the seller agent.
 *
 * Env: NOSTR_RELAYS (comma list, required), VIA_RELAY (optional extra),
 *      VIA_BASE (default https://app.getvia.xyz), NOSTR_INGEST_SECRET (required,
 *      must match the endpoint), NOSTR_VIA_INTENT_KIND (default 30496).
 */
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';
useWebSocketImplementation(WebSocket);

const VIA_BASE = (process.env.VIA_BASE || 'https://app.getvia.xyz').replace(/\/$/, '');
const SECRET = process.env.NOSTR_INGEST_SECRET;
const KIND = Number(process.env.NOSTR_VIA_INTENT_KIND ?? '30496');
const T_INTENT_REQUEST = 'via-intent-request';
const FILTER = { kinds: [KIND], '#t': [T_INTENT_REQUEST] };

const relays = [
  ...(process.env.NOSTR_RELAYS || '').split(',').map((s) => s.trim()).filter(Boolean),
  ...(process.env.VIA_RELAY ? [process.env.VIA_RELAY.trim()] : []),
];
if (!SECRET) { console.error('NOSTR_INGEST_SECRET required'); process.exit(1); }
if (relays.length === 0) { console.error('NOSTR_RELAYS required'); process.exit(1); }

const seen = new Set(); // in-memory event-id dedup (the endpoint dedups durably)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function forward(event) {
  if (seen.has(event.id)) return;
  seen.add(event.id);
  let intent;
  try { intent = JSON.parse(event.content); } catch { console.warn(`[listener] bad content on ${event.id.slice(0, 12)}`); return; }
  if (!intent || typeof intent !== 'object') return;
  try {
    const res = await fetch(`${VIA_BASE}/api/via/nostr/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nostr-ingest-secret': SECRET },
      body: JSON.stringify({ event_id: event.id, pubkey: event.pubkey, intent }),
      signal: AbortSignal.timeout(15000),
    });
    const out = await res.json().catch(() => ({}));
    console.log(`[listener] ${event.id.slice(0, 12)} from ${event.pubkey.slice(0, 8)} -> ${res.status} ${out.intent_id ? `brief=${out.intent_id}${out.deduped ? ' (dedup)' : ''}` : (out.error || '')}`);
  } catch (e) {
    console.error(`[listener] forward failed for ${event.id.slice(0, 12)}:`, e?.message || e);
  }
}

// One resilient connect+subscribe loop per relay. Relay.subscribe delivers live
// events correctly on khatru (subscribeMany does not). Reconnects on drop.
async function watch(url) {
  for (;;) {
    try {
      const relay = await Relay.connect(url);
      console.log(`[listener] connected ${url}`);
      relay.subscribe([FILTER], { onevent(e) { forward(e); } });
      while (relay.connected) await sleep(5000);
      console.log(`[listener] ${url} disconnected; reconnecting`);
    } catch (e) {
      console.error(`[listener] ${url} connect failed: ${e?.message || e}`);
    }
    await sleep(5000);
  }
}

console.log(`[listener] watching ${relays.length} relay(s) for VIA intent requests (kind ${KIND})`);
for (const url of relays) watch(url);

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
