import { notFound } from 'next/navigation';
import { db } from '@/lib/rrg/db';
import ConciergePreviewClient from './ConciergePreviewClient';

export const dynamic = 'force-dynamic';

// Public, unauthenticated brand-concierge preview. Anyone with the URL can
// ask the brand's concierge a question; the reply is grounded only in the
// brand's locked-in memories. No login, no admin gate.
export default async function BrandConciergePreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: brand, error } = await db
    .from('rrg_brands')
    .select('id, slug, name, headline')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !brand) return notFound();

  return (
    <ConciergePreviewClient
      brandId={brand.id as string}
      brandSlug={brand.slug as string}
      brandName={brand.name as string}
      brandHeadline={(brand.headline as string | null) ?? null}
    />
  );
}
