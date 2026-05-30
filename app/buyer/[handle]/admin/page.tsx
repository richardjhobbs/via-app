import { notFound } from 'next/navigation';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import BuyerDashboardClient from './BuyerDashboardClient';

export const dynamic = 'force-dynamic';

/**
 * Buying Agent dashboard, in the Maison visual language. Auth and buyer
 * identity (name, agent code, MCP endpoint) are real; the live-activity ledger,
 * open-negotiation cards, metrics and briefs table are design seed data, shipped
 * as a visual prototype of the agent's work surface.
 */
export default async function BuyerAdminPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name, owner_user_id')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !buyer) return notFound();

  const user = await getBuyerUser();
  if (user?.id !== buyer.owner_user_id) return notFound();

  const name = (buyer.display_name as string | null) ?? (buyer.handle as string);
  const agentCode = `${(buyer.handle as string).toUpperCase().replace(/[^A-Z0-9]/g, '')}·BA`;
  const mcpUrl = `https://app.getvia.xyz/buyers/${buyer.handle}/mcp`;

  return (
    <BuyerDashboardClient
      name={name}
      handle={buyer.handle as string}
      agentCode={agentCode}
      mcpUrl={mcpUrl}
    />
  );
}
