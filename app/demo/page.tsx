import type { Metadata } from 'next';
import { DemoClient } from './DemoClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'VIA , the marketplace where nobody shops',
  description:
    'State what you want in plain language. The network’s storefront agents answer, and yours keeps only what genuinely fits. A live demo of agent-native commerce.',
};

/**
 * Public, no-auth demo of the VIA matcher. Hits the same POST /api/via/match
 * (submit_intent) pipeline an external agent would: extract intent -> recall
 * across the whole federated network (VIA + RRG) -> AI judge. Built for filming
 * and for sending as a link: every brief here is reproducible by anyone.
 */
export default function DemoPage() {
  return (
    <main className="min-h-screen bg-background text-ink">
      <DemoClient />
    </main>
  );
}
