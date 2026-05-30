'use client';

import { useState } from 'react';

export interface DeliveryAddress {
  name:          string;
  address_line1: string;
  address_line2: string | null;
  city:          string;
  region:        string | null;
  postcode:      string;
  country:       string;
  phone:         string;
}

export interface OrderDistribution {
  seller_usdc:    number;
  platform_usdc:  number;
  status:         string;
  seller_tx_hash: string | null;
}

export interface OrderDetail {
  order_ref:        string;
  status:           'pending' | 'paid' | 'minted' | 'paid_out' | 'failed';
  created_at:       string;
  updated_at:       string;
  qty:              number;
  total_usdc:       number;
  payment_method:   string;
  buyer_wallet:     string;
  buyer_agent_id:   string | null;
  mint_tx_hash:     string | null;
  payout_tx_hash:   string | null;
  notes:            string | null;
  delivery_address: DeliveryAddress | null;
  product: {
    title:    string;
    kind:     string;
    token_id: number | null;
  };
  seller: {
    slug:           string;
    name:           string;
    contact_email:  string;
  };
  distribution: OrderDistribution | null;
}

const BASESCAN = 'https://basescan.org/tx/';

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function fmtUsdc(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function addressLines(a: DeliveryAddress): string[] {
  return [
    a.name,
    a.address_line1,
    a.address_line2 ?? '',
    [a.city, a.region].filter(Boolean).join(', '),
    a.postcode,
    a.country,
    `Tel: ${a.phone}`,
  ].filter((l) => l.trim().length > 0);
}

function asTxt(o: OrderDetail): string {
  const lines: string[] = [];
  lines.push(`Order ${o.order_ref}`);
  lines.push(`Seller:   ${o.seller.name} (${o.seller.slug})`);
  lines.push(`Product:  ${o.qty}× ${o.product.title} [${o.product.kind}]${o.product.token_id != null ? `, token #${o.product.token_id}` : ''}`);
  lines.push(`Total:    ${fmtUsdc(o.total_usdc)} USDC`);
  lines.push(`Status:   ${o.status}`);
  lines.push(`Placed:   ${fmtDate(o.created_at)}`);
  lines.push(`Buyer:    ${o.buyer_wallet}${o.buyer_agent_id ? ` (agent ${o.buyer_agent_id})` : ''}`);
  if (o.delivery_address) {
    lines.push('');
    lines.push('Ship to:');
    for (const l of addressLines(o.delivery_address)) lines.push(`  ${l}`);
  }
  if (o.mint_tx_hash)   lines.push(`Mint tx:   ${o.mint_tx_hash}`);
  if (o.payout_tx_hash) lines.push(`Payout tx: ${o.payout_tx_hash}`);
  return lines.join('\n');
}

function asMd(o: OrderDetail): string {
  const out: string[] = [];
  out.push(`# Order ${o.order_ref}`);
  out.push('');
  out.push(`- **Seller**: ${o.seller.name} (\`${o.seller.slug}\`)`);
  out.push(`- **Product**: ${o.qty}× ${o.product.title} \`${o.product.kind}\`${o.product.token_id != null ? `, token #${o.product.token_id}` : ''}`);
  out.push(`- **Total**: ${fmtUsdc(o.total_usdc)} USDC`);
  out.push(`- **Status**: \`${o.status}\``);
  out.push(`- **Placed**: ${fmtDate(o.created_at)}`);
  out.push(`- **Buyer wallet**: \`${o.buyer_wallet}\``);
  if (o.buyer_agent_id) out.push(`- **Buyer agent (ERC-8004)**: \`${o.buyer_agent_id}\``);
  if (o.delivery_address) {
    out.push('');
    out.push('## Ship to');
    out.push('');
    out.push('```');
    for (const l of addressLines(o.delivery_address)) out.push(l);
    out.push('```');
  }
  if (o.mint_tx_hash || o.payout_tx_hash) {
    out.push('');
    out.push('## On-chain');
    if (o.mint_tx_hash)   out.push(`- mint:   [${o.mint_tx_hash.slice(0, 14)}…](${BASESCAN}${o.mint_tx_hash})`);
    if (o.payout_tx_hash) out.push(`- payout: [${o.payout_tx_hash.slice(0, 14)}…](${BASESCAN}${o.payout_tx_hash})`);
  }
  return out.join('\n');
}

function asCsv(o: OrderDetail): string {
  const a = o.delivery_address;
  const cols = [
    'order_ref','status','placed_utc','seller_slug','product_title','qty','total_usdc',
    'buyer_wallet','buyer_agent_id',
    'ship_name','ship_address1','ship_address2','ship_city','ship_region','ship_postcode','ship_country','ship_phone',
    'mint_tx','payout_tx',
  ];
  const row = [
    o.order_ref, o.status, fmtDate(o.created_at), o.seller.slug, o.product.title, String(o.qty), fmtUsdc(o.total_usdc),
    o.buyer_wallet, o.buyer_agent_id ?? '',
    a?.name ?? '', a?.address_line1 ?? '', a?.address_line2 ?? '', a?.city ?? '', a?.region ?? '', a?.postcode ?? '', a?.country ?? '', a?.phone ?? '',
    o.mint_tx_hash ?? '', o.payout_tx_hash ?? '',
  ];
  const csvEscape = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return `${cols.join(',')}\n${row.map(csvEscape).join(',')}`;
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function StatusBadge({ s }: { s: OrderDetail['status'] }) {
  const map = {
    pending:  'bg-paper text-ink-2',
    paid:     'bg-[color:var(--accent)]/15 text-[color:var(--accent)]',
    minted:   'bg-[color:var(--warning)]/15 text-[color:var(--warning)]',
    paid_out: 'bg-[color:var(--live)]/15 text-[color:var(--live)]',
    failed:   'bg-[color:var(--danger)]/15 text-[color:var(--danger)]',
  } as const;
  return (
    <span className={`inline-block px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest rounded ${map[s] ?? 'bg-paper'}`}>
      {s.replace('_', ' ')}
    </span>
  );
}

export function OrderDetailView({ order }: { order: OrderDetail }) {
  const [toast, setToast] = useState('');

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  }

  const distro = order.distribution;
  const sellerUsdc   = distro ? distro.seller_usdc   : null;
  const platformUsdc = distro ? distro.platform_usdc : null;

  return (
    <div className="space-y-10">
      {/* Order ref strip */}
      <div className="bg-paper border border-line rounded-lg p-6 flex flex-wrap items-center gap-6 justify-between">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-ink-3 mb-2">Order ref</p>
          <p className="font-mono text-2xl tracking-tight text-ink">{order.order_ref}</p>
          <p className="text-[10px] font-mono uppercase tracking-widest text-ink-3 mt-1">
            Placed {fmtDate(order.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge s={order.status} />
          <button
            type="button"
            onClick={async () => { const ok = await copyToClipboard(order.order_ref); flash(ok ? 'Order ref copied.' : 'Copy failed.'); }}
            className="text-[10px] font-mono uppercase tracking-widest text-ink-2 underline hover:no-underline"
          >
            Copy ref
          </button>
        </div>
      </div>

      {toast && (
        <div className="bg-[color:var(--live)]/10 border border-[color:var(--live)] text-[color:var(--live)] text-sm rounded-md px-4 py-3">{toast}</div>
      )}

      {/* Lines */}
      <section className="bg-paper border border-line rounded-lg p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
        <Stat label="Product" value={`${order.qty}× ${order.product.title}`} />
        <Stat label="Kind"    value={order.product.kind} />
        <Stat label="Token"   value={order.product.token_id != null ? `#${order.product.token_id}` : '-'} mono />
        <Stat label="Total"   value={`${fmtUsdc(order.total_usdc)} USDC`} mono />
        <Stat label="Payment" value={order.payment_method} mono />
        <Stat label="Buyer wallet"   value={order.buyer_wallet} mono />
        {order.buyer_agent_id && <Stat label="Buyer agent (ERC-8004)" value={order.buyer_agent_id} mono />}
        {distro && <Stat label="Seller share"   value={`${fmtUsdc(sellerUsdc)} USDC`} mono />}
        {distro && <Stat label="Platform share" value={`${fmtUsdc(platformUsdc)} USDC`} mono />}
        {order.notes && (
          <div className="md:col-span-2">
            <div className="text-xs font-mono tracking-widest text-ink-3 uppercase mb-1">Notes</div>
            <div className="text-sm text-ink-2">{order.notes}</div>
          </div>
        )}
      </section>

      {/* Delivery */}
      {order.delivery_address ? (
        <section className="bg-paper border border-line rounded-lg p-6">
          <div className="flex items-end justify-between mb-3">
            <h2 className="font-serif text-2xl tracking-tight">Ship to</h2>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={async () => { const ok = await copyToClipboard(addressLines(order.delivery_address!).join('\n')); flash(ok ? 'Address copied.' : 'Copy failed.'); }}
                className="text-[10px] font-mono uppercase tracking-widest text-ink-2 underline hover:no-underline"
              >
                Copy address
              </button>
              <button
                type="button"
                onClick={async () => { const ok = await copyToClipboard(asCsv(order)); flash(ok ? 'CSV row copied.' : 'Copy failed.'); }}
                className="text-[10px] font-mono uppercase tracking-widest text-ink-2 underline hover:no-underline"
              >
                Copy CSV row
              </button>
              <button
                type="button"
                onClick={() => download(`${order.order_ref}.txt`, asTxt(order), 'text/plain;charset=utf-8')}
                className="text-[10px] font-mono uppercase tracking-widest text-ink-2 underline hover:no-underline"
              >
                Download .txt
              </button>
              <button
                type="button"
                onClick={() => download(`${order.order_ref}.md`, asMd(order), 'text/markdown;charset=utf-8')}
                className="text-[10px] font-mono uppercase tracking-widest text-ink-2 underline hover:no-underline"
              >
                Download .md
              </button>
            </div>
          </div>
          <pre className="font-mono text-sm text-ink bg-paper border border-line rounded-md p-4 whitespace-pre-wrap leading-relaxed">
{addressLines(order.delivery_address).join('\n')}
          </pre>
        </section>
      ) : (
        <section className="bg-paper border border-line rounded-lg p-6">
          <h2 className="font-serif text-2xl tracking-tight mb-2">No physical shipment</h2>
          <p className="text-sm text-ink-2">
            This is a {order.product.kind} order. No delivery address is required.
          </p>
        </section>
      )}

      {/* On-chain */}
      {(order.mint_tx_hash || order.payout_tx_hash || distro?.seller_tx_hash) && (
        <section className="bg-paper border border-line rounded-lg p-6">
          <h2 className="font-serif text-2xl tracking-tight mb-4">On-chain</h2>
          <ul className="space-y-2 text-sm">
            {order.mint_tx_hash && (
              <li>
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink-3 mr-2">mint</span>
                <a href={`${BASESCAN}${order.mint_tx_hash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-ink underline hover:no-underline">
                  {order.mint_tx_hash.slice(0, 14)}…{order.mint_tx_hash.slice(-6)} &nearr;
                </a>
              </li>
            )}
            {order.payout_tx_hash && (
              <li>
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink-3 mr-2">payout</span>
                <a href={`${BASESCAN}${order.payout_tx_hash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-ink underline hover:no-underline">
                  {order.payout_tx_hash.slice(0, 14)}…{order.payout_tx_hash.slice(-6)} &nearr;
                </a>
              </li>
            )}
            {distro?.seller_tx_hash && (
              <li>
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink-3 mr-2">seller tx</span>
                <a href={`${BASESCAN}${distro.seller_tx_hash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-ink underline hover:no-underline">
                  {distro.seller_tx_hash.slice(0, 14)}…{distro.seller_tx_hash.slice(-6)} &nearr;
                </a>
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-mono tracking-widest text-ink-3 uppercase mb-1">{label}</div>
      <div className={`text-sm text-ink ${mono ? 'font-mono break-all' : ''}`}>{value}</div>
    </div>
  );
}
