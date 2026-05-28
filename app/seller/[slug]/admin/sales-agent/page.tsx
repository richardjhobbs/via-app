import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Redirect /seller/[slug]/admin/sales-agent → /seller/[slug]/admin until
 * the per-seller chat client is properly wired against the new
 * app_sellers / app_seller_memories schema. The wizard's success step
 * lands here, so a redirect keeps the new-seller path unbroken.
 */
export default async function SalesAgentRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/seller/${slug}/admin`);
}
