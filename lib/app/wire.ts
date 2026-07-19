/**
 * lib/app/wire.ts
 *
 * The Wire: a public, read-only stream of real network activity on VIA. Three
 * event kinds, one merged timeline, newest first:
 *
 *   - intent     , an anonymised demand teaser (same shape broadcast to the
 *                  kind:30495 relay: category + product type + one attribute,
 *                  NEVER the raw intent_text).
 *   - offer      , a seller pitching a product at a buyer's brief (the x402
 *                  paid door). A paid offer carries its Base settlement tx.
 *   - settlement , a completed purchase, linked to its Base transaction.
 *
 * The relay only ever MIRRORS these rows (the app publishes to it, it never
 * reads back), so the DB is the source of truth and the serverless-safe read
 * path. No buyer identity or wallet is ever surfaced; only on-chain tx hashes
 * (already public on Base) are shown, which is the whole point , self-evidencing
 * live commerce.
 */
import { unstable_cache } from 'next/cache';
import { db } from './db';
import { teaserBrief } from './demand';
import { NETWORK_MEMBERS } from './network-search';

const ACTIVE = ['open', 'broadcast', 'matched'];
const SETTLED = ['paid', 'minted', 'paid_out'];

export type WireEventType = 'intent' | 'offer' | 'settlement' | 'pass' | 'proposed';

export interface WireEvent {
  id: string;
  type: WireEventType;
  ts: string; // ISO timestamp, used to sort the merged stream
  category?: string | null;
  product_type?: string | null;
  attribute?: string | null;
  title?: string | null;
  seller_name?: string | null;
  price_usdc?: number | null;
  amount_usdc?: number | null;
  fits?: boolean | null;
  score?: number | null;
  tx_hash?: string | null;
  tx_url?: string | null;
  source?: string | null;
  /** Product page link for a `proposed` match (public catalogue page, not a tx). */
  url?: string | null;
}

interface RawProposal {
  title?: unknown;
  seller_name?: unknown;
  price_usdc?: unknown;
  url?: unknown;
}

const TX_RE = /^0x[0-9a-fA-F]{64}$/;

