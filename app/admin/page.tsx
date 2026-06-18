import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { db } from '@/lib/app/db';
import { isAdminFromCookies } from '@/lib/app/auth';
import { StoreApprovalActions } from './StoreApprovalActions';
import ThemeToggle from '@/components/app/ThemeToggle';

export const dynamic = 'force-dynamic';

interface PendingStoreRow {
  slug:                 string;
  name:                 string;
  kind:                 string;
  contact_email:        string;
  wallet_address:       string;
  agent_wallet_address: string | null;
  description:          string | null;
  website_url:          string | null;
  submitted_at:         string | null;
  approval_eligible_at: string | null;
}

async function loadPendingStores(): Promise<PendingStoreRow[]> {
  const { data, error } = await db
    .from('app_sellers')
    .select('slug, name, kind, contact_email, wallet_address, agent_wallet_address, description, website_url, submitted_at, approval_eligible_at')
    .eq('approval_status', 'pending')
    .order('submitted_at', { ascending: true });
  if (error || !data) return [];
  return data as PendingStoreRow[];
}

interface SellerRow {
  id:               string;
  slug:             string;
  name:             string;
  kind:             string;
  contact_email:    string;
  wallet_address:   string;
  erc8004_agent_id: string | null;
  active:           boolean;
  created_at:       string;
  product_count:    number;
  sales_count:      number;
}

interface BuyerRow {
  id:               string;
  handle:           string;
  display_name:     string | null;
  wallet_address:   string;
  erc8004_agent_id: string | null;
  public:           boolean;
  created_at:       string;
  intents_count:    number;
}

async function loadSellers(): Promise<SellerRow[]> {
  const { data: sellers, error } = await db
    .from('app_sellers')
    .select('id, slug, name, kind, contact_email, wallet_address, erc8004_agent_id, active, created_at, product_count')
    .order('created_at', { ascending: false });
  if (error || !sellers) return [];
  if (sellers.length === 0) return [];

  // Product counts are NOT counted live: a count over the 200k-row catalogue
  // times out / saturates the pool. They are cached on app_sellers.product_count
  // and refreshed by the ingest worker after each store sync (and a one-time
  // backfill). This is an internal reference view, so a per-sync-fresh number is
  // fine. Sales are still counted live from app_purchases — a small table, well
  // under the PostgREST ~1000-row fetch cap.
  const ids = sellers.map((s) => s.id as string);
  const { data: purchases } = await db.from('app_purchases').select('seller_id').in('seller_id', ids);
  const sCount = new Map<string, number>();
  for (const r of purchases ?? []) {
    const k = r.seller_id as string;
    sCount.set(k, (sCount.get(k) ?? 0) + 1);
  }

  return sellers.map((s) => ({
    id:               s.id as string,
    slug:             s.slug as string,
    name:             s.name as string,
    kind:             s.kind as string,
    contact_email:    s.contact_email as string,
    wallet_address:   s.wallet_address as string,
    erc8004_agent_id: s.erc8004_agent_id as string | null,
    active:           s.active as boolean,
    created_at:       s.created_at as string,
    product_count:    (s.product_count as number) ?? 0,
    sales_count:      sCount.get(s.id as string) ?? 0,
  }));
}

async function loadBuyers(): Promise<BuyerRow[]> {
  const { data: buyers, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name, wallet_address, erc8004_agent_id, public, created_at')
    .order('created_at', { ascending: false });
  if (error || !buyers) return [];

  const ids = buyers.map((b) => b.id as string);
  if (ids.length === 0) {
    return buyers.map((b) => ({
      id:               b.id as string,
      handle:           b.handle as string,
      display_name:     b.display_name as string | null,
      wallet_address:   b.wallet_address as string,
      erc8004_agent_id: b.erc8004_agent_id as string | null,
      public:           b.public as boolean,
      created_at:       b.created_at as string,
      intents_count:    0,
    }));
  }

  const { data: intents } = await db
    .from('app_buyer_intents')
    .select('buyer_id')
    .in('buyer_id', ids);
  const iCount = new Map<string, number>();
  for (const r of intents ?? []) {
    const k = r.buyer_id as string;
    iCount.set(k, (iCount.get(k) ?? 0) + 1);
  }

  return buyers.map((b) => ({
    id:               b.id as string,
    handle:           b.handle as string,
    display_name:     b.display_name as string | null,
    wallet_address:   b.wallet_address as string,
    erc8004_agent_id: b.erc8004_agent_id as string | null,
    public:           b.public as boolean,
    created_at:       b.created_at as string,
    intents_count:    iCount.get(b.id as string) ?? 0,
  }));
}

interface LoadRun {
  id:             string;
  started_at:     string;
  finished_at:    string | null;
  target:         string;
  agent_count:    number;
  concurrency:    number;
  total_requests: number;
  error_count:    number;
  p50_ms:         number | null;
  p95_ms:         number | null;
  p99_ms:         number | null;
  throughput_rps: string | number | null;
  notes:          string | null;
}

interface LoadStats {
  syntheticAgents: number;
  organicAgents:   number;
  runs:            LoadRun[];
}

// The synthetic load-test record lives in the RRG project, not this app's DB.
// RRG exposes it as aggregate read-only metrics so we render it here without
// sharing a service key across Supabase projects.
const RRG_ORIGIN = process.env.RRG_ORIGIN ?? 'https://realrealgenuine.com';

async function loadLoadStats(): Promise<LoadStats | null> {
  // Hard 3s cap: this is a cross-origin call to RRG inside the admin render
  // path. Without a timeout, an RRG outage would hang the whole dashboard.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const r = await fetch(`${RRG_ORIGIN}/api/rrg/load-stats`, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    return (await r.json()) as LoadStats;
  } catch {
    return null;
  }
}

