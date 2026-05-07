'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select, TagSelect } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { PersonaCard } from '@/components/agent/PersonaCard';
import { AvatarPicker } from '@/components/agent/AvatarPicker';
import { TopUpModal } from '@/components/agent/TopUpModal';
import { LlmStatusCard } from '@/components/agent/LlmStatusCard';
import { ChatPanel } from '@/components/agent/ChatPanel';
import { STYLE_TAGS, TIER_DISPLAY, LLM_PROVIDER_OPTIONS } from '@/lib/agent/types';
import { PRESET_AVATARS } from '@/lib/agent/avatars';
import { useActiveAccount } from 'thirdweb/react';
import type { Agent, ActivityLogEntry, AgentEvaluation } from '@/lib/agent/types';

export default function DashboardPage() {
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [recommendations, setRecommendations] = useState<AgentEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    style_tags: [] as string[],
    free_instructions: '',
    budget_ceiling_usdc: '',
    bid_aggression: 'balanced',
    llm_provider: 'claude',
  });
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  const activeAccount = useActiveAccount();

  useEffect(() => { loadDashboard(); }, [activeAccount]);

  // Auto-refresh while VIA Agent ID is being minted on-chain.
  // Polls /api/agent/session every 5s for up to 60s after the agent
  // appears unlinked. Stops as soon as erc8004_linked flips true.
  useEffect(() => {
    if (!agent || agent.erc8004_linked) return;

    let cancelled = false;
    const start = Date.now();

    const tick = async () => {
      if (cancelled || Date.now() - start > 60_000) return;
      try {
        const res = await fetch('/api/agent/session');
        if (res.ok) {
          const { agent: latest } = await res.json();
          if (latest?.erc8004_linked) {
            setAgent(prev => prev ? {
              ...prev,
              erc8004_agent_id: latest.erc8004_agent_id ?? prev.erc8004_agent_id,
              erc8004_linked: true,
            } : prev);
            return;
          }
        }
      } catch {}
      if (!cancelled) setTimeout(tick, 5000);
    };

    const initial = setTimeout(tick, 5000);
    return () => { cancelled = true; clearTimeout(initial); };
  }, [agent?.id, agent?.erc8004_linked]);

  async function loadDashboard() {
    try {
      // Try session cookie first
      let res = await fetch('/api/agent/session');
      let raw = null;

      if (res.ok) {
        const data = await res.json();
        raw = data.agent;
      }

      // Fallback: if no cookie but Thirdweb wallet is connected, look up by wallet
      if (!raw && activeAccount?.address) {
        const walletRes = await fetch(`/api/agent/session?wallet=${activeAccount.address}`);
        if (walletRes.ok) {
          const data = await walletRes.json();
          raw = data.agent;
        }
      }

      if (!raw) { setLoading(false); return; }
      // Defensive defaults for agents created before persona migration
      const a = {
        ...raw,
        persona_bio: raw.persona_bio ?? null,
        persona_voice: raw.persona_voice ?? null,
        persona_comm_style: raw.persona_comm_style ?? null,
        interest_categories: raw.interest_categories ?? [],
        avatar_path: raw.avatar_path ?? null,
        avatar_source: raw.avatar_source ?? 'none',
        credit_balance_usdc: Number(raw.credit_balance_usdc ?? 0),
      };
      setAgent(a);

      // Pro: sync inbound USDC → credits. Falls back to on-chain read for basic.
      if (a.tier === 'pro') {
        try {
          const syncRes = await fetch(`/api/agent/${a.id}/credits/sync`, { method: 'POST' });
          if (syncRes.ok) {
            const { credit_balance } = await syncRes.json();
            setAgent(prev => prev ? { ...prev, credit_balance_usdc: Number(credit_balance) } : prev);
          }
        } catch {}
      } else {
        const balRes = await fetch(`/api/agent/wallet/balance?address=${a.wallet_address}`);
        if (balRes.ok) { const { balance_usdc } = await balRes.json(); setBalance(balance_usdc); }
      }

      const actRes = await fetch(`/api/agent/${a.id}/activity`);
      if (actRes.ok) { const { activity: acts } = await actRes.json(); setActivity(acts); }

      // Resolve avatar URL
      if (a.avatar_source === 'preset' && a.avatar_path) {
        const preset = PRESET_AVATARS.find(p => p.id === a.avatar_path);
        if (preset) setAvatarUrl(preset.src);
      } else if ((a.avatar_source === 'uploaded' || a.avatar_source === 'generated') && a.avatar_path) {
        // Signed URL was returned when avatar was set; for now show initials until we add a resolve endpoint
        setAvatarUrl(null);
      }

      if (a.tier === 'pro') {
        const recRes = await fetch(`/api/agent/${a.id}/recommendations`);
        if (recRes.ok) { const { recommendations: recs } = await recRes.json(); setRecommendations(recs); }
      }
    } catch {} finally { setLoading(false); }
  }

  function startEdit() {
    if (!agent) return;
    setEditForm({
      style_tags: agent.style_tags,
      free_instructions: agent.free_instructions || '',
      budget_ceiling_usdc: agent.budget_ceiling_usdc?.toString() || '',
      bid_aggression: agent.bid_aggression,
      llm_provider: agent.llm_provider,
    });
    setEditing(true);
  }

  async function savePreferences() {
    if (!agent) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agent/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          style_tags: editForm.style_tags,
          free_instructions: editForm.free_instructions || null,
          budget_ceiling_usdc: editForm.budget_ceiling_usdc ? parseFloat(editForm.budget_ceiling_usdc) : null,
          bid_aggression: editForm.bid_aggression,
          llm_provider: editForm.llm_provider,
        }),
      });
      if (res.ok) {
        const { agent: updated } = await res.json();
        setAgent(updated);
        setEditing(false);
      }
    } catch {} finally { setSaving(false); }
  }

  async function savePersona(updates: Partial<Agent>) {
    if (!agent) return;
    const res = await fetch(`/api/agent/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const { agent: updated } = await res.json();
      setAgent(updated);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
        <RRGHeader active="concierge" />
        <main className="px-6 py-12 max-w-4xl mx-auto">
          <p className="text-white/50 animate-pulse">Loading...</p>
        </main>
        <RRGFooter />
      </div>
    );
  }

  if (!agent) {
    async function tryRecoverByEmail(e: React.FormEvent) {
      e.preventDefault();
      const email = recoverEmail.toLowerCase().trim();
      if (!email) return;
      setRecovering(true);
      setRecoverError(null);
      try {
        const res = await fetch(`/api/agent/session?email=${encodeURIComponent(email)}`);
        if (res.ok) {
          // Cookie set by the route — reload to pick it up
          await loadDashboard();
          return;
        }
        setRecoverError('No agent found for that email. Either the address is different from what you registered with, or you have not created an agent yet.');
      } catch {
        setRecoverError('Recovery failed. Try again.');
      } finally {
        setRecovering(false);
      }
    }

    const checkedWallet = activeAccount?.address ?? null;

    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
        <RRGHeader active="concierge" />
        <main className="px-6 py-12 max-w-2xl mx-auto">
          <h1 className="text-xl font-semibold mb-3">No service found for this session</h1>
          <p className="text-sm mb-6" style={{ color: 'var(--ink-2)' }}>
            We checked for a session cookie{checkedWallet ? <> and the connected wallet <span className="font-mono text-xs">{checkedWallet.slice(0, 6)}…{checkedWallet.slice(-4)}</span></> : null}, but no agent matches.
          </p>

          <div className="mb-8 p-4 rounded" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
            <h2 className="text-sm font-semibold mb-2">Already have an agent?</h2>
            <p className="text-xs mb-3" style={{ color: 'var(--ink-3)' }}>
              If you signed up before with a different login method, recover by entering the email you used.
            </p>
            <form onSubmit={tryRecoverByEmail} className="flex gap-2 items-stretch">
              <input
                type="email"
                value={recoverEmail}
                onChange={(e) => setRecoverEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={recovering}
                className="flex-1 px-3 py-2 text-sm rounded outline-none"
                style={{ background: 'var(--bg)', border: '1px solid var(--line-strong)', color: 'var(--ink)' }}
              />
              <Button type="submit" loading={recovering} disabled={!recoverEmail.trim()}>
                Recover
              </Button>
            </form>
            {recoverError && (
              <p className="text-xs mt-2" style={{ color: 'var(--accent-warn, #b5453a)' }}>{recoverError}</p>
            )}
          </div>

          <h2 className="text-sm font-semibold mb-2">First time here?</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--ink-3)' }}>
            Get your own Personal Shopper or Concierge — they search the VIA network for you.
          </p>
          <Button onClick={() => router.push('/agents')}>Get started</Button>
        </main>
        <RRGFooter />
      </div>
    );
  }

  const tierDisplay = TIER_DISPLAY[agent.tier];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <RRGHeader active="concierge" />
      <main className="page-pad" style={{ maxWidth: 1000 }}>
        {/* Agent header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-start gap-4">
            {/* Avatar — click to change */}
            <button
              onClick={() => setShowAvatarPicker(true)}
              className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-light flex-shrink-0 bg-white/10 text-white/60 hover:ring-2 hover:ring-green-500/50 transition-all cursor-pointer overflow-hidden group relative"
              title="Change avatar"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
              ) : (
                agent.name.charAt(0).toUpperCase()
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-xs text-white/80">Edit</span>
              </div>
            </button>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-light">{agent.name}</h1>
                <Badge variant={agent.tier === 'pro' ? 'pro' : 'default'}>
                  {tierDisplay.label}
                </Badge>
                {agent.erc8004_linked && agent.erc8004_agent_id ? (
                  <a
                    href={`/agents/via/${agent.erc8004_agent_id}`}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono bg-green-500/10 text-green-700 border border-green-500/30 rounded hover:bg-green-500/20 transition-colors"
                    title="View public profile"
                  >
                    VIA #{agent.erc8004_agent_id}
                  </a>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono bg-amber-500/10 text-amber-700 border border-amber-500/30 rounded"
                    title="Your VIA Agent ID is being assigned on-chain. This is your portable identity across the VIA network."
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    VIA pending
                  </span>
                )}
              </div>
              <p className="text-sm text-white/40 font-mono">{agent.wallet_address}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-light text-green-700">
              {agent.tier === 'pro'
                ? `$${agent.credit_balance_usdc.toFixed(2)}`
                : (balance !== null ? `$${balance.toFixed(2)}` : '...')}
            </div>
            <div className="text-xs text-white/40">Balance</div>
            {agent.tier === 'pro' && (
              <button
                onClick={() => setShowTopUp(true)}
                className="mt-2 text-xs text-green-700 hover:text-green-800 transition-colors cursor-pointer"
              >
                Top up
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Persona */}
          <PersonaCard agent={agent} onSave={savePersona} />

          {/* Preferences */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Preferences</h2>
              {!editing && (
                <button
                  onClick={startEdit}
                  className="text-xs text-green-700 hover:text-green-800 transition-colors cursor-pointer"
                >
                  Edit
                </button>
              )}
            </div>

            {editing ? (
              <div className="space-y-3">
                <TagSelect
                  label="Style tags"
                  selected={editForm.style_tags}
                  onChange={(tags) => setEditForm(prev => ({ ...prev, style_tags: tags }))}
                  options={[...STYLE_TAGS]}
                />
                <Textarea
                  label="Instructions"
                  value={editForm.free_instructions}
                  onChange={(e) => setEditForm(prev => ({ ...prev, free_instructions: e.target.value }))}
                />
                <Input
                  label="Budget ceiling (USDC)"
                  type="number"
                  value={editForm.budget_ceiling_usdc}
                  onChange={(e) => setEditForm(prev => ({ ...prev, budget_ceiling_usdc: e.target.value }))}
                />
                <Select
                  label="Bid style"
                  value={editForm.bid_aggression}
                  onChange={(v) => setEditForm(prev => ({ ...prev, bid_aggression: v }))}
                  options={[
                    { value: 'conservative', label: 'Conservative' },
                    { value: 'balanced', label: 'Balanced' },
                    { value: 'aggressive', label: 'Aggressive' },
                  ]}
                />
                {agent.tier === 'pro' && (
                  <Select
                    label="LLM provider"
                    value={editForm.llm_provider}
                    onChange={(v) => setEditForm(prev => ({ ...prev, llm_provider: v }))}
                    options={[...LLM_PROVIDER_OPTIONS]}
                  />
                )}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={savePreferences} loading={saving}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                {agent.style_tags.length > 0 && (
                  <div>
                    <div className="text-white/40 mb-1">Style tags</div>
                    <div className="flex flex-wrap gap-1">
                      {agent.style_tags.map((tag) => (
                        <span key={tag} className="px-2 py-0.5 text-xs border border-green-500/30 text-green-700/80 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {agent.free_instructions && (
                  <div>
                    <div className="text-white/40 mb-1">Instructions</div>
                    <div className="text-white/80">{agent.free_instructions}</div>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-white/40">Budget ceiling</span>
                  <span className="text-green-700">{agent.budget_ceiling_usdc ? `$${agent.budget_ceiling_usdc}` : 'No limit'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Bid style</span>
                  <span>{agent.bid_aggression}</span>
                </div>
                {agent.tier === 'pro' && (
                  <div className="flex justify-between">
                    <span className="text-white/40">LLM</span>
                    <span>{agent.llm_provider}</span>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* LLM Provider Status (Concierge only) */}
          {agent.tier === 'pro' && (
            <LlmStatusCard agent={agent} />
          )}

          {/* Recommendations (Concierge only) */}
          {agent.tier === 'pro' && recommendations.length > 0 && (
            <Card className="md:col-span-2">
              <h2 className="text-base font-semibold mb-4">Recommendations</h2>
              <div className="space-y-3">
                {recommendations.map((rec) => (
                  <div key={rec.id} className="flex items-start justify-between p-3 bg-white/5 rounded-lg">
                    <div>
                      <div className="text-sm font-medium mb-1">Drop: {rec.drop_id.slice(0, 8)}...</div>
                      <div className="text-xs text-white/50">{rec.reasoning}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost">Skip</Button>
                      <Button size="sm">Approve</Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Chat (Concierge only) */}
          {agent.tier === 'pro' && (
            <ChatPanel agent={agent} />
          )}

          {/* Activity log */}
          <Card className="md:col-span-2">
            <h2 className="text-base font-semibold mb-4">Activity</h2>
            {activity.length === 0 ? (
              <p className="text-sm text-white/40">
                No activity yet. Your {tierDisplay.label} will start evaluating drops when they go live.
              </p>
            ) : (
              <div className="space-y-2">
                {activity.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between text-sm py-2 border-b border-white/5 last:border-0">
                    <div>
                      <span className="text-white/80">{entry.action.replace(/_/g, ' ')}</span>
                      {entry.tx_hash && (
                        <a href={`https://basescan.org/tx/${entry.tx_hash}`} target="_blank" rel="noopener noreferrer"
                           className="ml-2 text-xs text-green-700 hover:underline">tx</a>
                      )}
                    </div>
                    <span className="text-xs text-white/30">
                      {new Date(entry.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </main>

      {/* Top up credits modal */}
      {showTopUp && agent && (
        <TopUpModal
          agent={agent}
          onClose={() => setShowTopUp(false)}
          onCredited={(newBalance) => {
            setAgent(prev => prev ? { ...prev, credit_balance_usdc: newBalance } : prev);
            setShowTopUp(false);
          }}
        />
      )}

      {/* Avatar picker modal */}
      {showAvatarPicker && agent && (
        <AvatarPicker
          agent={agent}
          onAvatarChange={(data) => {
            setAgent(prev => prev ? {
              ...prev,
              avatar_path: data.avatar_path,
              avatar_source: data.avatar_source as Agent['avatar_source'],
            } : prev);
            setAvatarUrl(data.avatar_url || null);
            setShowAvatarPicker(false);
          }}
          onClose={() => setShowAvatarPicker(false)}
        />
      )}

      <RRGFooter />
    </div>
  );
}
