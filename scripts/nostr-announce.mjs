/**
 * scripts/nostr-announce.mjs
 *
 * Tier 5 of the NOSTR exposure plan: the agent-discovery announcement. Publishes a
 * NIP-89 handler-information event (kind 31990) from the VIA platform identity,
 * declaring that VIA handles the VIA event kinds. NIP-90 service providers also
 * advertise via NIP-89 / kind 31990, so this is how an agent scanning Nostr for a
 * service that handles via-demand / via-intent-request events discovers VIA and
 * its MCP + x402 door.
 *
 * Signed with the existing platform key (NOSTR_PLATFORM_SK) , the same identity
 * that publishes demand. Published to relay.getvia.xyz (the VPS broadcaster then
 * fans it to the wider network) plus the profile relays. kind 31990 is addressable
 * by `d`, so re-running replaces rather than duplicates.
 *
 * Run:  node --env-file=.env.local scripts/nostr-announce.mjs [--dry-run]
 */
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';
useWebSocketImplementation(WebSocket);

const DRY_RUN = process.argv.includes('--dry-run');
const VIA_EXPECTED_NPUB = 'npub1090lnrafjgdvcr33qe0mgaega3mgvqkpw3c0qlrg2qyfqy0n8ftspksd3f';
const RELAYS = [
  'wss://relay.getvia.xyz',
  'wss://relay.nostr.band',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://purplepag.es',
];

// VIA event kinds (defaults from lib/app/broadcast/nostr-protocol.ts).
const KIND_DEMAND = 30495;
const KIND_INTENT_REQUEST = 30496;
const KIND_OFFER_RECEIPT = 30497;
const APP = 'https://app.getvia.xyz';

function resolveSecretKey(raw) {
  const v = String(raw).trim().replace(/^["']|["']$/g, '');
  if (v.startsWith('nsec')) { const d = nip19.decode(v); if (d.type !== 'nsec') throw new Error('not an nsec'); return d.data; }
  const c = v.startsWith('0x') ? v.slice(2) : v;
  if (c.length !== 64 || !/^[0-9a-fA-F]+$/.test(c)) throw new Error('bad hex secret key');
  const o = new Uint8Array(32); for (let i = 0; i < 32; i++) o[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16); return o;
}

const raw = process.env.NOSTR_PLATFORM_SK;
if (!raw) { console.error('NOSTR_PLATFORM_SK missing. Run with: node --env-file=.env.local'); process.exit(1); }
const sk = resolveSecretKey(raw);
const npub = nip19.npubEncode(getPublicKey(sk));
if (npub !== VIA_EXPECTED_NPUB) { console.error(`ABORT: key derives ${npub}, expected ${VIA_EXPECTED_NPUB}`); process.exit(1); }

// NIP-89 handler-information content is kind:0-style metadata.
const metadata = {
  name: 'VIA',
  display_name: 'VIA Labs',
  about:
    'Agentic commerce demand exchange. Read via-demand events (kind 30495) and respond at the x402 door, '
    + 'or publish a via-intent-request (kind 30496) to broadcast your own demand with no VIA account. '
    + `Settlement is USDC on Base via the network MCP at ${APP}/mcp. Spec: ${APP.replace('app.', '')}/.well-known/via-protocol.md`,
  website: 'https://getvia.xyz',
  nip05: '_@getvia.xyz',
};

const template = {
  kind: 31990,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ['d', 'via-handler'],
    ['k', String(KIND_DEMAND)],
    ['k', String(KIND_INTENT_REQUEST)],
    ['k', String(KIND_OFFER_RECEIPT)],
    ['web', `${APP}/demand`],
    ['t', 'via'],
    ['t', 'agenticcommerce'],
  ],
  content: JSON.stringify(metadata),
};

console.log(`NIP-89 handler announcement for ${npub}`);
console.log(`  kinds: ${KIND_DEMAND}, ${KIND_INTENT_REQUEST}, ${KIND_OFFER_RECEIPT}`);
if (DRY_RUN) { console.log('[dry-run] would publish kind 31990 to:', RELAYS.join(', ')); process.exit(0); }

const event = finalizeEvent(template, sk);
async function pub(url) {
  try {
    const r = await Relay.connect(url);
    await Promise.race([r.publish(event), new Promise((_, j) => setTimeout(() => j(new Error('timeout')), 8000))]);
    r.close(); return true;
  } catch { return false; }
}
const results = await Promise.all(RELAYS.map((u) => pub(u).then((ok) => ({ u, ok }))));
const ok = results.filter((x) => x.ok).map((x) => x.u);
console.log(`published kind 31990 ${event.id.slice(0, 12)} -> ${ok.length}/${RELAYS.length} relays`);
console.log('(VPS broadcaster fans relay.getvia.xyz out to the wider network)');
process.exit(0);
