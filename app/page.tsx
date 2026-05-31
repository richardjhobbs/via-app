import LandingClient from './LandingClient';
import { getNetworkMetrics } from '@/lib/app/network-stats';

export const metadata = {
  title: 'VIA · Sales & Buying Agents',
  description: 'Onboard your business as a VIA seller, or train a personal Buying Agent. Agentic commerce settled in USDC on Base.',
};

export default async function HomePage() {
  const metrics = await getNetworkMetrics();
  return <LandingClient metrics={metrics} />;
}
