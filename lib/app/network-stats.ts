import { unstable_cache } from 'next/cache';
import { db } from './db';

/**
 * VIA network metrics for the landing page. Sums via-app's own live counts with
 * every member platform's self-reported stats (each member exposes the same
 * GET /stats shape). Adding a vertical portal later is one entry in MEMBERS.
 */

export interface NetworkMetrics {
  sellers: number;
  buyingAgents: number;
  products: number;
  syntheticAgents: number;
}

interface MemberStats {
  sellers: number;
  products: number;
  buyingAgents: number;
  syntheticAgents: number;
}

// Other VIA platforms that self-report counts. via-app's own counts are local.
const MEMBERS: { name: string; statsUrl: string }[] = [
  { name: 'rrg', statsUrl: 'https://realrealgenuine.com/api/rrg/stats' },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Run a head/count query, retrying on transient error. During a bulk catalogue
// ingest the count can intermittently fail (DB contention); supabase-js then
// returns { count: null, error }. Without a retry that null became 0, which
// (cached for 60s) collapsed the whole local catalogue out of the headline.
// On final failure we THROW rather than return 0, so compute() rejects and the
// cache keeps serving the last good total instead of caching a zero.
async function countOrThrow(
  build: () => PromiseLike<{ count: number | null; error: unknown }>,
  label: string,
): Promise<number> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { count, error } = await build();
    if (!error && count !== null) return count;
    lastErr = error;
    await sleep(250 * (attempt + 1));
  }
  throw new Error(`network-stats local count failed (${label}): ${String(lastErr)}`);
}

/** Estimated product count via pg_class.reltuples (app_seller_products_estimate
 *  RPC). An exact count(*) over the 220k-row / ~1 GB table is a ~29s seq scan on
 *  the current instance; the estimate is ~6ms and plenty accurate for a headline. */
async function estimateProducts(): Promise<number> {
  const { data, error } = await db.rpc('app_seller_products_estimate');
  if (error || data == null) throw new Error(`product estimate failed: ${String(error)}`);
  return Number(data);
}

async function fetchLocal(): Promise<MemberStats> {
  // sellers/buyers are tiny tables (exact counts are instant); the products
  // table is the heavy one, so it uses the fast reltuples estimate.
  const [sellers, products, buyers] = await Promise.all([
    countOrThrow(() => db.from('app_sellers').select('id', { count: 'exact', head: true }).eq('active', true), 'sellers'),
    estimateProducts(),
    countOrThrow(() => db.from('app_buyers').select('id', { count: 'exact', head: true }), 'buyers'),
  ]);
  return { sellers, products, buyingAgents: buyers, syntheticAgents: 0 };
}

async function fetchMember(statsUrl: string): Promise<MemberStats> {
  try {
    const res = await fetch(statsUrl, { next: { revalidate: 60 } });
    if (!res.ok) return { sellers: 0, products: 0, buyingAgents: 0, syntheticAgents: 0 };
    const j = (await res.json()) as Partial<MemberStats>;
    return {
      sellers: Number(j.sellers) || 0,
      products: Number(j.products) || 0,
      buyingAgents: Number(j.buyingAgents) || 0,
      syntheticAgents: Number(j.syntheticAgents) || 0,
    };
  } catch {
    return { sellers: 0, products: 0, buyingAgents: 0, syntheticAgents: 0 };
  }
}

// Last successfully computed metrics, per serverless instance. If a recompute
// fails (fetchLocal throws after its retries during heavy ingest load), we serve
// this instead of letting a transient failure collapse the headline to
// members-only. Never throws to the caller: app/page.tsx renders it directly.
let lastGood: NetworkMetrics | null = null;

async function compute(): Promise<NetworkMetrics> {
  try {
    const parts = await Promise.all([
      fetchLocal(),
      ...MEMBERS.map((m) => fetchMember(m.statsUrl)),
    ]);
    const total = parts.reduce<NetworkMetrics>(
      (acc, p) => ({
        sellers: acc.sellers + p.sellers,
        buyingAgents: acc.buyingAgents + p.buyingAgents,
        products: acc.products + p.products,
        syntheticAgents: acc.syntheticAgents + p.syntheticAgents,
      }),
      { sellers: 0, buyingAgents: 0, products: 0, syntheticAgents: 0 },
    );
    lastGood = total;
    return total;
  } catch (err) {
    if (lastGood) return lastGood;
    // Cold start with no prior value AND local counts failing: degrade to
    // members-only rather than 500 the page. Rare and brief; the next
    // successful revalidation replaces it.
    console.warn('[network-stats] local compute failed, no prior value:', err);
    const members = await Promise.all(MEMBERS.map((m) => fetchMember(m.statsUrl)));
    return members.reduce<NetworkMetrics>(
      (acc, p) => ({
        sellers: acc.sellers + p.sellers,
        buyingAgents: acc.buyingAgents + p.buyingAgents,
        products: acc.products + p.products,
        syntheticAgents: acc.syntheticAgents + p.syntheticAgents,
      }),
      { sellers: 0, buyingAgents: 0, products: 0, syntheticAgents: 0 },
    );
  }
}

// 30-minute cache. The local counts hit app_seller_products (large + GIN
// index), so a short window meant the public landing page ran an expensive
// count almost every minute , and during a catalogue ingest those counts piled
// onto an already-stressed DB. The headline metrics move slowly; 30 min is
// plenty fresh, and lastGood covers any recompute that fails under load.
export const getNetworkMetrics = unstable_cache(compute, ['via-network-metrics'], {
  revalidate: 1800,
});
