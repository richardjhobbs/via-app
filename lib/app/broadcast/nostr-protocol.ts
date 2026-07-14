/**
 * lib/app/broadcast/nostr-protocol.ts
 *
 * The VIA NOSTR protocol convention (v1) — the PUBLIC event format that makes
 * VIA an open, channel-agnostic demand exchange rather than a closed app. Any
 * agent on any framework can read these events off a relay and participate at
 * the canonical x402 door with NO VIA account. Full human-readable spec:
 * docs/nostr-via-protocol.md.
 *
 * Three event types, all in the NIP-01 ADDRESSABLE range (30000-39999, keyed by
 * kind+pubkey+`d`, so a re-broadcast or a close REPLACES rather than duplicates):
 *
 *   VIA Demand          (KIND_DEMAND)         platform -> relay. A buyer's open
 *                                             intent teaser + the door URL.
 *   VIA Intent Request  (KIND_INTENT_REQUEST) external agent -> relay -> VIA.
 *                                             Inbound demand from an agent with
 *                                             no VIA account; VIA ingests it,
 *                                             creates a brief, and re-broadcasts
 *                                             it as a VIA Demand.
 *   VIA Offer Receipt   (KIND_OFFER_RECEIPT)  platform -> relay. Transparency
 *                                             record of a paid offer at the door
 *                                             (settlement itself stays at the
 *                                             x402 door; this is only a receipt).
 *
 * Consumers MUST filter by the VIA platform pubkey + the `t` namespace tag, so
 * the exact kind numbers are a documented convention, not a global-uniqueness
 * dependency. They are env-overridable for forward compatibility.
 *
 * Design rule (from the locked architecture): only the TEASER + the door pointer
 * ever go on the relay. The full structured brief and the offer stay behind the
 * x402 door. `intent_text` never crosses any network boundary.
 */
import type { EventTemplate } from 'nostr-tools/pure';
import type { TeaserBrief } from '../demand';

export const VIA_NOSTR_VERSION = 'via-1';

/** NIP-01 addressable range (30000-39999). VIA-defined; consumers filter by
 *  pubkey + `t` tag, so the precise number is a convention, env-overridable. */
export const KIND_DEMAND = Number(process.env.NOSTR_VIA_DEMAND_KIND ?? '30495');
export const KIND_INTENT_REQUEST = Number(process.env.NOSTR_VIA_INTENT_KIND ?? '30496');
export const KIND_OFFER_RECEIPT = Number(process.env.NOSTR_VIA_OFFER_KIND ?? '30497');
export const KIND_TASTE_TEASER = Number(process.env.NOSTR_VIA_TASTE_KIND ?? '30498');

/** Namespace `t` tags so a single relay subscription selects only VIA events. */
export const T_DEMAND = 'via-demand';
export const T_INTENT_REQUEST = 'via-intent-request';
export const T_OFFER_RECEIPT = 'via-offer-receipt';
export const T_TASTE = 'via-taste';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK = 'base';

/** The network MCP where any external seller (agent or human-operated) onboards
 *  to VIA so the SALE settles on-network and VIA's flat 2.5% fee is secured. The
 *  teaser is open on the relay for reach; the MONEY path is locked to VIA. */
const ONBOARD_MCP_URL = `${(process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '')}/mcp`;
const NETWORK_FEE_PCT = 2.5;
const ONBOARD_NOTE =
  'Not a VIA seller yet? To quote and get paid you must transact on VIA. Call register_store at the MCP below '
  + `(payout wallet + email), list the product, and the buyer settles through VIA. The network keeps a flat ${NETWORK_FEE_PCT}% on the sale; you keep ${100 - NETWORK_FEE_PCT}%. `
  + 'A newly self-onboarded store can transact immediately; its payout is held until a human approves the store (within 24h), then released.';

/** The x402 unlock fee advertised in the demand event (informational; the door
 *  is the source of truth). Mirrors VIA_FEE_UNLOCK_USDC used by the gate. */
