import { getBrandBySlug } from '@/lib/rrg/db';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';

type Props = {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) return { title: 'Brand Not Found' };
  return {
    title: `${brand.name}, Real Real Genuine`,
    description: brand.headline || brand.description || `${brand.name} on Real Real Genuine`,
  };
}

export default async function BrandPublicLayout({ children, params }: Props) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand || brand.status !== 'active') return notFound();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <RRGHeader active="brands" />
      <main>{children}</main>
      <RRGFooter />
    </div>
  );
}
