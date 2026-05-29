import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { db } from '@/lib/app/db';
import { isAdminFromCookies } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

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
    .select('id, slug, name, kind, contact_email, wallet_address, erc8004_agent_id, active, created_at')
    .order('created_at', { ascending: false });
  if (error || !sellers) return [];

  const ids = sellers.map((s) => s.id as string);
  if (ids.length === 0) return [];

  const [{ data: products }, { data: purchases }] = await Promise.all([
    db.from('app_seller_products').select('seller_id').in('seller_id', ids),
    db.from('app_purchases').select('seller_id').in('seller_id', ids),
  ]);

  const pCount = new Map<string, number>();
  for (const r of products ?? []) {
    const k = r.seller_id as string;
    pCount.set(k, (pCount.get(k) ?? 0) + 1);
  }
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
    product_count:    pCount.get(s.id as string) ?? 0,
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

function truncWallet(w: string | null | undefined): string {
  if (!w) return '—';
  return w.length <= 14 ? w : `${w.slice(0, 8)}…${w.slice(-4)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export default async function AdminLandingPage() {
  if (!(await isAdminFromCookies())) {
    redirect('/admin/login?next=/admin');
  }

  const [sellers, buyers] = await Promise.all([loadSellers(), loadBuyers()]);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center gap-3">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">Superadmin</span>
          </Link>
          <form action="/api/admin/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Admin</p>
          <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-8">Overview</h1>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12">
            <StatCard label="Sellers"            value={String(sellers.length)} />
            <StatCard label="Active sellers"     value={String(sellers.filter((s) => s.active).length)} />
            <StatCard label="Buyers"             value={String(buyers.length)} />
            <StatCard label="Public buyer cards" value={String(buyers.filter((b) => b.public).length)} />
          </div>

          {/* Sellers */}
          <div className="mb-16">
            <div className="flex items-end justify-between mb-4">
              <h2 className="font-serif text-2xl tracking-tight">Sellers</h2>
              <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                {sellers.length} total
              </span>
            </div>
            {sellers.length === 0 ? (
              <p className="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-lg p-6">
                No sellers onboarded yet.
              </p>
            ) : (
              <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-xs font-mono uppercase tracking-widest text-neutral-500">
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
                  <tbody className="divide-y divide-neutral-200">
                    {sellers.map((s) => (
                      <tr key={s.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-mono text-xs">
                          <Link href={`/admin/sellers/${s.slug}`} className="text-neutral-900 underline hover:no-underline">
                            {s.slug}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{s.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-neutral-700">{s.contact_email}</td>
                        <td className="px-4 py-3 text-right font-mono">{s.product_count}</td>
                        <td className="px-4 py-3 text-right font-mono">{s.sales_count}</td>
                        <td className="px-4 py-3 font-mono text-xs text-neutral-700">{s.erc8004_agent_id ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-neutral-500">{fmtDate(s.created_at)}</td>
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
              <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                {buyers.length} total
              </span>
            </div>
            {buyers.length === 0 ? (
              <p className="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-lg p-6">
                No buyers onboarded yet.
              </p>
            ) : (
              <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-xs font-mono uppercase tracking-widest text-neutral-500">
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
                  <tbody className="divide-y divide-neutral-200">
                    {buyers.map((b) => (
                      <tr key={b.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-mono text-xs">
                          <Link href={`/admin/buyers/${b.handle}`} className="text-neutral-900 underline hover:no-underline">
                            {b.handle}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{b.display_name ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-neutral-700" title={b.wallet_address}>
                          {truncWallet(b.wallet_address)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{b.intents_count}</td>
                        <td className="px-4 py-3 font-mono text-xs text-neutral-700">{b.erc8004_agent_id ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-neutral-500">{fmtDate(b.created_at)}</td>
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
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4">
      <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-1">{label}</p>
      <p className="text-2xl font-serif tracking-tight text-neutral-900">{value}</p>
    </div>
  );
}
