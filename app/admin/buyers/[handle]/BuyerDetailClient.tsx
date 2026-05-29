'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Buyer {
  id:                string;
  handle:            string;
  display_name:      string | null;
  wallet_address:    string;
  erc8004_agent_id:  string | null;
  public:            boolean;
  delegation_caps:   Record<string, unknown>;
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

interface Intent {
  id:           string;
  intent_text:  string;
  status:       string;
  broadcast_at: string | null;
  resolved_at:  string | null;
  created_at:   string;
}

interface Interaction {
  id:             string;
  tool_name:      string;
  agent_identity: Record<string, unknown>;
  status_code:    number | null;
  duration_ms:    number | null;
  created_at:     string;
}

interface Props {
  buyer:        Buyer;
  memories:     Memory[];
  intents:      Intent[];
  interactions: Interaction[];
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

function truncWallet(w: string): string {
  return w.length <= 14 ? w : `${w.slice(0, 8)}…${w.slice(-4)}`;
}

export function BuyerDetailClient({ buyer, memories, intents, interactions }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [info, setInfo] = useState('');

  async function resetMemories() {
    if (!confirm(`Wipe ALL ${memories.length} memories for @${buyer.handle}? Their Buying Agent will lose every preference it has been trained on.`)) return;
    setErr(''); setInfo(''); setBusy(true);
    try {
      const res = await fetch(`/api/admin/buyers/${buyer.id}/reset-memories`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      setInfo(`Wiped ${json.deleted} memor${json.deleted === 1 ? 'y' : 'ies'}.`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally { setBusy(false); }
  }

  async function togglePublic() {
    if (!confirm(buyer.public
      ? `Make @${buyer.handle}'s buyer card private? Their per-buyer MCP will stop serving seller agents.`
      : `Publish @${buyer.handle}'s buyer card? Seller agents will be able to pitch them.`)) return;
    setErr(''); setInfo(''); setBusy(true);
    try {
      const res = await fetch(`/api/admin/buyers/${buyer.id}/public`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ public: !buyer.public }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-10">
      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-block px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest rounded ${
          buyer.public ? 'bg-sky-100 text-sky-900' : 'bg-neutral-200 text-neutral-700'
        }`}>
          {buyer.public ? 'Public card' : 'Private'}
        </span>
        <span className="ml-auto text-[10px] font-mono uppercase tracking-widest text-neutral-400">
          {memories.length} memories · {intents.length} intents · {interactions.length} interactions
        </span>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md px-4 py-3">{err}</div>}
      {info && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md px-4 py-3">{info}</div>}

      {/* Details */}
      <section>
        <h2 className="font-serif text-2xl tracking-tight mb-4">Details</h2>
        <div className="bg-white border border-neutral-200 rounded-lg p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Stat label="Handle"           value={`@${buyer.handle}`} mono />
          <Stat label="Display name"     value={buyer.display_name ?? '(none)'} />
          <Stat label="Funding wallet"   value={buyer.wallet_address} mono />
          <Stat label="ERC-8004 agent"   value={buyer.erc8004_agent_id ?? '(none)'} mono />
          <Stat label="Card visibility"  value={buyer.public ? 'Public' : 'Private'} />
          <div className="md:col-span-2">
            <div className="text-xs font-mono tracking-widest text-neutral-500 uppercase mb-1">Delegation caps</div>
            <pre className="text-xs font-mono text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-md p-3 overflow-auto">
              {Object.keys(buyer.delegation_caps).length === 0
                ? '(none configured)'
                : JSON.stringify(buyer.delegation_caps, null, 2)}
            </pre>
          </div>
        </div>
      </section>

      {/* Memories */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <h2 className="font-serif text-2xl tracking-tight">Buying Agent memories</h2>
          <button
            type="button" onClick={() => void resetMemories()} disabled={busy || memories.length === 0}
            className="text-[10px] font-mono uppercase tracking-widest text-red-700 underline hover:no-underline disabled:opacity-50 disabled:no-underline"
          >
            Reset all memories
          </button>
        </div>
        {memories.length === 0 ? (
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
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">{m.tags.join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Intents */}
      <section>
        <h2 className="font-serif text-2xl tracking-tight mb-4">Buying intents</h2>
        {intents.length === 0 ? (
          <p className="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-lg p-6">
            No intents broadcast yet.
          </p>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs font-mono uppercase tracking-widest text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-left px-4 py-3">Intent</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Resolved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {intents.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500 whitespace-nowrap">{fmtDate(i.created_at)}</td>
                    <td className="px-4 py-3">{i.intent_text.slice(0, 200)}{i.intent_text.length > 200 ? '…' : ''}</td>
                    <td className="px-4 py-3 font-mono text-xs">{i.status}</td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">{i.resolved_at ? fmtDate(i.resolved_at) : '-'}</td>
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
        {interactions.length === 0 ? (
          <p className="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-lg p-6">
            No seller agent has called this buyer&apos;s MCP yet.
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
                      <td className="px-4 py-3 text-right font-mono text-xs">{i.status_code ?? '-'}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-neutral-500">{i.duration_ms ?? '-'}</td>
                    </tr>
                  );
                })}
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
              {buyer.public ? 'Hide buyer card' : 'Publish buyer card'}
            </p>
            <p className="text-xs text-neutral-600">
              {buyer.public
                ? `Sets public=false. Their per-buyer MCP at /buyers/${buyer.handle}/mcp stops serving seller agents. Funding wallet ${truncWallet(buyer.wallet_address)} is unaffected.`
                : 'Sets public=true. Per-buyer MCP starts serving seller agents.'}
            </p>
          </div>
          <button
            type="button" onClick={() => void togglePublic()} disabled={busy}
            className={`shrink-0 px-5 py-3 text-xs font-mono tracking-widest uppercase rounded-md disabled:opacity-50 ${
              buyer.public
                ? 'bg-red-700 text-neutral-50 hover:bg-red-800'
                : 'bg-emerald-700 text-neutral-50 hover:bg-emerald-800'
            }`}
          >
            {buyer.public ? 'Make private' : 'Publish'}
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
