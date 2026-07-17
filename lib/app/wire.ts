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

const ACTIVE = ['open', 'broadcast', 'matched'];
const SETTLED = ['paid', 'minted', 'paid_out'];

export type WireEventType = 'intent' | 'offer' | 'settlement';

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

/** The merged Wire stream: newest events across all three kinds, capped at `limit`. */
async function computeWire(limit: number): Promise<WireEvent[]> {
  const per = Math.min(Math.max(limit, 20), 60);
  const [intents, offers, settlements] = await Promise.all([
    intentEvents(per),
    offerEvents(per),
    settlementEvents(per),
  ]);
  return [...intents, ...offers, ...settlements]
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
