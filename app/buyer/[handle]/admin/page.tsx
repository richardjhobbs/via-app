import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { NotificationBell } from '@/components/app/NotificationBell';

export const dynamic = 'force-dynamic';

/**
 * Buying Agent dashboard. Reached after the buyer wizard succeeds or from
 * /buyer/login. Mirror of the seller dashboard, inverted: the buyer trains
 * their own agent and sets the limits it negotiates under.
 */
export default async function BuyerAdminPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name, public, wallet_address, agent_wallet_address, erc8004_buyer_id, erc8004_agent_id, delegation_caps, owner_user_id, created_at')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !buyer) return notFound();

  const user = await getBuyerUser();
  if (user?.id !== buyer.owner_user_id) return notFound();

  const mcpUrl  = `https://app.getvia.xyz/buyers/${buyer.handle}/mcp`;
  const created = new Date(buyer.created_at as string).toISOString().slice(0, 10);

  const caps = (buyer.delegation_caps ?? {}) as Record<string, unknown>;
  const capsSet = Object.keys(caps).length > 0;
  const maxPurchase = typeof caps.max_purchase_usd === 'number' ? `$${caps.max_purchase_usd}` : null;
  const capsSummary = capsSet
    ? `Configured${maxPurchase ? ` · ceiling ${maxPurchase}` : ''}`
    : 'No limits set yet';

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
          </Link>
          <div className="flex items-center gap-4">
            <NotificationBell />
            <form action="/api/buyer/auth/logout" method="post">
              <button className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="flex-1 px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Buying Agent</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
            {(buyer.display_name as string | null) ?? buyer.handle}
          </h1>
          <p className="text-neutral-600 mb-10 max-w-xl">
            Train your agent on your taste, budget, and limits. It applies those when seller agents
            negotiate, and refuses anything that breaks a delegation cap you set.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
            <Stat label="Handle"            value={buyer.handle as string} mono />
            <Stat label="Display name"      value={(buyer.display_name as string | null) ?? '(none)'} />
            <Stat label="Funding wallet"    value={buyer.wallet_address as string} mono />
            <Stat label="Agent wallet"      value={(buyer.agent_wallet_address as string | null) ?? '(not provisioned)'} mono />
            <Stat label="ERC-8004 buyer ID" value={(buyer.erc8004_buyer_id as string | null) ?? 'minting…'} mono />
            <Stat label="ERC-8004 agent ID" value={(buyer.erc8004_agent_id as string | null) ?? 'minting…'} mono />
            <Stat label="Visibility"        value={buyer.public ? 'Public (agents can negotiate)' : 'Private'} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-neutral-200 pt-8 mb-10">
            <div className="flex flex-col">
              <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Train your agent</p>
              <p className="text-sm text-neutral-600 mb-4 flex-grow">
                Brief your agent in plain language on taste, budget, and hard nos. It locks them in
                as preferences and applies them when seller agents negotiate.
              </p>
              <Link
                href={`/buyer/${buyer.handle}/admin/buying-agent`}
                className="inline-block self-start px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
              >
                Open chat <span aria-hidden>&rarr;</span>
              </Link>
            </div>

            <div className="flex flex-col">
              <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Preferences</p>
              <p className="text-sm text-neutral-600 mb-4 flex-grow">
                Every preference your agent has locked in, in one list. Add new ones through the
                training chat.
              </p>
              <Link
                href={`/buyer/${buyer.handle}/admin/preferences`}
                className="inline-block self-start px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
              >
                View preferences <span aria-hidden>&rarr;</span>
              </Link>
            </div>

            <div className="flex flex-col">
              <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Intents</p>
              <p className="text-sm text-neutral-600 mb-4 flex-grow">
                Tell your agent what you are looking for right now. Open intents guide what it
                surfaces and pursues on your behalf.
              </p>
              <Link
                href={`/buyer/${buyer.handle}/admin/intents`}
                className="inline-block self-start px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
              >
                Manage intents <span aria-hidden>&rarr;</span>
              </Link>
            </div>

            <div className="flex flex-col">
              <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Delegation caps</p>
              <p className="text-sm text-neutral-600 mb-2 flex-grow">
                The hard limits your agent buys under: spend ceilings, auto-buy thresholds, allowed
                and blocked categories.
              </p>
              <p className={`text-xs font-mono mb-4 ${capsSet ? 'text-emerald-700' : 'text-amber-700'}`}>
                {capsSummary}
              </p>
              <Link
                href={`/buyer/${buyer.handle}/admin/delegation`}
                className="inline-block self-start px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
              >
                {capsSet ? 'Edit caps' : 'Set caps'} <span aria-hidden>&rarr;</span>
              </Link>
            </div>
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

          <p className="text-xs font-mono tracking-widest text-neutral-500 mt-2 uppercase">
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
