import { notFound, redirect } from 'next/navigation';
import { isAdminFromCookies } from '@/lib/rrg/auth';
import { db } from '@/lib/rrg/db';
import ConciergePreviewClient from './ConciergePreviewClient';

export const dynamic = 'force-dynamic';

export default async function BrandConciergePreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Superadmin gate only; the brand-admin embedded variant lives under /brand/[slug]/admin.
  if (!(await isAdminFromCookies())) {
    redirect('/admin/rrg');
  }

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
