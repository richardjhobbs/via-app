/**
 * scripts/nostr-bootstrap.mjs
 *
 * Tier 1 of the NOSTR exposure plan (docs/nostr-exposure-plan.md): publish the
 * kind:0 profile + kind:10002 NIP-65 relay list for the three VIA identities so
 * the npubs are discoverable and clients/agents resolve relay.getvia.xyz as the
 * write relay. Today the VIA npub has neither, so it shows as a faceless hex key
 * and the outbox model cannot route to our relay.
 *
 * Identities:
 *   via       = the EXISTING platform key (NOSTR_PLATFORM_SK). NOT a new key. The
 *               script asserts the derived npub matches the live demand publisher
 *               before it publishes anything under that identity.
 *   priscilla = human-facing content identity. Read from NOSTR_NSEC_PRISCILLA, or
 *               generated on first run and appended to .env.local.
 *   rosie     = agent-facing content + outreach identity. Same handling.
 *
 * Publish path uses per-relay Relay.connect (NOT SimplePool.subscribeMany, which
 * sends a malformed envelope to the khatru relay.getvia.xyz).
 *
 * Run:  node --env-file=.env.local scripts/nostr-bootstrap.mjs
 *       node --env-file=.env.local scripts/nostr-bootstrap.mjs --dry-run
 */
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay';
import { finalizeEvent, getPublicKey, generateSecretKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';
import { appendFileSync } from 'node:fs';

useWebSocketImplementation(WebSocket);

const DRY_RUN = process.argv.includes('--dry-run');

// The live demand publisher. The via profile MUST attach to this exact npub.
const VIA_EXPECTED_NPUB = 'npub1090lnrafjgdvcr33qe0mgaega3mgvqkpw3c0qlrg2qyfqy0n8ftspksd3f';

const VIA_RELAY = 'wss://relay.getvia.xyz';
// Push profile + relay list broadly so any client resolving from any of these
// finds the identity. purplepag.es is the profile/relay-list aggregator; nostr.band
// is the search index.
const PROFILE_RELAYS = [
  VIA_RELAY,
  'wss://purplepag.es',
  'wss://relay.nostr.band',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

// NIP-65: relay.getvia.xyz is the canonical write relay; the public mirrors are read.
const RELAY_LIST_TAGS = [
  ['r', VIA_RELAY, 'write'],
  ['r', 'wss://relay.damus.io', 'read'],
  ['r', 'wss://nos.lol', 'read'],
  ['r', 'wss://relay.nostr.band', 'read'],
  ['r', 'wss://relay.primal.net', 'read'],
];

const PROFILES = {
  via: {
    name: 'VIA',
    display_name: 'VIA Labs',
    about: 'Agentic commerce settled in USDC on Base. Buyer agents broadcast intents here; seller agents respond and settle at the x402 door. getvia.xyz',
    website: 'https://getvia.xyz',
    nip05: '_@getvia.xyz',
    picture: 'https://app.getvia.xyz/via-mark.png',
  },
  priscilla: {
    name: 'Priscilla',
    display_name: 'Priscilla (VIA)',
    about: 'Marketing and content for VIA Labs. Plain explanations of agentic commerce for the people building, selling, and buying in it.',
    website: 'https://getvia.xyz',
    nip05: 'priscilla@getvia.xyz',
    picture: 'https://app.getvia.xyz/priscilla-avatar.png',
  },
  rosie: {
    name: 'Rosie',
    display_name: 'Rosie (VIA)',
    about: 'Agent outreach and protocol notes for VIA Labs. How the intent feed, event kinds, and on-network settlement work, written for agents and the developers who run them.',
    website: 'https://getvia.xyz',
    nip05: 'rosie@getvia.xyz',
    picture: 'https://app.getvia.xyz/rosie-avatar.png',
  },
};

function resolveSecretKey(raw) {
  const v = String(raw).trim().replace(/^["']|["']$/g, '');
  if (v.startsWith('nsec')) {
    const d = nip19.decode(v);
    if (d.type !== 'nsec') throw new Error('not an nsec');
    return d.data;
  }
  const clean = v.startsWith('0x') ? v.slice(2) : v;
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) throw new Error('bad hex secret key');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Build the identity table. via from the platform key; priscilla/rosie from env or generated.
const identities = {};
const generated = [];

// via
const viaRaw = process.env.NOSTR_PLATFORM_SK;
if (!viaRaw) { console.error('NOSTR_PLATFORM_SK missing. Run with: node --env-file=.env.local'); process.exit(1); }
const viaSk = resolveSecretKey(viaRaw);
const viaNpub = nip19.npubEncode(getPublicKey(viaSk));
if (viaNpub !== VIA_EXPECTED_NPUB) {
  console.error(`ABORT: NOSTR_PLATFORM_SK derives ${viaNpub}\n       expected the live publisher ${VIA_EXPECTED_NPUB}.`);
  process.exit(1);
}
identities.via = { sk: viaSk, npub: viaNpub };

// priscilla / rosie
for (const name of ['priscilla', 'rosie']) {
  const envKey = `NOSTR_NSEC_${name.toUpperCase()}`;
  const raw = process.env[envKey];
  if (raw) {
    const sk = resolveSecretKey(raw);
    identities[name] = { sk, npub: nip19.npubEncode(getPublicKey(sk)) };
  } else {
    const sk = generateSecretKey();
    const nsec = nip19.nsecEncode(sk);
    identities[name] = { sk, npub: nip19.npubEncode(getPublicKey(sk)) };
    generated.push({ name, envKey, nsec });
  }
}

// Persist any generated keys to .env.local so the same identities are reused.
if (generated.length && !DRY_RUN) {
  const block = '\n# --- NOSTR content identities (generated by scripts/nostr-bootstrap.mjs) ---\n'
    + generated.map((g) => `${g.envKey}=${g.nsec}`).join('\n') + '\n';
  appendFileSync('.env.local', block);
  console.log(`Generated ${generated.length} new identity key(s); appended to .env.local:`);
  for (const g of generated) console.log(`  ${g.envKey}  ->  ${identities[g.name].npub}`);
}

console.log('\nIdentities:');
for (const [name, id] of Object.entries(identities)) console.log(`  ${name.padEnd(10)} ${id.npub}`);

if (DRY_RUN) {
  console.log('\n[dry-run] would publish kind:0 + kind:10002 for each identity to:');
  for (const r of PROFILE_RELAYS) console.log(`  ${r}`);
  process.exit(0);
}

// Publish one signed event to one relay, bounded.
async function publishOne(url, event) {
  try {
    const relay = await Relay.connect(url);
    await Promise.race([
      relay.publish(event),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    relay.close();
    return true;
  } catch {
    return false;
  }
}

async function publishToAll(sk, template) {
  const event = finalizeEvent(
    { kind: template.kind, created_at: Math.floor(Date.now() / 1000), tags: template.tags || [], content: template.content || '' },
    sk,
  );
  const results = await Promise.all(PROFILE_RELAYS.map((r) => publishOne(r, event).then((ok) => ({ r, ok }))));
  const ok = results.filter((x) => x.ok).map((x) => x.r);
  return { id: event.id, ok };
}

for (const [name, id] of Object.entries(identities)) {
  const meta = await publishToAll(id.sk, { kind: 0, content: JSON.stringify(PROFILES[name]), tags: [] });
  const relayList = await publishToAll(id.sk, { kind: 10002, content: '', tags: RELAY_LIST_TAGS });
  console.log(`\n[${name}] ${id.npub}`);
  console.log(`  profile (kind 0)      -> ${meta.ok.length}/${PROFILE_RELAYS.length} relays  id=${meta.id.slice(0, 12)}`);
  console.log(`  relay list (kind 10002) -> ${relayList.ok.length}/${PROFILE_RELAYS.length} relays  id=${relayList.id.slice(0, 12)}`);
}

console.log('\nDone. Next: serve /.well-known/nostr.json on getvia.xyz so the nip05 names verify.');
process.exit(0);
