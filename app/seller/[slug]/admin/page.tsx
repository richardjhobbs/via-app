import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/app/db';
import { getSellerUser } from '@/lib/app/seller-auth';
import SellerDashboardClient from './SellerDashboardClient';

export const dynamic = 'force-dynamic';

/**
 * Seller admin landing, in the Maison visual language. Auth and seller identity
 * (name, agent code, MCP endpoint) are real, as are the management links into
 * products, sales, shipping and the training chat. The live-activity ledger,
 * open-negotiation cards, metrics and listings table are design seed data,
 * shipped as a visual prototype of the Sales Agent's work surface.
 */
export default async function SellerAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, owner_user_id')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !seller) return notFound();

  const user = await getSellerUser();
  if (!user) {
    redirect(`/seller/login?next=${encodeURIComponent(`/seller/${slug}/admin`)}`);
  }
  if (user.id !== seller.owner_user_id) return notFound();

  const name = seller.name as string;
  const agentCode = `${(seller.slug as string).toUpperCase().replace(/[^A-Z0-9]/g, '')}·SA`;
  const mcpUrl = `https://app.getvia.xyz/sellers/${seller.slug}/mcp`;

  return (
    <SellerDashboardClient
      name={name}
      slug={seller.slug as string}
      agentCode={agentCode}
      mcpUrl={mcpUrl}
    />
  );
}
