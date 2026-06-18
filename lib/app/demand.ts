/**
 * lib/app/demand.ts
 *
 * The demand side of VIA: surfacing buyers' live demand (their open briefs) to
 * seller agents, so sellers can serve buyers who have STATED they want what the
 * seller has. The mirror of seller discovery.
 *
 * Privacy is the whole game here: only the structured intent ever leaves the
 * system , category, requirements, preferences, type_terms, budget , NEVER the
 * raw `intent_text` (which carries personal context like "a gift for my brother
 * in the UK"). A brief surfaces only when its buyer is public AND the brief is
 * active AND discoverable.
 */
import { db } from './db';
import { relevanceScore } from './via-search';
import { insertNotification } from './notifications';
import { judgeProductAgainstBrief, briefIntentFromStructured, type PitchVerdict } from './buyer-matching';
import { enqueueOfferSignals } from './erc8004-signal-queue';
import { publishOfferReceiptToNostr } from './broadcast/nostr';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');
const ACTIVE = ['open', 'broadcast', 'matched'];

export function buyerMcpUrl(handle: string): string {
  return `${APP_BASE}/buyers/${encodeURIComponent(handle)}/mcp`;
}

/** The canonical x402 door for a brief: where any agent on any channel unlocks the
 *  full brief (GET) and submits an offer (POST .../offer). Every teaser points here. */
export function briefDoorUrl(briefId: string): string {
  return `${APP_BASE}/api/via/brief/${encodeURIComponent(briefId)}`;
}

/** The instructions VIA hands an agent the moment it unlocks a brief, so it knows
 *  HOW to offer , and, critically, that passing `seller_erc8004_id` is what anchors
 *  its on-chain reputation. An agent can't volunteer a field it was never told about;
 *  this is VIA prompting the agent. The offer fee is paid the same two ways as the
 *  unlock (x402 header or direct-pay tx hash , see the 402 `payment_options`). */
export function offerInstructions(briefId: string, feeUsdc: number) {
  return {
    method: 'POST',
    url: `${briefDoorUrl(briefId)}/offer`,
    fee_usdc: feeUsdc,
    note: 'One paid offer per product. Pay the per-offer fee the same way you paid to unlock (X-PAYMENT or X-PAYMENT-TX).',
    fields: {
      title: 'required , the product you are offering',
      description: "optional , details the buyer's judge should reason over",
      price_usdc: 'optional , your price in USDC',
      url: 'optional , direct product page',
      seller_mcp_url: 'optional , your MCP URL so the buyer can transact',
      tags: 'optional , attribute tags (material, size, label, etc.)',
      seller_slug: 'optional , your VIA seller slug, for attribution',
      seller_name: 'optional , your store name shown to the buyer',
      seller_erc8004_id: 'RECOMMENDED , your ERC-8004 agent id. Include it and your paid offer earns you an on-chain reputation signal anchored to the payment. Omit it and the sale still works, but you build no reputation.',
    },
  };
}

/** The ONLY brief shape that leaves the system. Synthesised from the structured
 *  intent; the raw wording is never included. */
export interface PublicBrief {
  brief_id:     string;
  title:        string;
  category:     string | null;
  requirements: string[];
  preferences:  string[];
  type_terms:   string[];
  budget_usd:   number | null;
}

interface IntentRowLite {
  id: string;
  structured: Record<string, unknown> | null;
}

const strs = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()).slice(0, max) : [];

/** Redact a brief to its public, structured-only shape. Returns null when the
 *  brief has no extracted intent yet (nothing safe to share). */
export function publicBrief(row: IntentRowLite): PublicBrief | null {
  const si = (row.structured ?? {})['search_intent'] as Record<string, unknown> | undefined;
  const legacyTerms = strs((row.structured ?? {})['search_terms'], 3);
  const terms = si ? strs(si.terms, 3) : legacyTerms;
  const requirements = si ? strs(si.requirements, 8) : [];
  const preferences = si ? strs(si.preferences, 8) : [];
  const type_terms = si ? strs(si.type_terms, 6) : [];
  const category = si && typeof si.category === 'string' ? si.category : null;
  const budget_usd = si && typeof si.budget_usd === 'number' ? si.budget_usd : null;
  if (terms.length === 0 && requirements.length === 0 && !category) return null;

  const lead = requirements.length ? requirements.join(', ') : terms.join(', ');
  const title = category ? `${lead} (${category})` : lead;
  return { brief_id: row.id, title, category, requirements, preferences, type_terms, budget_usd };
}

