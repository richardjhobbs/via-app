import { notFound } from 'next/navigation';
import { db } from '@/lib/rrg/db';
import ConciergeChatClient from './ConciergeChatClient';

export const dynamic = 'force-dynamic';

export default async function BrandConciergeChatPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: brand, error } = await db
    .from('rrg_brands')
    .select('id, slug, name, headline, logo_path')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !brand) return notFound();

  return (
    <ConciergeChatClient
      brandId={brand.id as string}
      brandSlug={brand.slug as string}
      brandName={brand.name as string}
      brandHeadline={(brand.headline as string | null) ?? null}
    />
  );
}
