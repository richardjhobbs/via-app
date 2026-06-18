/**
 * scripts/nostr-broadcaster.mjs
 *
 * Tier 2b of the NOSTR exposure plan (docs/nostr-exposure-plan.md): the fan-out.
 * A self-hosted equivalent of broadcastr, in Node (the VPS has no Rust toolchain
 * and compiling on the 4GB prod box is unsafe). It subscribes to the VIA relay,
 * filters to the VIA identities, and republishes every VIA event to a broad set
 * of public relays, so VIA demand and content reach the wider Nostr network, not
 * just relay.getvia.xyz and the in-app curated mirror set.
 *
 * Read-mode: it reads from relay.getvia.xyz (where the app already publishes ALL
 * VIA events) and writes outward. No app redeploy, no new public endpoint.
 *
 * Author-filtered: only events signed by via / priscilla / rosie are forwarded,
 * so inbound external intent-requests sitting on our relay are never blasted to
 * the network (those become VIA Demand events under the VIA key, which ARE
 * forwarded). Live-only (since=start): a restart never re-forwards old events, so
 * kind:1 notes are not duplicated on the network.
 *
 * Source subscription uses per-relay Relay.connect (NOT SimplePool.subscribeMany,
 * which sends a malformed envelope to the khatru relay.getvia.xyz). Target
 * publishing uses bounded-concurrency ephemeral connections so the box never holds
 * hundreds of open sockets.
 *
 * Persistent process (pm2), like via-nostr-listener. Run: node nostr-broadcaster.mjs
 *
 * Env:
 *   SOURCE_RELAYS   csv, default wss://relay.getvia.xyz
 *   AUTHORS         csv hex pubkeys to forward (required)
 *   TARGETS_URL     JSON array of relay URLs, default https://codonaft.com/relays.json
 *   CORE_TARGETS    csv always-included targets
 *   MAX_TARGETS     cap on target count (default 500)
 *   PUBLISH_CONCURRENCY  simultaneous target publishes (default 20)
 *   PUBLISH_TIMEOUT_MS   per-relay publish timeout (default 6000)
 *   TARGETS_REFRESH_MS   re-fetch the target list (default 6h)
 */
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';
useWebSocketImplementation(WebSocket);

const SOURCE_RELAYS = (process.env.SOURCE_RELAYS || 'wss://relay.getvia.xyz')
  .split(',').map((s) => s.trim()).filter(Boolean);
const AUTHORS = (process.env.AUTHORS || '').split(',').map((s) => s.trim()).filter(Boolean);
const TARGETS_URL = process.env.TARGETS_URL || 'https://codonaft.com/relays.json';
const CORE_TARGETS = (process.env.CORE_TARGETS
  || 'wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net,wss://relay.nostr.band,wss://purplepag.es')
  .split(',').map((s) => s.trim()).filter(Boolean);
const MAX_TARGETS = Number(process.env.MAX_TARGETS || 500);
// Hosts that appear in public relay lists but are not Nostr relays (e.g. generic
// WebSocket echo servers); connecting to them just spews parse-error noise.
const DENY_HOSTS = (process.env.DENY_HOSTS || 'echo.websocket.org,echo.websocket.events')
  .split(',').map((s) => s.trim()).filter(Boolean);
const PUBLISH_CONCURRENCY = Number(process.env.PUBLISH_CONCURRENCY || 20);
const PUBLISH_TIMEOUT_MS = Number(process.env.PUBLISH_TIMEOUT_MS || 6000);
const TARGETS_REFRESH_MS = Number(process.env.TARGETS_REFRESH_MS || 6 * 3600 * 1000);

if (AUTHORS.length === 0) { console.error('AUTHORS (csv hex pubkeys) required'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START = Math.floor(Date.now() / 1000);
const seen = new Set();            // event ids already forwarded this session
let targets = [...CORE_TARGETS];   // refreshed from TARGETS_URL

// Fetch + filter the wide target list: clearnet wss:// only (drop ws:// + .onion).
async function refreshTargets() {
  try {
    const res = await fetch(TARGETS_URL, { signal: AbortSignal.timeout(15000) });
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('targets list is not an array');
    const wss = list
      .map((u) => String(u).trim())
      .filter((u) => u.startsWith('wss://') && !u.includes('.onion'))
      .filter((u) => !DENY_HOSTS.some((h) => u.includes(h)));
    const merged = Array.from(new Set([...CORE_TARGETS, ...wss])).slice(0, MAX_TARGETS);
    targets = merged;
    console.log(`[broadcaster] targets refreshed: ${targets.length} relays (of ${list.length} listed)`);
  } catch (e) {
    console.error(`[broadcaster] targets refresh failed (${e?.message || e}); keeping ${targets.length}`);
  }
}

// Publish one event to one relay; never throws and never hangs. Both the connect
// and the publish are time-bounded , a dead-but-listening relay must not be able
// to stall a fan-out worker forever. A connection that resolves after we gave up
// is still closed, so no socket leaks across thousands of fan-outs.
async function publishOne(url, event) {
  let relay = null;
  let timedOut = false;
  const connectP = Relay.connect(url).then((r) => {
    relay = r;
    if (timedOut) { try { r.close(); } catch { /* ignore */ } }
    return r;
  });
  try {
    const r = await Promise.race([
      connectP,
      new Promise((_, rej) => setTimeout(() => { timedOut = true; rej(new Error('connect timeout')); }, PUBLISH_TIMEOUT_MS)),
    ]);
    await Promise.race([
      r.publish(event),
      new Promise((_, rej) => setTimeout(() => rej(new Error('publish timeout')), PUBLISH_TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    try { relay?.close(); } catch { /* ignore */ }
  }
}

// Fan one event out to all targets with bounded concurrency.
async function fanOut(event) {
  let ok = 0;
  const queue = [...targets];
  async function worker() {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      if (await publishOne(url, event)) ok += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(PUBLISH_CONCURRENCY, queue.length) }, worker));
  return ok;
}

async function onEvent(event) {
  if (seen.has(event.id)) return;
  if (event.created_at < START) return;     // live-only; never re-forward old events
  seen.add(event.id);
  if (seen.size > 50000) seen.clear();       // bound memory
  const ok = await fanOut(event);
  console.log(`[broadcaster] kind ${event.kind} ${event.id.slice(0, 10)} from ${event.pubkey.slice(0, 8)} -> ${ok}/${targets.length} relays`);
}

// One resilient subscribe loop per source relay (Relay.connect, khatru-safe).
async function watch(url) {
  const filter = { authors: AUTHORS, since: START };
  for (;;) {
    try {
      const relay = await Relay.connect(url);
      console.log(`[broadcaster] source connected ${url}`);
      relay.subscribe([filter], { onevent(e) { onEvent(e); } });
      while (relay.connected) await sleep(5000);
      console.log(`[broadcaster] source ${url} disconnected; reconnecting`);
    } catch (e) {
      console.error(`[broadcaster] source ${url} connect failed: ${e?.message || e}`);
    }
    await sleep(5000);
  }
}

await refreshTargets();
setInterval(refreshTargets, TARGETS_REFRESH_MS);
console.log(`[broadcaster] forwarding ${AUTHORS.length} author(s) from ${SOURCE_RELAYS.length} source relay(s) to up to ${MAX_TARGETS} targets`);
for (const url of SOURCE_RELAYS) watch(url);

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
