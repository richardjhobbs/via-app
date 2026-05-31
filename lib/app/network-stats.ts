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
}

interface MemberStats {
  sellers: number;
  products: number;
  buyingAgents: number;
}

// Other VIA platforms that self-report counts. via-app's own counts are local.
const MEMBERS: { name: string; statsUrl: string }[] = [
  { name: 'rrg', statsUrl: 'https://realrealgenuine.com/api/rrg/stats' },
];

async function fetchLocal(): Promise<MemberStats> {
  const [sellers, products, buyers] = await Promise.all([
    db.from('app_sellers').select('id', { count: 'exact', head: true }).eq('active', true),
    db.from('app_seller_products').select('id', { count: 'exact', head: true })
      .eq('active', true).eq('on_chain_status', 'registered'),
    db.from('app_buyers').select('id', { count: 'exact', head: true }),
  ]);
  return {
    sellers: sellers.count ?? 0,
    products: products.count ?? 0,
    buyingAgents: buyers.count ?? 0,
  };
}

async function fetchMember(statsUrl: string): Promise<MemberStats> {
  try {
    const res = await fetch(statsUrl, { next: { revalidate: 60 } });
    if (!res.ok) return { sellers: 0, products: 0, buyingAgents: 0 };
    const j = (await res.json()) as Partial<MemberStats>;
    return {
      sellers: Number(j.sellers) || 0,
      products: Number(j.products) || 0,
      buyingAgents: Number(j.buyingAgents) || 0,
    };
  } catch {
    return { sellers: 0, products: 0, buyingAgents: 0 };
  }
}

async function compute(): Promise<NetworkMetrics> {
  const parts = await Promise.all([
    fetchLocal(),
    ...MEMBERS.map((m) => fetchMember(m.statsUrl)),
  ]);
  return parts.reduce<NetworkMetrics>(
    (acc, p) => ({
      sellers: acc.sellers + p.sellers,
      buyingAgents: acc.buyingAgents + p.buyingAgents,
      products: acc.products + p.products,
    }),
    { sellers: 0, buyingAgents: 0, products: 0 },
  );
}

export const getNetworkMetrics = unstable_cache(compute, ['via-network-metrics'], {
  revalidate: 60,
});
