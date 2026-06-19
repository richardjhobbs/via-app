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
  login_email:           string | null;
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

interface Product {
  id:                   string;
  title:                string;
  kind:                 string;
  price_minor:          number;
  currency:             string;
  stock:                number | null;
  token_id:             number | null;
  on_chain_status:      string;
  active:               boolean;
  admin_removed:        boolean;
  admin_removed_reason: string | null;
  image_url:            string | null;
}

interface Props {
  seller:       Seller;
  memories:     Memory[];
  interactions: Interaction[];
  purchases:    Purchase[];
  products:     Product[];
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

function truncWallet(w: string | null | undefined): string {
  if (!w) return '—';
  return w.length <= 14 ? w : `${w.slice(0, 8)}…${w.slice(-4)}`;
}

export function SellerDetailClient({ seller, memories, interactions, purchases, products }: Props) {
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

  // Login email is intentionally separate from the rest of the form.
  // Saving it hits a different endpoint (Supabase auth admin API) so
  // partial failures don't muddle the regular edit save.
  const [loginEmailInput, setLoginEmailInput] = useState(seller.login_email ?? '');
  const [loginBusy,       setLoginBusy]       = useState(false);
  const [loginErr,        setLoginErr]        = useState('');
  const [loginInfo,       setLoginInfo]       = useState('');

  async function saveLoginEmail() {
    const next = loginEmailInput.trim().toLowerCase();
    if (next === (seller.login_email ?? '').toLowerCase()) {
      setLoginInfo('No change.');
      return;
    }
    if (!confirm(`Change ${seller.name}'s login email to ${next}? They will sign in with this address next time.`)) return;
    setLoginErr(''); setLoginInfo(''); setLoginBusy(true);
    try {
      const res = await fetch(`/api/admin/sellers/${seller.id}/login-email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: next }),
      });
      const json = await res.json();
      if (!res.ok) {
        setLoginErr(json.error || `Save failed (${res.status})`);
        return;
      }
      setLoginInfo(`Login email updated to ${json.login_email}.`);
      router.refresh();
    } catch (e) {
      setLoginErr(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoginBusy(false);
    }
  }

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

  async function mintIdentity() {
    if (!confirm(`Mint the ERC-8004 identity for ${seller.name}? This calls the VIA registrar.`)) return;
    setErr(''); setInfo(''); setBusy(true);
    try {
      const res = await fetch(`/api/admin/sellers/${seller.id}/mint-identity`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Mint failed (${res.status})`);
        return;
      }
      setInfo(json.already ? `Already minted: agent ${json.erc8004_agent_id}.` : `Minted ERC-8004 agent ${json.erc8004_agent_id}.`);
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

  async function moderateProduct(productId: string, title: string, action: 'cancel' | 'restore' | 'delete') {
    const prompts: Record<typeof action, string> = {
      cancel:  `Cancel "${title}"? It leaves the marketplace immediately and cannot be bought. Order history is kept and you can restore it later.`,
      restore: `Restore "${title}" to the marketplace?`,
      delete:  `Permanently delete "${title}"? This cannot be undone. (Blocked if it has any sales.)`,
    };
    if (!confirm(prompts[action])) return;
    let reason: string | undefined;
    if (action === 'cancel') {
      reason = window.prompt('Reason (optional, shown in the admin record):')?.trim() || undefined;
    }
    setErr(''); setInfo(''); setBusy(true);
    try {
      const res = await fetch(`/api/admin/sellers/${seller.id}/products/${productId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Failed (${res.status})`);
        return;
      }
      setInfo(action === 'delete' ? `Deleted "${title}".` : action === 'cancel' ? `Cancelled "${title}".` : `Restored "${title}".`);
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
  const productCount      = products.length;

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
          href={`/sellers/${seller.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono uppercase tracking-widest text-neutral-700 underline hover:no-underline"
        >
          View public store ↗
        </Link>
        <Link
          href={`/admin/sellers/${seller.slug}/sales-agent`}
          className="text-[10px] font-mono uppercase tracking-widest text-neutral-700 underline hover:no-underline"
        >
          Drive Sales Agent &rarr;
        </Link>
        {!seller.erc8004_agent_id && (
          <button
            type="button" disabled={busy} onClick={() => void mintIdentity()}
            className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest rounded bg-amber-100 text-amber-900 hover:bg-amber-200 disabled:opacity-50"
          >
            Mint ERC-8004 identity
          </button>
        )}
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
            <Field label="Contact email (display only)">
              <input type="email" className="w-full bg-white border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono"
                value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
              <p className="text-[10px] font-mono text-neutral-500 mt-1">
                For follow-ups. Does NOT change the seller&apos;s sign-in email.
              </p>
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
            <Stat label="Contact email"     value={seller.contact_email} mono />
            <Stat label="Login email"       value={seller.login_email ?? '(unavailable)'} mono />
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

      {/* Login email — distinct from the Force-edit panel because it
          hits Supabase auth.admin.updateUserById, not the row PATCH. */}
      <section>
        <h2 className="font-serif text-2xl tracking-tight mb-4">Login email</h2>
        <div className="bg-white border border-neutral-200 rounded-lg p-6">
          <p className="text-xs text-neutral-600 mb-4">
            The address the seller signs in with. Distinct from the contact email above. Changing
            it overwrites the Supabase auth user and confirms it immediately — no verification mail
            is sent.
          </p>
          {loginErr  && <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md px-4 py-3 mb-4">{loginErr}</div>}
          {loginInfo && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md px-4 py-3 mb-4">{loginInfo}</div>}
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <label htmlFor="login-email" className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-2">
                Login email
              </label>
              <input
                id="login-email"
                type="email"
                value={loginEmailInput}
                onChange={(e) => setLoginEmailInput(e.target.value)}
                placeholder={seller.login_email ?? 'unavailable'}
                disabled={seller.login_email === null}
                className="w-full bg-white border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono disabled:bg-neutral-50 disabled:text-neutral-400"
              />
            </div>
            <button
              type="button" onClick={() => void saveLoginEmail()} disabled={loginBusy || seller.login_email === null}
              className="px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md disabled:opacity-50"
            >
              {loginBusy ? 'Saving…' : 'Update login email'}
            </button>
          </div>
          {seller.login_email === null && (
            <p className="text-[10px] font-mono text-amber-700 mt-3">
              Auth user lookup failed — the Supabase admin API did not return an email for this
              seller&apos;s owner_user_id. Editing is disabled until the lookup succeeds.
            </p>
          )}
        </div>
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
                  const viaId = ident.via_agent_id;
                  const ip    = ident.ip as string | null | undefined;
                  const agentLabel = (viaId !== null && viaId !== undefined && viaId !== '')
                    ? `agent #${viaId}`
                    : (ip || 'anonymous');
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
            Full ledger ↗
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

      {/* Products — superadmin moderation */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <h2 className="font-serif text-2xl tracking-tight">Products</h2>
          <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">{productCount} total</span>
        </div>
        {productCount === 0 ? (
          <p className="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-lg p-6">
            No products yet.
          </p>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs font-mono uppercase tracking-widest text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-3">Image</th>
                  <th className="text-left px-4 py-3">Title</th>
                  <th className="text-left px-4 py-3">Kind</th>
                  <th className="text-right px-4 py-3">Price</th>
                  <th className="text-left px-4 py-3">State</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {products.map((p) => (
                  <tr key={p.id} className={p.admin_removed ? 'bg-red-50' : undefined}>
                    <td className="px-4 py-3">
                      {p.image_url ? (
                        <a href={p.image_url} target="_blank" rel="noopener noreferrer" title="Open full image">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.image_url}
                            alt={p.title}
                            className="h-14 w-14 object-cover rounded border border-neutral-200 bg-neutral-100"
                          />
                        </a>
                      ) : (
                        <span className="inline-flex h-14 w-14 items-center justify-center rounded border border-dashed border-neutral-300 text-[9px] font-mono uppercase tracking-widest text-neutral-400">
                          No image
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-neutral-900">{p.title}</span>
                      {p.admin_removed && p.admin_removed_reason && (
                        <span className="block text-[10px] font-mono text-red-700 mt-0.5">{p.admin_removed_reason}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-600">{p.kind}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{(p.price_minor / 1_000_000).toFixed(2)} {p.currency}</td>
                    <td className="px-4 py-3">
                      {p.admin_removed ? (
                        <span className="inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest rounded bg-red-100 text-red-900">Cancelled</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest rounded bg-neutral-100 text-neutral-700">
                          {p.on_chain_status === 'registered' && p.active ? 'Live' : p.on_chain_status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {p.admin_removed ? (
                        <button
                          type="button" disabled={busy} onClick={() => void moderateProduct(p.id, p.title, 'restore')}
                          className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 underline hover:no-underline disabled:opacity-50"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button" disabled={busy} onClick={() => void moderateProduct(p.id, p.title, 'cancel')}
                          className="text-[10px] font-mono uppercase tracking-widest text-red-700 underline hover:no-underline disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="button" disabled={busy} onClick={() => void moderateProduct(p.id, p.title, 'delete')}
                        className="ml-4 text-[10px] font-mono uppercase tracking-widest text-neutral-500 underline hover:no-underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </td>
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
