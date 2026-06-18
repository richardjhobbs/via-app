# NOSTR maximum-exposure build plan

Goal (Richard): any intent on VIA appears on relay.getvia.xyz and then on as many
other NOSTR feeds as practical, in front of both humans and agents. Plus Priscilla
(human depth) and Rosie (agent depth) posting standalone content. Not just the
relay.getvia.xyz feed.

## What is already live (do not rebuild)

The repo already ships a v1 protocol that is deployed and verified end to end:

- Own relay `wss://relay.getvia.xyz` (khatru on the VPS, under pm2).
- VIA Demand events, kind 30495, broadcast on every intent via `lib/app/broadcast/`
  to relay.getvia.xyz + mirrors (damus, nos.lol, primal, nostr.band). Verified
  landing: damus 9, nos.lol 9, primal 2, own relay 10 as of this plan.
- Inbound intent listener (kind 30496) on the VPS (pm2 `via-nostr-listener`) ->
  `POST /api/via/nostr/intent` -> creates + broadcasts a brief.
- Offer Receipt (kind 30497) p-tagged back to the inbound buyer.
- Paid-door invariant respected: only the teaser (category, product type, one
  attribute) + the x402 door URL go on the relay. The full brief stays behind the door.
- Platform npub `npub1090lnrafjgdvcr33qe0mgaega3mgvqkpw3c0qlrg2qyfqy0n8ftspksd3f`.

The canonical rail (30495/30496/30497) stays as is. It is correct and paid-door safe.

## How the draft via-nostr package is reconciled

The downloaded `via-nostr` package is a parallel design (kind:1 + kind:5333 + its own
DB trigger/queue). Most of it duplicates the live rail and one part breaks the paid
door. Decision:

- DROP the draft's `app_nostr_publish_queue` table + DB trigger + `intent-worker.js`.
  The live in-app `broadcastTeaser()` already fires on every intent. A second queue
  on the DB is a duplicate broadcast path.
- DROP the draft's kind:5333 structured event. The live 30495 Demand event is already
  the agent-native event (machine JSON block + x402 hints). 5333 is pure redundancy.
- DROP the draft's `brief` / `requirements` / `preferences` in the relay payload. That
  is more than the teaser and breaks the paid-door invariant.
- ADOPT, folded into the existing rail: profile + relay-list bootstrap, a teaser-only
  human note, the Priscilla/Rosie content identities + endpoint, the outreach listener.

Key correction to the draft's keygen: `via` is NOT a new key. It is the EXISTING
platform key (npub1090...). Bootstrap must attach the profile/relay-list to that npub
so they sit on the identity that is already publishing demand. Only `priscilla` and
`rosie` are new keypairs.

## The exposure levers, by leverage

### Tier 1 — discoverability foundation (cheap, currently missing)

This is the highest-value gap. The VIA npub has NO kind:0 profile and NO kind:10002
relay list on any relay (verified). So in every client it is a faceless hex key, and
the outbox/gossip model has no way to learn that VIA writes to relay.getvia.xyz.

1. Publish kind:0 profile + kind:10002 NIP-65 relay list for `via`, `priscilla`,
   `rosie`. Push to `purplepag.es` (the profile/relay-list aggregator clients resolve
   from), `relay.nostr.band` (the search index), and relay.getvia.xyz. This is the
   draft's `bootstrap.js`, fixed to use the existing via key.
2. NIP-05 verification. The via profile already claims `_@getvia.xyz`. Serve
   `https://getvia.xyz/.well-known/nostr.json` mapping `_` and `priscilla`/`rosie` to
   their hex pubkeys, so VIA shows as a verified, named identity, not a hex string.

### Tier 2 — reach amplification

3. broadcastr sidecar on the VPS. The live mirror set is a curated 5 relays.
   `broadcastr` (codonaft/broadcastr) is a self-hosted relay that re-transmits every
   event it receives to all known online relays, with dedup, PoW and an allow/ignore
   list. Point the in-app publish (and the content endpoint) at broadcastr as one of
   its relay URLs; broadcastr fans every VIA event out to the wider network. This is
   the literal "as many feeds as practical" mechanism. (blastr on Cloudflare Workers
   is the no-extra-process fallback if we do not want another VPS service.)