function briefHaystack(b: PublicBrief): string {
  return `${b.title} ${b.requirements.join(' ')} ${b.preferences.join(' ')} ${b.type_terms.join(' ')} ${b.category ?? ''}`;
}

/** The TEASER: the thinnest public shape, broadcast to every channel. Category +
 *  product type + ONE prominent attribute + the door URL. Deliberately not enough
 *  to offer well; a seller pays at the door to unlock the full brief. The buyer's
 *  identity is NOT in the teaser , transacting happens through the door, keyed by
 *  brief_id alone. */
export interface TeaserBrief {
  brief_id:     string;
  category:     string | null;
  product_type: string | null;
  attribute:    string | null;
  door_url:     string;
  /** When this brief was (re)broadcast. Lets a seller agent process only NEW
   *  broadcasts since its last poll, instead of re-scanning all open demand. */
  broadcast_at: string | null;
}

/** Distil an intent row to its teaser. attribute prefers the extractor's
 *  `teaser_attribute`, then a budget ceiling, then the first hard requirement.
 *  Returns null when there is not even a category/type to show. */
export function teaserBrief(row: IntentRowLite & { broadcast_at?: string | null }): TeaserBrief | null {
  const si = (row.structured ?? {})['search_intent'] as Record<string, unknown> | undefined;
  if (!si) return null;
  const category = typeof si.category === 'string' ? si.category : null;
  const product_type = strs(si.type_terms, 6)[0] ?? null;
  const teaserAttr = typeof si.teaser_attribute === 'string' && si.teaser_attribute.trim().length > 0
    ? si.teaser_attribute.trim() : null;
  const budget = typeof si.budget_usd === 'number' && si.budget_usd > 0 ? si.budget_usd : null;
  const firstReq = strs(si.requirements, 8)[0] ?? null;
  const attribute = teaserAttr ?? (budget !== null ? `under $${budget}` : null) ?? firstReq;
  if (!category && !product_type && !attribute) return null;
  return {
    brief_id: row.id, category, product_type, attribute,
    door_url: briefDoorUrl(row.id),
    broadcast_at: typeof row.broadcast_at === 'string' ? row.broadcast_at : null,
  };
}

interface OpenBriefRow {
  id: string;
  structured: Record<string, unknown> | null;
  app_buyers: { handle: string; public: boolean } | { handle: string; public: boolean }[];
}

/**
 * Live demand across the network: active, discoverable briefs of public buyers,
 * ranked by relevance to the seller's `query` (token match over the structured
 * intent , broad discovery; precise fit is judged later by pitch_against_brief).
 * No query returns recent open demand. Grouped by buyer.
 */
export async function findOpenBriefs(query: string, max: number): Promise<
  { buyer_handle: string; buyer_mcp_url: string; briefs: PublicBrief[] }[]
> {
  const { data, error } = await db
    .from('app_buyer_intents')
    .select('id, structured, app_buyers!inner(handle, public)')
    .in('status', ACTIVE)
    .eq('discoverable', true)
    .eq('app_buyers.public', true)
    .order('broadcast_at', { ascending: false, nullsFirst: false })
    .limit(400);
  if (error) { console.error('[demand] findOpenBriefs failed:', error.message); return []; }

  const q = query.trim();
  const scored: { handle: string; brief: PublicBrief; score: number }[] = [];
  for (const r of (data ?? []) as OpenBriefRow[]) {
    const buyer = Array.isArray(r.app_buyers) ? r.app_buyers[0] : r.app_buyers;
    if (!buyer?.handle) continue;
    const brief = publicBrief(r);
    if (!brief) continue;
    const score = q ? relevanceScore(briefHaystack(brief), q) : 1;
    if (q && score <= 0) continue;
    scored.push({ handle: buyer.handle, brief, score });
  }
  scored.sort((a, b) => b.score - a.score);

  // Group by buyer, preserving rank order, capped.
  const byHandle = new Map<string, PublicBrief[]>();
  for (const s of scored.slice(0, Math.min(max * 4, 200))) {
    const arr = byHandle.get(s.handle) ?? [];
    if (arr.length < 10) arr.push(s.brief);
    byHandle.set(s.handle, arr);
  }
  return Array.from(byHandle.entries())
    .slice(0, max)
    .map(([handle, briefs]) => ({ buyer_handle: handle, buyer_mcp_url: buyerMcpUrl(handle), briefs }));
}