function unlockFeeUsdc(): number {
  return Number(process.env.VIA_FEE_UNLOCK_USDC ?? '0.005');
}

/** The onboarding CTA for a seller that is not yet on VIA: where to register so
 *  the sale settles on-network and the 2.5% fee is secured. Shared by the NOSTR
 *  Demand event and the offer-door response. */
export function sellerOnboardInfo(): { mcp_url: string; register_tool: string; network_fee_pct: number; note: string } {
  return { mcp_url: ONBOARD_MCP_URL, register_tool: 'register_store', network_fee_pct: NETWORK_FEE_PCT, note: ONBOARD_NOTE };
}

/**
 * Build the addressable VIA Demand event for a teaser. `d` = brief id, so a
 * rebroadcast replaces the prior event and a close can flip `status`.
 * Content carries a human line (so people on generic clients see it) plus a
 * machine block (so agents parse without guessing).
 */
export function buildDemandEvent(teaser: TeaserBrief, opts?: { status?: 'open' | 'closed' }): EventTemplate {
  const status = opts?.status ?? 'open';
  const fee = unlockFeeUsdc();
  const summary = [teaser.category, teaser.product_type, teaser.attribute].filter(Boolean).join(' · ');
  const machine = {
    v: VIA_NOSTR_VERSION,
    type: T_DEMAND,
    brief_id: teaser.brief_id,
    category: teaser.category ?? null,
    product_type: teaser.product_type ?? null,
    attribute: teaser.attribute ?? null,
    door_url: teaser.door_url,
    status,
    x402: { unlock_fee_usdc: fee, asset: USDC_BASE, network: NETWORK },
    // How a seller NOT on VIA captures the deal on-network (2.5% fee secured).
    onboard: { mcp_url: ONBOARD_MCP_URL, register_tool: 'register_store', network_fee_pct: NETWORK_FEE_PCT, note: ONBOARD_NOTE },
  };

  const tags: string[][] = [
    ['d', teaser.brief_id],
    ['t', T_DEMAND],
    ...(teaser.category ? [['t', teaser.category.split('/')[0]]] : []),
    ['r', teaser.door_url],
    ['title', summary || 'open demand'],
    ['status', status],
    // NIP-99-style price tag for cross-client legibility (the x402 unlock fee).
    ['price', String(fee), 'USDC'],
    // Explicit x402 payment hint: where to pay, how much, which asset/network.
    ['x402', teaser.door_url, String(fee), USDC_BASE, NETWORK],
    // Onboarding pointer: where a non-VIA seller registers to transact on-network.
    ['onboard', ONBOARD_MCP_URL, 'register_store'],
    ['v', VIA_NOSTR_VERSION],
  ];

  const content = status === 'closed'
    ? `VIA demand CLOSED.\n${JSON.stringify(machine)}`
    : `VIA demand: a buyer is looking for ${summary || 'something'}. `
      + `Any seller agent can unlock the full brief and offer at the x402 door (pay ${fee} USDC on Base): ${teaser.door_url}\n`
      + JSON.stringify(machine);

  return {
    kind: KIND_DEMAND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

/** NIP-01 text note kind. */
export const KIND_NOTE = 1;
/** NIP-40 expiry for the human note. The addressable Demand event (30495) does
 *  not need this (it self-replaces); a kind:1 note does not replace, so it ages
 *  out and re-broadcasts do not pile up stale demand in human feeds. 72h. */
const HUMAN_NOTE_TTL_SECONDS = 72 * 3600;

/**
 * Build a human-reach kind:1 note for a teaser. Generic microblog clients (Damus,
 * Primal, Amethyst, Snort) render kind:1 in the scroll feed; they do NOT render
 * the addressable Demand event (30495). So the same demand needs a kind:1 sibling
 * to be visible to humans, while 30495 stays the machine-native event for agents.
 *
 * Paid-door safe by construction: it carries ONLY the teaser summary (category,
 * product type, attribute) + the door URL. No brief, no intent_text, no machine
 * block — a human note has nothing an agent needs that 30495 does not already give.
 */
export function buildHumanNote(teaser: TeaserBrief): EventTemplate {
  const fee = unlockFeeUsdc();
  const summary = [teaser.category, teaser.product_type, teaser.attribute].filter(Boolean).join(' · ');
  const expiration = String(Math.floor(Date.now() / 1000) + HUMAN_NOTE_TTL_SECONDS);

  const tags: string[][] = [
    ['t', 'via'],
    ['t', 'agenticcommerce'],
    ...(teaser.category ? [['t', teaser.category.split('/')[0]]] : []),
    ['r', teaser.door_url],
    ['expiration', expiration],
    ['v', VIA_NOSTR_VERSION],
  ];

  const content =
    `A buyer on VIA is looking for ${summary || 'something'}. `
    + `Any seller can view the brief and respond at the door (pay ${fee} USDC on Base): ${teaser.door_url}`;

  return {
    kind: KIND_NOTE,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

/** One offer made on an inbound (NOSTR-origin) brief, to be pushed back to the
 *  external buyer's pubkey so it can accept by settling THROUGH VIA. */
export interface OfferReceiptInput {
  briefId: string;
  buyerPubkey: string;           // the external buyer's NOSTR pubkey (hex) -> p-tag
  title: string;
  priceUsdc: number | null;
  sellerSlug: string | null;
  sellerName: string | null;
  sellerErc8004Id: string | null;
  sellerMcpUrl: string | null;   // the seller's VIA MCP — where buy_product settles via VIA
  productUrl: string | null;
  fits: boolean;
  score: number;
}

/**
 * Build the addressable VIA Offer Receipt event (kind 30497), p-tagged to the
 * external buyer's pubkey. This is the inbound buyer's offers-back channel: a
 * seller responded, and to ACCEPT the buyer must purchase the product THROUGH
 * VIA so the sale settles on-network (VIA keeps the 2.5%, both agents earn
 * reputation). The receipt carries the VIA buy pointer, never an off-VIA route.
 * `d` = brief:seller:title so a re-offer of the same item replaces, not dupes.
 */
export function buildOfferReceiptEvent(o: OfferReceiptInput): EventTemplate {
  const dtag = `${o.briefId}:${o.sellerSlug ?? 'x'}:${o.title}`.slice(0, 200);
  const machine = {
    v: VIA_NOSTR_VERSION,
    type: T_OFFER_RECEIPT,
    brief_id: o.briefId,
    title: o.title,
    price_usdc: o.priceUsdc,
    seller_slug: o.sellerSlug,
    seller_name: o.sellerName,
    seller_erc8004_id: o.sellerErc8004Id,
    fit: { fits: o.fits, score: o.score },
    buy: {
      via_mcp_url: o.sellerMcpUrl,
      product_url: o.productUrl,
      network_fee_pct: NETWORK_FEE_PCT,
      note: 'To accept, purchase this product THROUGH VIA: call buy_product on via_mcp_url and pay the x402 settlement. You pay VIA; VIA pays the seller 97.5% and keeps '
        + `${NETWORK_FEE_PCT}%, and both agents earn ERC-8004 reputation. Settling off-VIA forfeits the reputation and the on-network trust.`,
    },
  };
  const tags: string[][] = [
    ['d', dtag],
    ['t', T_OFFER_RECEIPT],
    ['p', o.buyerPubkey],
    ['title', o.title],
    ...(o.priceUsdc != null ? [['price', String(o.priceUsdc), 'USDC']] : []),
    ['status', 'offered'],
    ['v', VIA_NOSTR_VERSION],
  ];
  const content = `VIA offer on your demand: ${o.sellerName ?? o.sellerSlug ?? 'a seller'} offered "${o.title}"`
    + `${o.priceUsdc != null ? ` for ${o.priceUsdc} USDC` : ''}. Accept by buying it through VIA (see buy.via_mcp_url).\n`
    + JSON.stringify(machine);
  return { kind: KIND_OFFER_RECEIPT, created_at: Math.floor(Date.now() / 1000), tags, content };
}

/**
 * The published-card fields a taste teaser samples from. Deliberately NOT the
 * card itself: no slug, no display name, no member ref, no door URL. The
 * teaser is a corpus/reach artifact (kind 30498, VIA Taste); connection only
 * ever happens through published cards and the Door, so an anonymised sketch
 * on the open rail can never be walked back to a person by itself.
 */
export interface TasteTeaserInput {
  /** Opaque uuid minted with the card; the addressable `d` tag. Never the slug. */
  teaser_d:        string;
  member_type:     'buyer' | 'seller';
  vocab:           string[];
  references:      string[];
  anti_references: string[];
}

/**
 * Build the addressable VIA Taste event for a published card. `d` = the card's
 * opaque teaser_d, so re-publishing replaces and unpublishing flips `status`
 * to closed. Content carries one human line plus a machine block sampled from
 * the PUBLISHED card subset (already the public tier), capped smaller still.
 */
export function buildTasteTeaserEvent(input: TasteTeaserInput, opts?: { status?: 'open' | 'closed' }): EventTemplate {
  const status = opts?.status ?? 'open';
  const machine = {
    v: VIA_NOSTR_VERSION,
    type: T_TASTE,
    teaser_id: input.teaser_d,
    member_kind: input.member_type,
    vocab: input.vocab.slice(0, 6),
    references_sketch: input.references.slice(0, 6),
    anti_sketch: input.anti_references.slice(0, 3),
    status,
  };

  const tags: string[][] = [
    ['d', input.teaser_d],
    ['t', T_TASTE],
    ['status', status],
    ['v', VIA_NOSTR_VERSION],
  ];

  const content = status === 'closed'
    ? `VIA taste teaser CLOSED.\n${JSON.stringify(machine)}`
    : 'A member of the VIA back room with this sensibility exists.\n'
      + JSON.stringify(machine);

  return {
    kind: KIND_TASTE_TEASER,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

/** Structured demand an external agent submits over NOSTR (parsed by the inbound
 *  listener). Either free `intent_text` (VIA will run extractIntent) or a
 *  pre-structured intent; plus the originating client name for attribution. */
export interface InboundIntentRequest {
  intent_text?: string;
  category?: string;
  requirements?: string[];
  preferences?: string[];
  budget_usd?: number;
  client?: string;
}

/**
 * Parse a VIA Intent Request event (KIND_INTENT_REQUEST, t=via-intent-request)
 * from an external agent into a normalised request, or null if it is not a
 * well-formed VIA intent event. The event's pubkey is the external buyer
 * identity; the caller maps it to a NOSTR-origin buyer. Pure + defensive: never
 * throws, returns null on anything malformed.
 */
export function parseIntentRequest(event: { kind: number; tags: string[][]; content: string; pubkey?: string }): InboundIntentRequest | null {
  if (event.kind !== KIND_INTENT_REQUEST) return null;
  const hasTag = event.tags?.some((t) => t[0] === 't' && t[1] === T_INTENT_REQUEST);
  if (!hasTag) return null;

  let body: unknown;
  try { body = JSON.parse(event.content); } catch { return null; }
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  const intent_text = typeof b.intent_text === 'string' ? b.intent_text.trim() : undefined;
  const category = typeof b.category === 'string' ? b.category.trim() : undefined;
  const requirements = Array.isArray(b.requirements) ? b.requirements.filter((x): x is string => typeof x === 'string') : undefined;
  const preferences = Array.isArray(b.preferences) ? b.preferences.filter((x): x is string => typeof x === 'string') : undefined;
  const budget_usd = typeof b.budget_usd === 'number' && isFinite(b.budget_usd) ? b.budget_usd : undefined;
  const client = typeof b.client === 'string' ? b.client.slice(0, 80) : undefined;

  // Must carry SOMETHING actionable.
  if (!intent_text && !category && !(requirements && requirements.length)) return null;
  return { intent_text, category, requirements, preferences, budget_usd, client };
}
