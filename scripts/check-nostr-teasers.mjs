/**
 * scripts/check-nostr-teasers.mjs
 *
 * Read-only: query the given NOSTR relays for recent VIA demand teasers
 * (kind-1 events tagged t=via, as published by lib/app/broadcast/nostr.ts) and
 * print count + timestamps + a content snippet. No keys, no writes.
 *
 * Usage: node scripts/check-nostr-teasers.mjs wss://relay1 wss://relay2 ...
 */
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';
useWebSocketImplementation(WebSocket);

const relays = process.argv.slice(2).filter((s) => s.startsWith('ws'));
if (relays.length === 0) { console.error('Usage: node scripts/check-nostr-teasers.mjs wss://relay ...'); process.exit(1); }

const pool = new SimplePool();
const events = [];
// nostr-tools 2.23+ subscribeMany takes ONE filter object, not an array; an
// array is silently matched against nothing (or rejected) by relays.
const sub = pool.subscribeMany(relays, { kinds: [1], '#t': ['via'], limit: 30 }, {
  onevent(e) { events.push(e); },
});

setTimeout(() => {
  sub.close();
  try { pool.close(relays); } catch { /* ignore */ }
  events.sort((a, b) => b.created_at - a.created_at);
  console.log(`relays queried: ${relays.length}`);
  console.log(`VIA teaser events (t=via, kind 1): ${events.length}`);
  for (const e of events.slice(0, 10)) {
    const when = new Date(e.created_at * 1000).toISOString();
    const door = (e.tags.find((t) => t[0] === 'r') || [])[1] || '(no door tag)';
    console.log(`  ${when}  id=${e.id.slice(0, 12)}  door=${door}`);
    console.log(`      ${String(e.content).slice(0, 120)}`);
  }
  process.exit(0);
}, 7000);
