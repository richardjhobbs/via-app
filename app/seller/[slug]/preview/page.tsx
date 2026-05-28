import { notFound } from 'next/navigation';
import { db } from '@/lib/app/db';
import SalesAgentPreviewClient from './SalesAgentPreviewClient';

export const dynamic = 'force-dynamic';

// Public, unauthenticated brand-concierge preview. Anyone with the URL can
// ask the brand's concierge a question; the reply is grounded only in the
// brand's locked-in memories. No login, no admin gate.
export default async function SalesAgentPreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: brand, error } = await db
    .from('app_sellers')
    .select('id, slug, name, headline')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !brand) return notFound();

  return (
    <SalesAgentPreviewClient
      sellerId={brand.id as string}
      sellerSlug={brand.slug as string}
      sellerName={brand.name as string}
      brandHeadline={(brand.headline as string | null) ?? null}
    />
  );
}
