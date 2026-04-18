import type { Metadata } from 'next';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';

export const metadata: Metadata = {
  title: 'The Store, Real Real Genuine',
  description: 'Submit designs. Earn USDC. Own on-chain.',
};

export default function RRGLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <RRGHeader active="store" />
      <main>{children}</main>
      <RRGFooter />
    </div>
  );
}