4. Teaser-only human note (kind:1) per demand. Generic clients (Damus, Primal,
   Amethyst, Snort) render kind:1 text notes; they do NOT show addressable kind 30495
   in the human scroll feed. So today the demand lands on those relays but is invisible
   to humans. Emit a second event from the existing `lib/app/broadcast/` path: a kind:1
   note carrying ONLY the teaser summary (category, product type, attribute) + the door
   URL + `#t` tags. No brief, no scrubbed intent_text (paid door). Done in-app next to
   `buildDemandEvent`, no queue.

### Tier 3 — agent-targeted discovery

5. NIP-89 application-handler event + NIP-90 DVM announcement so agents scanning NOSTR
   for paid services discover VIA as a commerce/data capability, pointed at the 30495
   demand stream and the MCP/x402 door. (Confirm exact kinds against the live NIPs at
   build.) Publish to nostr.band + the big public relays.
6. Publish the protocol spec (`docs/nostr-via-protocol.md`) as a kind:30023 long-form
   under Rosie and link it from all three profiles, so a developer or agent landing on
   the npub has the full how-to-participate.

### Tier 4 — content depth (Priscilla = humans, Rosie = agents)

7. Priscilla: plain-English explainers of agentic commerce, brand spotlights, a weekly
   read on live demand. kind:1 for reach, occasional kind:30023 long-form. Routed to
   the human relay set + broadcastr.
8. Rosie: the intent spec, how to subscribe and respond, the category taxonomy, store
   self-registration, the NIP-89/90 announcements. Routed to the agent relay set +
   broadcastr.
9. Both keep the draft-then-approve gate. They post via the content-server endpoint
   (`POST /post` with a shared token). Sending stays human-approved until a pattern
   proves out.

### Tier 5 — proactive outreach (Rosie)

10. The draft's outreach listener: subscribe across the nostr.band index + damus +
    nos.lol + primal, score notes and NIP-99 classifieds against buying-intent phrasing
    and VIA's category vocabulary, split into demand (buyers to match) and supply
    (brands/sellers to recruit), dedupe into `app_nostr_outreach`, and notify the
    channel Rosie reads. Rosie drafts a reply/follow; sending is approved first.

Plus: list `relay.getvia.xyz` on nostr.watch (runtime discovery; publish a kind:3 from
a healthy known relay).

## Where it runs

- The kind:1 human note: in-app, Vercel, next to the existing 30495 publish. No new infra.
- bootstrap (profiles/relay-lists), content endpoint (Priscilla/Rosie signing),
  outreach listener: the `via-nostr` service on the VPS, alongside the relay, the
  inbound listener and the seller agent. Keys live in `.env` on the VPS only.
- broadcastr: a second pm2/systemd process on the VPS; the in-app publish adds its
  wss URL to NOSTR_RELAYS.
- NIP-05 `nostr.json`: a static file on the getvia.xyz marketing site (separate repo).

OPEN ITEM to confirm before build: where the Hermes agents (Priscilla, Rosie) actually
run now, since that decides whether the content endpoint is co-located with them or
called over the network. They call it over HTTP with a token, so it is flexible, but
confirm the host. Default: the content endpoint runs on the VPS with the keys.

## Build order

1. Bootstrap profiles + NIP-65 relay lists (via existing key, priscilla, rosie) +
   NIP-05 nostr.json. Immediate discoverability win, low risk.
2. In-app teaser-only kind:1 human note alongside 30495. Demand becomes human-visible.
3. broadcastr on the VPS + add to the relay set. Network-wide fan-out.
4. Content endpoint live; Priscilla + Rosie post depth, approve-gated.
5. NIP-89/90 service announcement + the spec as a long-form.
6. Outreach listener on, low min-score, Discord/Telegram notify; Rosie engages,
   approve-gated.
7. nostr.watch listing.
