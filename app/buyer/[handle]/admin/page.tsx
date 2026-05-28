import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { db } from '@/lib/app/db';
import { getSellerUser } from '@/lib/app/seller-auth';

export const dynamic = 'force-dynamic';

/**
 * Buying Agent dashboard. Reached after the buyer wizard succeeds or from
 * /buyer/login. Mirrors the seller dashboard but inverted: the buyer
 * trains their own agent, not pitches one.
 */
export default async function BuyerAdminPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name, public, wallet_address, agent_wallet_address, erc8004_agent_id, delegation_caps, owner_user_id, created_at')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !buyer) return notFound();

  const user = await getSellerUser();
  if (user?.id !== buyer.owner_user_id) return notFound();

  const mcpUrl  = `https://app.getvia.xyz/buyers/${buyer.handle}/mcp`;
  const created = new Date(buyer.created_at as string).toISOString().slice(0, 10);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
          </Link>
          <form action="/api/seller/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex-1 px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Buying Agent</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
            {buyer.display_name}
          </h1>
          <p className="text-neutral-600 mb-10 max-w-xl">
            Your Buying Agent is provisioned. Train it to know your taste, budget, and limits, and
            it will represent you when seller agents negotiate. The training chat surface ships next.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
            <Stat label="Handle"           value={buyer.handle as string} mono />
            <Stat label="Visibility"       value={buyer.public ? 'Public (agents can negotiate)' : 'Private'} />
            <Stat label="Funding wallet"   value={buyer.wallet_address as string} mono />
            <Stat label="Agent wallet"     value={(buyer.agent_wallet_address as string | null) ?? '(not provisioned)'} mono />
            <Stat label="ERC-8004 agent ID" value={(buyer.erc8004_agent_id as string | null) ?? 'minting…'} mono />
            <Stat label="Delegation caps"  value={JSON.stringify(buyer.delegation_caps ?? {})} mono />
          </div>

          <div className="border-t border-neutral-200 pt-8 mb-10">
            <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Your agent endpoint</p>
            <p className="text-sm text-neutral-600 mb-3">
              When you flip visibility to public, seller agents can negotiate with your Buying Agent at:
            </p>
            <code className="block bg-white border border-neutral-300 rounded-md px-4 py-3 font-mono text-sm break-all">
              {mcpUrl}
            </code>
          </div>

          <div className="border-t border-neutral-200 pt-8">
            <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Coming next</p>
            <ul className="text-sm text-neutral-600 leading-relaxed space-y-1">
              <li>· Buying Agent training chat (preferences, budget, hard nos)</li>
              <li>· Delegation cap controls (max_purchase_usd, auto_buy_under_usd)</li>
              <li>· Intent broadcast (find me X with constraints Y)</li>
              <li>· Conversation history with thumbs-up/down feedback</li>
              <li>· Public per-buyer MCP endpoint (opt-in)</li>
            </ul>
          </div>

          <p className="text-xs font-mono tracking-widest text-neutral-500 mt-10 uppercase">
            Onboarded {created}
          </p>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-mono tracking-widest text-neutral-500 uppercase mb-1">{label}</div>
      <div className={`text-sm text-neutral-900 ${mono ? 'font-mono break-all' : ''}`}>{value}</div>
    </div>
  );
}