function truncWallet(w: string | null | undefined): string {
  if (!w) return '—';
  return w.length <= 14 ? w : `${w.slice(0, 8)}…${w.slice(-4)}`;
}

function fmtMs(ms: number | null): string {
  if (ms == null) return 'n/a';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export default async function AdminLandingPage() {
  if (!(await isAdminFromCookies())) {
    redirect('/admin/login?next=/admin');
  }

  const [sellers, buyers, loadStats, pendingStores] = await Promise.all([
    loadSellers(),
    loadBuyers(),
    loadLoadStats(),
    loadPendingStores(),
  ]);

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center gap-3">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">Superadmin</span>
          </Link>
          <div className="flex items-center gap-5">
            <ThemeToggle className="on-dark" />
            <form action="/api/admin/auth/logout" method="post">
              <button className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Admin</p>
          <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-8">Overview</h1>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Sellers"            value={String(sellers.length)} />
            <StatCard label="Active sellers"     value={String(sellers.filter((s) => s.active).length)} />
            <StatCard label="Buyers"             value={String(buyers.length)} />
            <StatCard label="Public buyer cards" value={String(buyers.filter((b) => b.public).length)} />
          </div>

          {loadStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12">
              <StatCard label="Organic agents"   value={String(loadStats.organicAgents)} />
              <StatCard label="Synthetic agents" value={String(loadStats.syntheticAgents)} />
            </div>
          )}

          {/* Pending store approvals (agent self-registered) */}
          {pendingStores.length > 0 && (
            <div className="mb-16">
              <div className="flex items-end justify-between mb-4">
                <h2 className="font-serif text-2xl tracking-tight">Pending store approvals</h2>
                <span className="text-[10px] font-mono uppercase tracking-widest text-amber-700">
                  {pendingStores.length} awaiting review
                </span>
              </div>
              <p className="text-xs text-ink-3 mb-4 max-w-2xl">
                Agent self-registered stores (via the MCP register_store tool). Each stays invisible
                until approved. Review for quality: nothing illegal, immoral, or offensive. Approving
                activates the store and mints its ERC-8004 identity to the agent wallet.
              </p>
              <div className="bg-paper border border-amber-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-amber-50 text-xs font-mono uppercase tracking-widest text-amber-800">
                    <tr>
                      <th className="text-left px-4 py-3">Store</th>
                      <th className="text-left px-4 py-3">Kind</th>
                      <th className="text-left px-4 py-3">Contact</th>
                      <th className="text-left px-4 py-3">Payout / agent wallet</th>
                      <th className="text-left px-4 py-3">Submitted</th>
                      <th className="text-right px-4 py-3">Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {pendingStores.map((s) => (
                      <tr key={s.slug} className="hover:bg-amber-50/40 align-top">
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-ink">{s.slug}</span>
                          <span className="block text-ink-2">{s.name}</span>
                          {s.description && (
                            <span className="block text-xs text-ink-3 max-w-xs mt-1">{s.description.slice(0, 160)}</span>
                          )}
                          {s.website_url && (
                            <a href={s.website_url} target="_blank" rel="noreferrer" className="block text-xs text-sky-700 underline mt-1">
                              {s.website_url}
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-2">{s.kind}</td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-2">{s.contact_email}</td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-3">
                          <span title={s.wallet_address}>{truncWallet(s.wallet_address)}</span>
                          <span className="block" title={s.agent_wallet_address ?? ''}>{truncWallet(s.agent_wallet_address)}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-3">{s.submitted_at ? fmtDate(s.submitted_at) : '—'}</td>
                        <td className="px-4 py-3">
                          <StoreApprovalActions slug={s.slug} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sellers */}
          <div className="mb-16">
            <div className="flex items-end justify-between mb-4">
              <h2 className="font-serif text-2xl tracking-tight">Sellers</h2>
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">
                {sellers.length} total
              </span>
            </div>
            {sellers.length === 0 ? (
              <p className="text-sm text-ink-3 bg-paper border border-line rounded-lg p-6">
                No sellers onboarded yet.
              </p>
            ) : (
              <div className="bg-paper border border-line rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-background text-xs font-mono uppercase tracking-widest text-ink-3">
                    <tr>
                      <th className="text-left px-4 py-3">Slug</th>
                      <th className="text-left px-4 py-3">Name</th>
                      <th className="text-left px-4 py-3">Contact</th>
                      <th className="text-right px-4 py-3">Products</th>
                      <th className="text-right px-4 py-3">Sales</th>
                      <th className="text-left px-4 py-3">Agent ID</th>
                      <th className="text-left px-4 py-3">Created</th>
                      <th className="text-left px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--line)]">
                    {sellers.map((s) => (
                      <tr key={s.id} className="hover:bg-background">
                        <td className="px-4 py-3 font-mono text-xs">
                          <Link href={`/admin/sellers/${s.slug}`} className="text-ink underline hover:no-underline">
                            {s.slug}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{s.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-2">{s.contact_email}</td>
                        <td className="px-4 py-3 text-right font-mono">{s.product_count}</td>
                        <td className="px-4 py-3 text-right font-mono">{s.sales_count}</td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-2">{s.erc8004_agent_id ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-3">{fmtDate(s.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest rounded ${
                            s.active ? 'bg-emerald-100 text-emerald-900' : 'bg-neutral-200 text-neutral-700'
                          }`}>
                            {s.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Buyers */}
          <div>
            <div className="flex items-end justify-between mb-4">
              <h2 className="font-serif text-2xl tracking-tight">Buyers</h2>
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">
                {buyers.length} total
              </span>
            </div>
            {buyers.length === 0 ? (
              <p className="text-sm text-ink-3 bg-paper border border-line rounded-lg p-6">
                No buyers onboarded yet.
              </p>
            ) : (
              <div className="bg-paper border border-line rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-background text-xs font-mono uppercase tracking-widest text-ink-3">
                    <tr>
                      <th className="text-left px-4 py-3">Handle</th>
                      <th className="text-left px-4 py-3">Display name</th>
                      <th className="text-left px-4 py-3">Wallet</th>
                      <th className="text-right px-4 py-3">Intents</th>
                      <th className="text-left px-4 py-3">Agent ID</th>
                      <th className="text-left px-4 py-3">Created</th>
                      <th className="text-left px-4 py-3">Card</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--line)]">
                    {buyers.map((b) => (
                      <tr key={b.id} className="hover:bg-background">
                        <td className="px-4 py-3 font-mono text-xs">
                          <Link href={`/admin/buyers/${b.handle}`} className="text-ink underline hover:no-underline">
                            {b.handle}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{b.display_name ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-2" title={b.wallet_address}>
                          {truncWallet(b.wallet_address)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{b.intents_count}</td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-2">{b.erc8004_agent_id ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-ink-3">{fmtDate(b.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest rounded ${
                            b.public ? 'bg-sky-100 text-sky-900' : 'bg-neutral-200 text-neutral-700'
                          }`}>
                            {b.public ? 'Public' : 'Private'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Synthetic load tests */}
          {loadStats && loadStats.runs.length > 0 && (
            <div className="mt-16">
              <div className="flex items-end justify-between mb-4">
                <h2 className="font-serif text-2xl tracking-tight">Network load tests</h2>
                <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">
                  synthetic agents, latest {loadStats.runs.length}
                </span>
              </div>
              <div className="bg-paper border border-line rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-background text-xs font-mono uppercase tracking-widest text-ink-3">
                    <tr>
                      <th className="text-left px-4 py-3">When</th>
                      <th className="text-left px-4 py-3">Target</th>
                      <th className="text-right px-4 py-3">Agents</th>
                      <th className="text-right px-4 py-3">Conc.</th>
                      <th className="text-right px-4 py-3">Requests</th>
                      <th className="text-right px-4 py-3">Errors</th>
                      <th className="text-right px-4 py-3">p50</th>
                      <th className="text-right px-4 py-3">p95</th>
                      <th className="text-right px-4 py-3">Req/s</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--line)]">
                    {loadStats.runs.map((run) => (
                      <tr key={run.id} className="hover:bg-background">
                        <td className="px-4 py-3 font-mono text-xs text-ink-3">{fmtDate(run.started_at)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{run.target}</td>
                        <td className="px-4 py-3 text-right font-mono">{run.agent_count}</td>
                        <td className="px-4 py-3 text-right font-mono">{run.concurrency}</td>
                        <td className="px-4 py-3 text-right font-mono">{run.total_requests}</td>
                        <td className={`px-4 py-3 text-right font-mono ${run.error_count > 0 ? 'text-red-700' : 'text-ink-3'}`}>
                          {run.error_count}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{fmtMs(run.p50_ms)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmtMs(run.p95_ms)}</td>
                        <td className="px-4 py-3 text-right font-mono">
                          {run.throughput_rps == null ? 'n/a' : Number(run.throughput_rps).toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-paper border border-line rounded-lg p-4">
      <p className="text-[10px] font-mono uppercase tracking-widest text-ink-3 mb-1">{label}</p>
      <p className="text-2xl font-serif tracking-tight text-ink">{value}</p>
    </div>
  );
}
