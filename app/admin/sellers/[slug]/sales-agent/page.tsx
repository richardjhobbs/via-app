import { notFound } from 'next/navigation';
import { db } from '@/lib/app/db';
import SalesAgentChatClient from './SalesAgentChatClient';

export const dynamic = 'force-dynamic';

export default async function SalesAgentChatPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: brand, error } = await db
    .from('app_sellers')
    .select('id, slug, name, headline, logo_path')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !brand) return notFound();

  return (
    <SalesAgentChatClient
      sellerId={brand.id as string}
      sellerSlug={brand.slug as string}
      sellerName={brand.name as string}
      brandHeadline={(brand.headline as string | null) ?? null}
    />
  );
}
