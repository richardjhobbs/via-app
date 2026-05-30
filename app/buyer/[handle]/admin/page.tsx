import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { NotificationBell } from '@/components/app/NotificationBell';
import ThemeToggle from '@/components/app/ThemeToggle';

export const dynamic = 'force-dynamic';

const OPEN_STATUSES = ['open', 'broadcast', 'matched'];
const PAID_STATUSES = ['paid', 'minted', 'paid_out'];

interface IntentRow {
  id: string;
  intent_text: string;
  status: string;
  created_at: string;
}

/**
 * Buying Agent dashboard, in the Maison visual language. Mirrors the design
 * prototype's layout (header, metric tiles, briefs table, agent panel) but
 * every figure is real: briefs from app_buyer_intents, spend/orders from
 * app_purchases, preferences from app_buyer_memories. The prototype's mock
 * panels (live activity ledger, open-negotiation cards) have no data model
 * and are intentionally not shipped.
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

  const user = await getBuyerUser();
  if (user?.id !== buyer.owner_user_id) return notFound();

  const buyerId = buyer.id as string;
  const mcpUrl  = `https://app.getvia.xyz/buyers/${buyer.handle}/mcp`;
  const created = new Date(buyer.created_at as string).toISOString().slice(0, 10);
  const name    = (buyer.display_name as string | null) ?? (buyer.handle as string);
  const agentCode = `${(buyer.handle as string).toUpperCase().replace(/[^A-Z0-9]/g, '')}·BA`;

  const caps = (buyer.delegation_caps ?? {}) as Record<string, unknown>;
  const capsSet = Object.keys(caps).length > 0;
  const maxPurchase = typeof caps.max_purchase_usd === 'number' ? `$${caps.max_purchase_usd}` : null;

  // Briefs (real)
  const { data: intentRows } = await db
    .from('app_buyer_intents')
    .select('id, intent_text, status, created_at')
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false });
  const intents = (intentRows ?? []) as IntentRow[];
  const briefsLive = intents.filter((i) => OPEN_STATUSES.includes(i.status)).length;

  // Preferences (real)
  const { count: prefsCount } = await db
    .from('app_buyer_memories')
    .select('id', { count: 'exact', head: true })
    .eq('buyer_id', buyerId)
    .eq('active', true);

  // Orders + 30-day spend (real)
  let ordersCount = 0;
  let spend30d = 0;
  const orParts: string[] = [];
  if (buyer.erc8004_agent_id)     orParts.push(`buyer_agent_id.eq.${buyer.erc8004_agent_id}`);
  if (buyer.wallet_address)       orParts.push(`buyer_wallet.eq.${buyer.wallet_address}`);
  if (buyer.agent_wallet_address) orParts.push(`buyer_wallet.eq.${buyer.agent_wallet_address}`);
  if (orParts.length) {
    const { data: purchases } = await db
      .from('app_purchases')
      .select('total_usdc, created_at')
      .or(orParts.join(','))
      .in('status', PAID_STATUSES);
    const rows = purchases ?? [];
    ordersCount = rows.length;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    spend30d = rows
      .filter((r) => new Date(r.created_at as string).getTime() >= cutoff)
      .reduce((sum, r) => sum + Number(r.total_usdc ?? 0), 0);
  }

  const spendFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(spend30d);
  const visibleBriefs = intents.slice(0, 6);

  return (
    <main className="min-h-screen bg-background text-ink font-sans flex flex-col">
      {/* Header */}
      <header className="border-b border-line">
        <div className="max-w-6xl mx-auto px-6 md:px-10 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-8">
            <Link href="/" aria-label="VIA home" className="wordmark text-ink">VIA</Link>
            <nav className="hidden md:flex items-center gap-6">
              <span className="uc-mono text-ink">Dashboard</span>
              <Link href={`/buyer/${buyer.handle}/admin/intents`} className="uc-mono text-ink-3 hover:text-ink transition-colors">Briefs</Link>
              <Link href={`/buyer/${buyer.handle}/admin/preferences`} className="uc-mono text-ink-3 hover:text-ink transition-colors">Preferences</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <a
              href={mcpUrl}
              target="_blank"
              rel="noreferrer"
              className="uc-mono text-ink-3 hover:text-ink transition-colors hidden sm:inline-flex items-center gap-1"
            >
              MCP <span aria-hidden>&#8599;</span>
            </a>
            <span className="hidden sm:inline uc-mono text-ink border border-line px-3 py-1.5 rounded-full">{name}</span>
            <NotificationBell />
            <ThemeToggle />
            <form action="/api/buyer/auth/logout" method="post">
              <button className="uc-mono text-ink-3 hover:text-ink transition-colors">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto px-6 md:px-10 py-10 md:py-14">
        {/* Subhead */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
          <div>
            <p className="uc-mono text-ink-3 mb-3">Buyer</p>
            <h1 className="font-serif text-4xl md:text-5xl leading-[1.05] tracking-tight mb-4">{name}</h1>
            <span className="inline-flex items-center gap-2 border border-line rounded-full px-3 py-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--live)]" aria-hidden />
              <span className="uc-mono text-ink-2">Your Buying Agent · {agentCode} · {briefsLive} briefs live</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/buyer/${buyer.handle}/admin/delegation`} className="btn ghost">
              {capsSet ? 'Adjust limits' : 'Set limits'}
            </Link>
            <Link href={`/buyer/${buyer.handle}/admin/intents`} className="btn">
              New brief <span className="arrow" aria-hidden>&rarr;</span>
            </Link>
          </div>
        </div>

        {/* Metric tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-l border-line mb-12">
          <MetricCell value={String(briefsLive)} label="Briefs live" sub="sourcing" />
          <MetricCell value={String(ordersCount)} label="Orders" sub="all time" />
          <MetricCell value={spendFmt} label="Spent · 30d" sub="USDC" />
          <MetricCell value={String(prefsCount ?? 0)} label="Preferences" sub="locked in" />
        </div>

        {/* Main two-column */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
          {/* Briefs table */}
          <section className="border border-line bg-paper">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <p className="uc-mono text-ink">Your briefs</p>
              <Link href={`/buyer/${buyer.handle}/admin/intents`} className="uc-mono text-ink-3 hover:text-ink transition-colors">
                Manage all {intents.length > 0 ? intents.length : ''} <span aria-hidden>&rarr;</span>
              </Link>
            </div>
            {visibleBriefs.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-ink-3 mb-4">No briefs yet. Tell your agent what to pursue.</p>
                <Link href={`/buyer/${buyer.handle}/admin/intents`} className="btn ghost">Add a brief</Link>
              </div>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line">
                    <th className="uc-mono text-ink-3 font-normal px-5 py-3">Brief</th>
                    <th className="uc-mono text-ink-3 font-normal px-5 py-3 hidden sm:table-cell">Added</th>
                    <th className="uc-mono text-ink-3 font-normal px-5 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBriefs.map((b) => (
                    <tr key={b.id} className="border-b border-line last:border-0">
                      <td className="px-5 py-4 text-sm text-ink max-w-0">
                        <span className="block truncate">{b.intent_text}</span>
                      </td>
                      <td className="px-5 py-4 hidden sm:table-cell">
                        <span className="font-mono text-xs text-ink-3">{new Date(b.created_at).toISOString().slice(0, 10)}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <StatusPill status={b.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Agent panel */}
          <section className="border border-line bg-paper">
            <div className="px-5 py-4 border-b border-line">
              <p className="uc-mono text-ink">Your agent</p>
            </div>
            <div className="p-5 flex flex-col gap-5">
              <Field label="Handle" value={buyer.handle as string} mono />
              <Field label="Funding wallet" value={(buyer.wallet_address as string | null) ?? '(none)'} mono />
              <Field label="Agent wallet" value={(buyer.agent_wallet_address as string | null) ?? '(not provisioned)'} mono />
              <Field label="ERC-8004 agent ID" value={(buyer.erc8004_agent_id as string | null) ?? 'minting…'} mono />
              <Field label="Visibility" value={buyer.public ? 'Public · agents can negotiate' : 'Private'} />
              <Field
                label="Delegation caps"
                value={capsSet ? `Configured${maxPurchase ? ` · ceiling ${maxPurchase}` : ''}` : 'No limits set yet'}
              />

              <div className="border-t border-line pt-5">
                <p className="uc-mono text-ink-3 mb-2">Agent endpoint</p>
                <code className="block bg-background border border-line px-3 py-2.5 font-mono text-xs break-all text-ink">{mcpUrl}</code>
              </div>

              <div className="border-t border-line pt-5 flex flex-col gap-2">
                <ActionRow href={`/buyer/${buyer.handle}/admin/buying-agent`} label="Train your agent" />
                <ActionRow href={`/buyer/${buyer.handle}/admin/preferences`} label="View preferences" />
                <ActionRow href={`/buyer/${buyer.handle}/admin/delegation`} label={capsSet ? 'Edit delegation caps' : 'Set delegation caps'} />
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="uc-mono text-ink-3">© VIA Labs Pte Ltd · Singapore</p>
          <div className="flex items-center gap-5">
            <Link href="/" className="uc-mono text-ink-3 hover:text-ink transition-colors">Home</Link>
            <Link href="/faq/buyers" className="uc-mono text-ink-3 hover:text-ink transition-colors">FAQ</Link>
            <span className="uc-mono text-ink-3">Onboarded {created}</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function MetricCell({ value, label, sub }: { value: string; label: string; sub: string }) {
  return (
    <div className="border-r border-b border-line px-5 py-6">
      <div className="font-serif text-4xl tracking-tight tabular-nums mb-2">{value}</div>
      <div className="uc-mono text-ink-3">{label}</div>
      <div className="font-mono text-[10px] text-ink-3 mt-1">{sub}</div>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="uc-mono text-ink-3 mb-1">{label}</div>
      <div className={`text-sm text-ink ${mono ? 'font-mono break-all' : ''}`}>{value}</div>
    </div>
  );
}

function ActionRow({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between border border-line px-4 py-3 hover:border-ink transition-colors group"
    >
      <span className="uc-mono text-ink">{label}</span>
      <span className="text-ink-3 group-hover:text-ink transition-colors" aria-hidden>&rarr;</span>
    </Link>
  );
}

function StatusPill({ status }: { status: string }) {
  const live = OPEN_STATUSES.includes(status);
  const resolved = status === 'resolved';
  const cls = live
    ? 'text-[var(--live)] border-[color:var(--live)]'
    : resolved
      ? 'text-accent border-line-strong'
      : 'text-ink-3 border-line';
  return (
    <span className={`inline-block uc-mono border rounded-full px-2.5 py-1 ${cls}`}>{status}</span>
  );
}
