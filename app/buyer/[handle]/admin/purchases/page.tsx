import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { getDigitalFiles, ENTITLING_STATUSES } from '@/lib/app/digital-delivery';
import { BuyerSubHeader } from '@/components/app/BuyerSubHeader';

export const dynamic = 'force-dynamic';

interface PurchaseRow {
  order_ref: string;
  status: string;
  total_usdc: number | null;
  created_at: string;
  product: { title: string; kind: string; metadata: unknown } | { title: string; kind: string; metadata: unknown }[] | null;
  seller: { name: string } | { name: string }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function BuyerPurchasesPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, owner_user_id, wallet_address, agent_wallet_address, erc8004_agent_id')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !buyer) return notFound();

  const user = await getBuyerUser();
  if (!user || user.id !== buyer.owner_user_id) return notFound();

  const buyerId = buyer.id as string;
  const wallets = [buyer.wallet_address, buyer.agent_wallet_address]
    .filter((w): w is string => typeof w === 'string' && w.length > 0)
    .map((w) => w.toLowerCase());
  const agentId = typeof buyer.erc8004_agent_id === 'string' && buyer.erc8004_agent_id.trim()
    ? buyer.erc8004_agent_id.trim() : null;

  // Match a purchase to this buyer by EITHER a registered wallet OR the buyer's
  // agent id (stamped on web orders) , so an order paid from any wallet while
  // logged in still appears, not only one paid from a registered wallet.
  const orParts: string[] = [];
  if (wallets.length) orParts.push(`buyer_wallet.in.(${wallets.join(',')})`);
  if (agentId) orParts.push(`buyer_agent_id.eq.${agentId}`);

  const rows: PurchaseRow[] = orParts.length === 0 ? [] : (((await db
    .from('app_purchases')
    .select('order_ref, status, total_usdc, created_at, product:product_id ( title, kind, metadata ), seller:seller_id ( name )')
    .or(orParts.join(','))
    .order('created_at', { ascending: false })
    .limit(200)).data ?? []) as PurchaseRow[]);

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <BuyerSubHeader handle={handle} buyerId={buyerId} />

      <section className="flex-1 px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Purchases</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">
            What you have bought
          </h1>
          <p className="text-sm text-ink-2 mb-6">
            Every order settled from your wallet. Digital items you have paid for can be downloaded here, the link is generated fresh each time and stays private to your account.
          </p>

          {rows.length === 0 ? (
            <p className="text-sm text-ink-3">
              No purchases yet. When your agent buys something, it shows up here.
            </p>
          ) : (
            <div className="bg-paper border border-line rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2.5 border-b border-line text-[10px] font-mono tracking-widest uppercase text-ink-3">
                <span>Item</span><span className="text-right">Paid</span><span className="text-right">Get it</span>
              </div>
              <ul>
                {rows.map((r) => {
                  const product = one(r.product);
                  const seller = one(r.seller);
                  const paid = ENTITLING_STATUSES.includes(r.status);
                  const isDigital = product?.kind === 'digital';
                  const hasFile = isDigital && getDigitalFiles(product?.metadata).length > 0;
                  const canDownload = paid && hasFile;
                  return (
                    <li key={r.order_ref} className="border-b border-line last:border-b-0">
                      <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 items-center">
                        <span className="min-w-0">
                          <span className="block text-sm text-ink break-words">{product?.title ?? r.order_ref}</span>
                          <span className="block text-[11px] font-mono text-ink-3 mt-0.5">
                            {seller?.name ?? 'VIA'} · {r.order_ref} · {r.status}
                          </span>
                        </span>
                        <span className="text-sm tnum text-ink text-right whitespace-nowrap">
                          {r.total_usdc === null ? '—' : `${Number(r.total_usdc).toFixed(2)} USDC`}
                        </span>
                        <span className="text-right whitespace-nowrap">
                          {canDownload ? (
                            <a
                              href={`/api/buyer/${buyerId}/purchases/${encodeURIComponent(r.order_ref)}/download`}
                              className="text-xs font-mono tracking-widest uppercase text-ink underline hover:text-ink-2"
                            >
                              Download
                            </a>
                          ) : !isDigital ? (
                            <span className="text-[11px] font-mono text-ink-3">physical</span>
                          ) : !paid ? (
                            <span className="text-[11px] font-mono text-ink-3">unpaid</span>
                          ) : (
                            <span className="text-[11px] font-mono text-ink-3">no file</span>
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <p className="text-xs text-ink-3 mt-6">
            <Link href={`/buyer/${handle}/admin`} className="underline hover:text-ink">Back to dashboard</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