/** basescan link for a real Base tx hash; null for synthetic TEST-… hashes. */
export function baseTxUrl(hash: unknown): string | null {
  return typeof hash === 'string' && TX_RE.test(hash) ? `https://basescan.org/tx/${hash}` : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

interface IntentRow {
  id: string;
  structured: Record<string, unknown> | null;
  broadcast_at: string | null;
  created_at: string;
}

interface PitchRow {
  id: string;
  product: Record<string, unknown> | null;
  verdict: Record<string, unknown> | null;
  seller_name: string | null;
  created_at: string;
}

interface PurchaseRow {
  id: string;
  total_usdc: string | number | null;
  payment_tx_hash: string | null;
  mint_tx_hash: string | null;
  created_at: string;
  app_seller_products: { title: string | null } | { title: string | null }[] | null;
  app_sellers: { name: string | null } | { name: string | null }[] | null;
}

interface GuestRow {
  id: string;
  source: string | null;
  claimed_at: string;
  app_seller_products: { title: string | null } | { title: string | null }[] | null;
  app_sellers: { name: string | null } | { name: string | null }[] | null;
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

async function intentEvents(limit: number): Promise<WireEvent[]> {
  const { data, error } = await db
    .from('app_buyer_intents')
    .select('id, structured, broadcast_at, created_at, app_buyers!inner(public)')
    .in('status', ACTIVE)
    .eq('discoverable', true)
    .eq('app_buyers.public', true)
    .order('broadcast_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) { console.error('[wire] intents failed:', error.message); return []; }
  const out: WireEvent[] = [];
  for (const r of (data ?? []) as IntentRow[]) {
    const teaser = teaserBrief(r);
    if (!teaser) continue;
    const ts = r.broadcast_at ?? r.created_at;
    out.push({
      id: `intent:${r.id}:${ts}`,
      type: 'intent',
      ts,
      category: teaser.category,
      product_type: teaser.product_type,
      attribute: teaser.attribute,
    });
    // Products this search surfaced, shown as "Proposed" matches right under
    // their demand (same ts; stable sort keeps demand first). Public catalogue
    // data only, no payment, so distinct from a paid Offer.
    const proposals = (r.structured ?? {})['proposals'];
    if (Array.isArray(proposals)) {
      proposals.slice(0, 6).forEach((p, i) => {
        const pr = (p ?? {}) as RawProposal;
        const title = typeof pr.title === 'string' ? pr.title : null;
        if (!title) return;
        out.push({
          id: `proposed:${r.id}:${i}`,
          type: 'proposed',
          ts,
          title,
          seller_name: typeof pr.seller_name === 'string' ? pr.seller_name : null,
          price_usdc: num(pr.price_usdc),
          url: typeof pr.url === 'string' ? pr.url : null,
        });
      });
    }
  }
  return out;
}

async function offerEvents(limit: number): Promise<WireEvent[]> {
  const { data, error } = await db
    .from('app_buyer_brief_pitches')
    .select('id, product, verdict, seller_name, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[wire] offers failed:', error.message); return []; }
  return ((data ?? []) as PitchRow[]).map((r) => {
    const p = r.product ?? {};
    const v = r.verdict ?? {};
    const tx = p['payment_tx_hash'];
    return {
      id: `offer:${r.id}`,
      type: 'offer' as const,
      ts: r.created_at,
      title: typeof p['title'] === 'string' ? (p['title'] as string) : null,
      seller_name: r.seller_name,
      price_usdc: num(p['price_usdc']),
      fits: typeof v['fits'] === 'boolean' ? (v['fits'] as boolean) : null,
      score: num(v['score']),
      tx_hash: typeof tx === 'string' ? tx : null,
      tx_url: baseTxUrl(tx),
    };
  });
}

async function settlementEvents(limit: number): Promise<WireEvent[]> {
  const { data, error } = await db
    .from('app_purchases')
    .select('id, total_usdc, payment_tx_hash, mint_tx_hash, created_at, app_seller_products(title), app_sellers(name)')
    .in('status', SETTLED)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[wire] settlements failed:', error.message); return []; }
  return ((data ?? []) as PurchaseRow[]).map((r) => {
    const hash = r.payment_tx_hash ?? r.mint_tx_hash;
    return {
      id: `settlement:${r.id}`,
      type: 'settlement' as const,
      ts: r.created_at,
      title: one(r.app_seller_products)?.title ?? null,
      seller_name: one(r.app_sellers)?.name ?? null,
      amount_usdc: num(r.total_usdc),
      tx_hash: typeof hash === 'string' ? hash : null,
      tx_url: baseTxUrl(hash),
    };
  });
}

// Free event-pass claims (e.g. the ADS&AI guest pass): the non-transactional
// side of the network. No payment, no tx, no mint , just an agent or a person
// taking a free place on a guest list. Guest name/email are PII and NEVER leave;
// only the pass title, the host store, and the timestamp surface here.
async function passEvents(limit: number): Promise<WireEvent[]> {
  const { data, error } = await db
    .from('app_event_guests')
    .select('id, source, claimed_at, app_seller_products(title), app_sellers(name)')
    .eq('status', 'confirmed')
    .order('claimed_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[wire] passes failed:', error.message); return []; }
  return ((data ?? []) as GuestRow[]).map((r) => ({
    id: `pass:${r.id}`,
    type: 'pass' as const,
    ts: r.claimed_at,
    title: one(r.app_seller_products)?.title ?? null,
    seller_name: one(r.app_sellers)?.name ?? null,
    source: r.source,
  }));
}

// Federated member activity (RRG today): each member exposes GET
// /api/via/wire-feed returning its own settlements (and any future streams) as
// anonymised events. The two platforms are separate Supabase projects, so this
// is an HTTP pull, mirroring the search federation. One slow/down member never
// blocks the feed (per-member try/catch + 5s timeout). RRG intents are NOT
// pulled here: they already reach this feed via the partner-intent push into
// app_buyer_intents, so pulling them too would double-count.
interface MemberFeedEvent {
  id?: string; type?: string; ts?: string;
  title?: string | null; seller_name?: string | null;
  amount_usdc?: number | null; price_usdc?: number | null;
  category?: string | null; product_type?: string | null; attribute?: string | null;
  tx_hash?: string | null;
}

async function memberEvents(limit: number): Promise<WireEvent[]> {
  const batches = await Promise.all(NETWORK_MEMBERS.map(async (m) => {
    if (!m.wireFeedUrl) return [] as WireEvent[];
    try {
      const res = await fetch(`${m.wireFeedUrl}?limit=${limit}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [] as WireEvent[];
      const json = await res.json() as { platform?: string; events?: MemberFeedEvent[] };
      const platform = json.platform ?? m.platform;
      const evs = Array.isArray(json.events) ? json.events : [];
      return evs.map((e, i): WireEvent | null => {
        const ts = typeof e.ts === 'string' ? e.ts : null;
        if (!ts) return null;
        const type = (['intent', 'offer', 'settlement', 'pass'].includes(String(e.type)) ? e.type : 'settlement') as WireEventType;
        const tx = typeof e.tx_hash === 'string' ? e.tx_hash : null;
        return {
          id:           `${platform}:${e.id ?? i}:${ts}`,
          type,
          ts,
          title:        e.title ?? null,
          seller_name:  e.seller_name ?? null,
          amount_usdc:  num(e.amount_usdc),
          price_usdc:   num(e.price_usdc),
          category:     e.category ?? null,
          product_type: e.product_type ?? null,
          attribute:    e.attribute ?? null,
          tx_hash:      tx,
          tx_url:       baseTxUrl(tx),
          source:       platform,
        };
      }).filter((x): x is WireEvent => x !== null);
    } catch { return [] as WireEvent[]; }
  }));
  return batches.flat();
}

/** The merged Wire stream: newest events across all kinds AND every federated
 *  member, capped at `limit`. */
async function computeWire(limit: number): Promise<WireEvent[]> {
  const per = Math.min(Math.max(limit, 20), 60);
  const [intents, offers, settlements, passes, members] = await Promise.all([
    intentEvents(per),
    offerEvents(per),
    settlementEvents(per),
    passEvents(per),
    memberEvents(per),
  ]);
  return [...intents, ...offers, ...settlements, ...passes, ...members]
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, limit);
}

// Short cache so many polling viewers (7s client interval) don't each hit three
// tables. A ticker tolerates ~10s of lag; lastGood is not needed here because a
// transient empty read just serves the previous cached array.
const cached = unstable_cache(
  (limit: number) => computeWire(limit),
  ['via-wire'],
  { revalidate: 10 },
);

export function getWireEvents(limit = 50): Promise<WireEvent[]> {
  return cached(Math.min(Math.max(limit, 1), 100));
}

// ── Totals ───────────────────────────────────────────────────────────────────
// The header counters are network TOTALS, not a count of the 50 shown events.

export interface WireStats {
  events: number;
  settlements: number;
  volume: number;
}

/** Federated member TOTALS (settlements + USDC volume) for the header counters.
 *  Members return these on their wire-feed; RRG intents are excluded here too, as
 *  they are already counted in app_buyer_intents. Non-fatal per member. */
async function memberTotals(): Promise<{ settlements: number; volume: number }> {
  const results = await Promise.all(NETWORK_MEMBERS.map(async (m) => {
    if (!m.wireFeedUrl) return { settlements: 0, volume: 0 };
    try {
      const res = await fetch(`${m.wireFeedUrl}?limit=1`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { settlements: 0, volume: 0 };
      const json = await res.json() as { totals?: { settlements?: number; volume?: number } };
      return { settlements: num(json.totals?.settlements) ?? 0, volume: num(json.totals?.volume) ?? 0 };
    } catch { return { settlements: 0, volume: 0 }; }
  }));
  return {
    settlements: results.reduce((s, r) => s + r.settlements, 0),
    volume:      results.reduce((s, r) => s + r.volume, 0),
  };
}

async function computeWireStats(): Promise<WireStats> {
  const head = { count: 'exact' as const, head: true };
  const [intents, offers, settlements, passes, settledRows, members] = await Promise.all([
    db.from('app_buyer_intents').select('id, app_buyers!inner(public)', head)
      .in('status', ACTIVE).eq('discoverable', true).eq('app_buyers.public', true),
    db.from('app_buyer_brief_pitches').select('id', head),
    db.from('app_purchases').select('id', head).in('status', SETTLED),
    db.from('app_event_guests').select('id', head).eq('status', 'confirmed'),
    // Settled purchases are the low-volume, high-value rows; summing their
    // USDC client-side is cheap. (PostgREST caps at 1000; revisit with an
    // aggregate RPC only if settled purchases ever exceed that.)
    db.from('app_purchases').select('total_usdc').in('status', SETTLED),
    memberTotals(),
  ]);
  const c = (r: { count: number | null }) => r.count ?? 0;
  const volume = ((settledRows.data ?? []) as { total_usdc: string | number | null }[])
    .reduce((s, r) => s + (num(r.total_usdc) ?? 0), 0);
  return {
    // Members contribute their settlements to both the event and settlement
    // counts (their intents are already in app_buyer_intents, not double-counted).
    events: c(intents) + c(offers) + c(settlements) + c(passes) + members.settlements,
    settlements: c(settlements) + members.settlements,
    volume: volume + members.volume,
  };
}

const cachedStats = unstable_cache(computeWireStats, ['via-wire-stats'], { revalidate: 60 });

export function getWireStats(): Promise<WireStats> {
  return cachedStats();
}
