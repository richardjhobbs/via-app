import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/app/db';
import { isAdminFromCookies } from '@/lib/app/auth';
import SalesAgentChatClient from './SalesAgentChatClient';

export const dynamic = 'force-dynamic';

export default async function SalesAgentChatPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!(await isAdminFromCookies())) {
    redirect(`/admin/login?next=/admin/sellers/${slug}/sales-agent`);
  }

  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, headline')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !seller) return notFound();

  return (
    <SalesAgentChatClient
      sellerId={seller.id as string}
      sellerSlug={seller.slug as string}
      sellerName={seller.name as string}
      brandHeadline={(seller.headline as string | null) ?? null}
    />
  );
}
