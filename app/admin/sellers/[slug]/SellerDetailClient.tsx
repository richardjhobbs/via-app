'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Seller {
  id:                    string;
  slug:                  string;
  name:                  string;
  kind:                  string;
  headline:              string | null;
  description:           string | null;
  contact_email:         string;
  website_url:           string | null;
  wallet_address:        string;
  agent_wallet_address:  string | null;
  erc8004_seller_id:     string | null;
  erc8004_agent_id:      string | null;
  shopify_domain:        string | null;
  active:                boolean;
}

interface Memory {
  id:         string;
  type:       string;
  title:      string;
  body:       string;
  tags:       string[];
  active:     boolean;
  created_at: string;
}

interface Interaction {
  id:             string;
  tool_name:      string;
  agent_identity: Record<string, unknown>;
  status_code:    number | null;
  duration_ms:    number | null;
  created_at:     string;
}

interface Purchase {
  id:         string;
  order_ref:  string;
  total_usdc: number;
  status:     string;
  created_at: string;
}

interface Props {
  seller:       Seller;
  memories:     Memory[];
  interactions: Interaction[];
  purchases:    Purchase[];
  productCount: number;
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

function truncWallet(w: string | null | undefined): string {
  if (!w) return '—';
  return w.length <= 14 ? w : `${w.slice(0, 8)}…${w.slice(-4)}`;
}

export function SellerDetailClient({ seller, memories, interactions, purchases, productCount }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [info, setInfo]       = useState('');
  const [form, setForm]       = useState({
    name:           seller.name,
    headline:       seller.headline ?? '',
    description:    seller.description ?? '',
    website_url:    seller.website_url ?? '',
    wallet_address: seller.wallet_address,
    contact_email:  seller.contact_email,
  });

  async function save() {
    setErr(''); setInfo(''); setBusy(true);
    try {
      const res = await fetch(`/api/admin/sellers/${seller.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Save failed (${res.status})`);
        return;
      }
      setInfo('Saved.');
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!confirm(seller.active
      ? `Deactivate ${seller.name}? Their MCP and dashboard will stop working.`
      : `Reactivate ${seller.name}?`)) return;
    setErr(''); setInfo(''); setBusy(true);
    try {
      const res = await fetch(`/api/admin/sellers/${seller.id}/deactivate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ active: !seller.active }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function resetMemories() {
    if (!confirm(`Wipe ALL ${memories.length} memories for ${seller.name}? Their Sales Agent will lose every fact it has been trained on. This cannot be undone.`)) return;
    setErr(''); setInfo(''); setBusy(true);
    try {
      const res = await fetch(`/api/admin/sellers/${seller.id}/reset-memories`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Failed (${res.status})`);
        return;
      }
      setInfo(`Wiped ${json.deleted} memor${json.deleted === 1 ? 'y' : 'ies'}.`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  const memoriesCount     = memories.length;
  const interactionsCount = interactions.length;
  const purchasesCount    = purchases.length;

  return (
    <div className="space-y-10">
      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-block px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest rounded ${
          seller.active ? 'bg-emerald-100 text-emerald-900' : 'bg-neutral-200 text-neutral-700'
        }`}>
          {seller.active ? 'Active' : 'Inactive'}
        </span>
        <Link
          href={`/seller/${seller.slug}/admin`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono uppercase tracking-widest text-neutral-700 underline hover:no-underline"
        >
          Seller dashboard &nearr;
        </Link>
        <Link
          href={`/admin/sellers/${seller.slug}/sales-agent`}
          className="text-[10px] font-mono uppercase tracking-widest text-neutral-700 underline hover:no-underline"
        >
          Drive Sales Agent &rarr;
        </Link>
        <span className="ml-auto text-[10px] font-mono uppercase tracking-widest text-neutral-400">
          {productCount} products · {memoriesCount} memories · {purchasesCount} purchases
        </span>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md px-4 py-3">{err}</div>
      )}
      {info && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md px-4 py-3">{info}</div>
      )}

      {/* Details */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <h2 className="font-serif text-2xl tracking-tight">Details</h2>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] font-mono uppercase tracking-widest text-neutral-700 underline hover:no-underline"
            >
              Force edit
            </button>
          )}
        </div>
        {editing ? (
          <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-4">
            <Field label="Name">
              <input className="w-full bg-white border border-neutral-300 rounded-md px-3 py-2 text-sm"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Contact email">
              <input type="email" className="w-full bg-white border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono"
                value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            </Field>
            <Field label="Headline">
              <input className="w-full bg-white border border-neutral-300 rounded-md px-3 py-2 text-sm"
                value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
            </Field>
            <Field label="Description">
              <textarea rows={3} className="w-full bg-white border border-neutral-300 rounded-md px-3 py-2 text-sm"
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Website">
              <input className="w-full bg-white border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono"
                value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} />
            </Field>
            <Field label="Payout wallet">
              <input className="w-full bg-white border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono"
                value={form.wallet_address} onChange={(e) => setForm({ ...form, wallet_address: e.target.value })} />
            </Field>
            <div className="flex gap-3 pt-2">
              <button
                type="button" onClick={() => void save()} disabled={busy}
                className="px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button" onClick={() => { setEditing(false); setErr(''); }}
                className="px-5 py-3 bg-white border border-neutral-300 text-neutral-700 text-xs font-mono tracking-widest uppercase hover:border-neutral-900 transition-colors rounded-md"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-lg p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            <Stat label="Contact"           value={seller.contact_email} mono />
            <Stat label="Website"           value={seller.website_url ?? '—'} mono />
            <Stat label="Headline"          value={seller.headline ?? '—'} />
            <Stat label="Kind"              value={seller.kind} />
            <Stat label="Payout wallet"     value={seller.wallet_address} mono />
            <Stat label="Agent wallet"      value={seller.agent_wallet_address ?? '—'} mono />
            <Stat label="ERC-8004 seller"   value={seller.erc8004_seller_id ?? '—'} mono />
            <Stat label="ERC-8004 agent"    value={seller.erc8004_agent_id ?? '—'} mono />
            <Stat label="Shopify domain"    value={seller.shopify_domain ?? '—'} mono />
            <div className="md:col-span-2">
              <div className="text-xs font-mono tracking-widest text-neutral-500 uppercase mb-1">Description</div>
              <div className="text-sm text-neutral-900">{seller.description ?? '—'}</div>
            </div>
          </div>
        )}
      </section>

      {/* Memories */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <h2 className="font-serif text-2xl tracking-tight">Sales Agent memories</h2>
          <button
            type="button" onClick={() => void resetMemories()} disabled={busy || memoriesCount === 0}
            className="text-[10px] font-mono uppercase tracking-widest text-red-700 underline hover:no-underline disabled:opacity-50 disabled:no-underline"
          >
            Reset all memories
          </button>
        </div>
        {memoriesCount === 0 ? (
          <p className="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-lg p-6">
            No memories stored.
          </p>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs font-mono uppercase tracking-widest text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Title</th>
                  <th className="text-left px-4 py-3">Body</th>
                  <th className="text-left px-4 py-3">Tags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {memories.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500 whitespace-nowrap">{fmtDate(m.created_at)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{m.type}</td>
                    <td className="px-4 py-3">{m.title}</td>
                    <td className="px-4 py-3 text-neutral-600 text-xs">{m.body.slice(0, 160)}{m.body.length > 160 ? '…' : ''}</td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">{m.tags.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MCP interactions */}
      <section>
        <h2 className="font-serif text-2xl tracking-tight mb-4">Recent MCP interactions</h2>
        {interactionsCount === 0 ? (
          <p className="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-lg p-6">
            No buying agent has called this seller&apos;s MCP yet.
          </p>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs font-mono uppercase tracking-widest text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-left px-4 py-3">Tool</th>
                  <th className="text-left px-4 py-3">Agent</th>
                  <th className="text-right px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">ms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {interactions.map((i) => {
                  const ident = i.agent_identity ?? {};
                  const agentLabel =
                    (ident.agent_id as string | undefined) ??
                    (ident.name as string | undefined) ??
                    (ident.wallet as string | undefined) ??
                    'anonymous';
                  return (
                    <tr key={i.id}>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-500 whitespace-nowrap">{fmtDate(i.created_at)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{i.tool_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-700">{agentLabel}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{i.status_code ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-neutral-500">{i.duration_ms ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Purchases preview */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <h2 className="font-serif text-2xl tracking-tight">Recent purchases</h2>
          <Link
            href={`/seller/${seller.slug}/admin/sales`}
            className="text-[10px] font-mono uppercase tracking-widest text-neutral-700 underline hover:no-underline"
            target="_blank" rel="noopener noreferrer"
          >
            Full ledger &nearr;
          </Link>
        </div>
        {purchasesCount === 0 ? (
          <p className="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-lg p-6">
            No purchases yet.
          </p>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs font-mono uppercase tracking-widest text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-3">Order</th>
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-right px-4 py-3">USDC</th>
                  <th className="text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        href={`/admin/orders/${p.order_ref}`}
                        className="text-neutral-900 underline hover:no-underline"
                      >
                        {p.order_ref}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500 whitespace-nowrap">{fmtDate(p.created_at)}</td>
                    <td className="px-4 py-3 text-right font-mono">{p.total_usdc.toFixed(2)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Danger zone */}
      <section>
        <h2 className="font-serif text-2xl tracking-tight mb-4">Danger zone</h2>
        <div className="bg-white border border-red-200 rounded-lg p-6 flex items-center justify-between gap-6">
          <div>
            <p className="font-medium text-neutral-900 mb-1">
              {seller.active ? 'Deactivate this seller' : 'Reactivate this seller'}
            </p>
            <p className="text-xs text-neutral-600">
              {seller.active
                ? `Sets active=false. Their per-seller MCP and dashboard immediately stop serving. Payout wallet ${truncWallet(seller.wallet_address)} is unaffected.`
                : 'Sets active=true. MCP and dashboard come back online.'}
            </p>
          </div>
          <button
            type="button" onClick={() => void toggleActive()} disabled={busy}
            className={`shrink-0 px-5 py-3 text-xs font-mono tracking-widest uppercase rounded-md disabled:opacity-50 ${
              seller.active
                ? 'bg-red-700 text-neutral-50 hover:bg-red-800'
                : 'bg-emerald-700 text-neutral-50 hover:bg-emerald-800'
            }`}
          >
            {seller.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </section>
    </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-mono tracking-widest text-neutral-500 uppercase mb-2">{label}</div>
      {children}
    </div>
  );
}