/** A public buyer's own active, discoverable briefs as TEASERS (for the seller-facing
 *  MCP). Teaser-only by design: the full structured brief is the PAID tier, unlocked
 *  only at the x402 door. Each teaser carries its door_url, so a seller goes to the
 *  door to read the full brief and to offer , the buyer MCP never gives either free. */
export async function listBuyerTeasers(buyerId: string): Promise<TeaserBrief[]> {
  const { data, error } = await db
    .from('app_buyer_intents')
    .select('id, structured, broadcast_at')
    .eq('buyer_id', buyerId)
    .eq('discoverable', true)
    .in('status', ACTIVE)
    .order('broadcast_at', { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) { console.error('[demand] listBuyerTeasers failed:', error.message); return []; }
  return ((data ?? []) as Array<IntentRowLite & { broadcast_at: string | null }>)
    .map(teaserBrief).filter((t): t is TeaserBrief => t !== null);
}

/**
 * The public demand feed: active, discoverable teasers of public buyers, ranked by
 * relevance to `query` (token match over the teaser fields). No query returns recent
 * open demand. This is the simplest broadcast channel , a flat, pull-based list every
 * agent can poll; each teaser carries its own door_url, so no buyer identity leaks.
 */
export async function findOpenTeasers(query: string, max: number, since?: string | null): Promise<TeaserBrief[]> {
  let q0 = db
    .from('app_buyer_intents')
    .select('id, structured, broadcast_at, app_buyers!inner(public)')
    .in('status', ACTIVE)
    .eq('discoverable', true)
    .eq('app_buyers.public', true);
  // `since`: only briefs (re)broadcast AFTER this timestamp. A polling seller agent
  // passes its last-seen watermark so it acts on NEW broadcasts only, never
  // re-scanning the whole open-demand feed every pass.
  if (since) q0 = q0.gt('broadcast_at', since);
  const { data, error } = await q0
    .order('broadcast_at', { ascending: false, nullsFirst: false })
    .limit(400);
  if (error) { console.error('[demand] findOpenTeasers failed:', error.message); return []; }

  const q = query.trim();
  const scored: { teaser: TeaserBrief; score: number }[] = [];
  for (const r of (data ?? []) as Array<IntentRowLite & { broadcast_at: string | null }>) {
    const teaser = teaserBrief(r);
    if (!teaser) continue;
    const hay = `${teaser.category ?? ''} ${teaser.product_type ?? ''} ${teaser.attribute ?? ''}`;
    const score = q ? relevanceScore(hay, q) : 1;
    if (q && score <= 0) continue;
    scored.push({ teaser, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.teaser);
}

// ── The offer core: record one offer against one brief ───────────────────────
// The channel-agnostic heart of the exchange. The per-buyer MCP pitch_against_brief
// and the canonical door POST /api/via/brief/[id]/offer both call this, so an offer
// is judged, recorded and notified identically wherever it comes from. The judge
// reads ONLY this seller's asserted product against the brief , a bounded, reliable
// task , never the 221k-row index.

export interface OfferInput {
  title:          string;
  description?:    string | null;
  price_usdc?:    number | null;
  url?:           string | null;
  /** The VIA product UUID, when the seller is a VIA-hosted store. Lets the door
   *  link the offer at the canonical buyable page (/sellers/{slug}/products/{id})
   *  so the human gets the Buy now panel, mirroring an RRG product link. */
  product_id?:    string | null;
  seller_mcp_url?: string | null;
  tags?:          string[];
  /** Structured product facets from the seller's MCP (colours, sizes, product_type,
   *  shopify_tags, sample SKUs, raw productAttributes). The buyer's judge reads these
   *  to confirm requirements like "black" / "men's" that a bare title cannot. */
  attributes?:    Record<string, unknown> | null;
  /** Seller attribution shown to the buyer (who made the offer). */
  seller_slug?:   string | null;
  seller_name?:   string | null;
  /** The x402 micro-fee settlement tx for this offer (audit + reputation anchor). */
  payment_tx_hash?: string | null;
  /** The seller agent's ERC-8004 id, supplied by the seller (RRG brand ids live
   *  in a separate project, so the seller asserts its own). Used for the seller
   *  reputation signal on a paid offer. */
  seller_erc8004_id?: string | null;
}

/** Has this seller already put this exact product forward on this brief? The door
 *  checks this BEFORE charging the per-item micro-fee, so a polling agent that
 *  re-submits never pays twice. */
export async function offerExists(intentId: string, sellerSlug: string, title: string): Promise<boolean> {
  const { data } = await db
    .from('app_buyer_brief_pitches')
    .select('id')
    .eq('intent_id', intentId)
    .eq('seller_slug', sellerSlug)
    .eq('product->>title', title)
    .maybeSingle();
  return Boolean(data);
}

/** Has a PAID offer (settled at the x402 door) been recorded for this buyer with
 *  this payment tx? The seller proves it knows its own door payment. This is the
 *  ticket that unlocks negotiation , no free pre-door negotiation. */
export async function paidOfferExists(briefId: string, buyerId: string, paymentTxHash: string): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(paymentTxHash)) return false;
  const { data } = await db
    .from('app_buyer_brief_pitches')
    .select('id')
    .eq('intent_id', briefId)
    .eq('buyer_id', buyerId)
    .eq('product->>payment_tx_hash', paymentTxHash)
    .maybeSingle();
  return Boolean(data);
}

export interface OfferOutcome {
  status:   'recorded' | 'not_found';
  brief_id: string;
  verdict?: PitchVerdict;
}

interface OfferIntentRow {
  id: string;
  intent_text: string | null;
  structured: Record<string, unknown> | null;
  buyer_id: string;
  app_buyers: { handle: string; owner_user_id: string; public: boolean; erc8004_agent_id: string | null }
            | { handle: string; owner_user_id: string; public: boolean; erc8004_agent_id: string | null }[];
}

/**
 * Record an offer against a brief: load the (active, discoverable, public) brief,
 * judge the asserted product against it, persist the pitch with seller attribution,
 * and notify the buyer. `requireBuyerId` scopes to one buyer (the per-buyer MCP
 * path); omit it for the open door. Returns 'not_found' when the brief is not an
 * open, visible target , never throws.
 */
export async function submitOffer(
  briefId: string,
  offer: OfferInput,
  callerIdentity: Record<string, unknown>,
  opts?: { requireBuyerId?: string; verdict?: PitchVerdict },
): Promise<OfferOutcome> {
  let query = db
    .from('app_buyer_intents')
    .select('id, intent_text, structured, buyer_id, app_buyers!inner(handle, owner_user_id, public, erc8004_agent_id)')
    .eq('id', briefId)
    .in('status', ACTIVE)
    .eq('discoverable', true)
    .eq('app_buyers.public', true);
  if (opts?.requireBuyerId) query = query.eq('buyer_id', opts.requireBuyerId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return { status: 'not_found', brief_id: briefId };

  const row = data as OfferIntentRow;
  const buyer = Array.isArray(row.app_buyers) ? row.app_buyers[0] : row.app_buyers;
  if (!buyer?.handle) return { status: 'not_found', brief_id: briefId };

  // Score the submitted offer for the buyer's ranking. This NEVER vetoes a seller
  // response , the seller already chose to submit; the buyer ranks what arrives.
  //  - If the submitter supplied a verdict (its own agent's score), use it as-is.
  //  - Otherwise the door judges this one offer against the brief for the buyer.
  let verdict: PitchVerdict;
  if (opts?.verdict) {
    verdict = opts.verdict;
  } else {
    const brief = briefIntentFromStructured(row.structured);
    verdict = await judgeProductAgainstBrief(
      row.intent_text ?? '',
      brief,
      { title: offer.title, description: offer.description ?? null, price_usdc: offer.price_usdc ?? null, tags: offer.tags ?? [], attributes: offer.attributes ?? undefined },
    );
  }

  // Resolve the seller name from the slug when not supplied, so the buyer sees a store.
  let sellerId: string | null = null;
  let sellerName: string | null = offer.seller_name ?? null;
  if (offer.seller_slug) {
    const { data: s } = await db
      .from('app_sellers')
      .select('id, name')
      .eq('slug', offer.seller_slug)
      .maybeSingle();
    if (s) { sellerId = s.id as string; sellerName = sellerName ?? (s.name as string); }
  }

  // Idempotent for polling seller agents: if this seller already offered this exact
  // product on this brief, don't record a duplicate , just return the existing one.
  if (offer.seller_slug) {
    const { data: dup } = await db
      .from('app_buyer_brief_pitches')
      .select('id')
      .eq('intent_id', row.id)
      .eq('seller_slug', offer.seller_slug)
      .eq('product->>title', offer.title)
      .maybeSingle();
    if (dup) return { status: 'recorded', brief_id: briefId, verdict };
  }

  // For a VIA-hosted seller (resolved to an app_sellers row) that asserted a
  // product_id, link the offer at the canonical buyable product page so the human
  // lands on the Buy now panel, mirroring an RRG product link. The sale closes on
  // VIA, never on the seller's external site. Non-VIA offers (no sellerId) keep
  // their own url untouched, so RRG / external links are unaffected.
  const canonicalUrl = sellerId && offer.seller_slug && offer.product_id
    ? `${APP_BASE}/sellers/${encodeURIComponent(offer.seller_slug)}/products/${encodeURIComponent(offer.product_id)}`
    : (offer.url ?? null);

  const product = {
    title: offer.title,
    description: offer.description ?? null,
    price_usdc: offer.price_usdc ?? null,
    url: canonicalUrl,
    product_id: offer.product_id ?? null,
    seller_mcp_url: offer.seller_mcp_url ?? null,
    tags: offer.tags ?? [],
    attributes: offer.attributes ?? null,
    payment_tx_hash: offer.payment_tx_hash ?? null,
  };
  const { error: insErr } = await db.from('app_buyer_brief_pitches').insert({
    intent_id:       row.id,
    buyer_id:        row.buyer_id,
    seller_identity: callerIdentity,
    product,
    verdict,
    seller_id:       sellerId,
    seller_slug:     offer.seller_slug ?? null,
    seller_name:     sellerName,
  });
  if (insErr) console.error('[demand] submitOffer insert failed:', insErr.message);

  // On a PAID offer, enqueue the both-agent ERC-8004 reputation signals (seller
  // always; buyer only when registered). The drainer posts them on-chain. The
  // payment tx anchors the signal. No-op when the offer carried no micro-fee.
  if (!insErr && offer.payment_tx_hash) {
    await enqueueOfferSignals({
      orderRef:        `brief-${row.id}-${offer.payment_tx_hash}`,
      txHash:          offer.payment_tx_hash,
      sellerErc8004Id: offer.seller_erc8004_id ?? null,
      buyerErc8004Id:  buyer.erc8004_agent_id ?? null,
    });
  }

  void insertNotification({
    ownerUserId: buyer.owner_user_id,
    kind:        'enquiry',
    title:       verdict.fits ? 'A seller offered a match for your brief' : 'A seller pitched your brief',
    body:        `${sellerName ? `${sellerName}: ` : ''}${offer.title}${typeof offer.price_usdc === 'number' ? ` · ${offer.price_usdc} USDC` : ''} , ${verdict.fits ? 'fits' : 'does not fit'}: ${verdict.reason}`.slice(0, 240),
    link:        `/buyer/${buyer.handle}/admin`,
    metadata:    { tool_name: 'submit_offer', agent_identity: callerIdentity, brief_id: row.id, fits: verdict.fits, seller_slug: offer.seller_slug ?? null, buyer_id: row.buyer_id },
  });

  // Inbound NOSTR demand: an external agent (no VIA account) created this brief.
  // Push the offer back to its pubkey over NOSTR with the VIA buy pointer, so it
  // accepts by settling THROUGH VIA (2.5% captured) rather than going off-network.
  if (!insErr) {
    const nostr = (row.structured ?? {})['nostr'] as { pubkey?: string } | undefined;
    if (nostr?.pubkey) {
      // AWAIT (not fire-and-forget): on serverless the function can freeze after
      // the response is sent, so a void'd NOSTR publish may never run. Bounded at
      // the publisher's 4s timeout; never throws past this try/catch.
      try {
        await publishOfferReceiptToNostr({
          briefId:         row.id,
          buyerPubkey:     nostr.pubkey,
          title:           offer.title,
          priceUsdc:       offer.price_usdc ?? null,
          sellerSlug:      offer.seller_slug ?? null,
          sellerName,
          sellerErc8004Id: offer.seller_erc8004_id ?? null,
          sellerMcpUrl:    offer.seller_mcp_url ?? null,
          productUrl:      offer.url ?? null,
          fits:            verdict.fits,
          score:           verdict.score,
        });
      } catch (e) { console.error('[demand] offer receipt publish failed:', e); }
    }
  }

  return { status: 'recorded', brief_id: briefId, verdict };
}
