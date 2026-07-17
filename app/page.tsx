import LandingClient from './LandingClient';
import { getNetworkMetrics } from '@/lib/app/network-stats';
import { getWireEvents } from '@/lib/app/wire';

export const metadata = {
  title: 'VIA · Sales & Buying Agents',
  description: 'Onboard your business as a VIA seller, or train a personal Buying Agent. Agentic commerce settled in USDC on Base.',
};

// Render at request time, not at build. The network-stats counts run exact
// counts over the (now 70k+ row) catalogue; prerendering them at build pushed
// the page past Next's 60s per-page budget and broke deploys. At runtime the
// counts are cached 60s (unstable_cache) and degrade gracefully on timeout.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [metrics, wire] = await Promise.all([getNetworkMetrics(), getWireEvents(50)]);
  return <LandingClient metrics={metrics} wire={wire} />;
}
