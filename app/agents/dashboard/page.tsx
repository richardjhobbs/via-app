'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PersonaCard } from '@/components/agent/PersonaCard';
import { AvatarPicker } from '@/components/agent/AvatarPicker';
import { TopUpModal } from '@/components/agent/TopUpModal';
import { LlmStatusCard } from '@/components/agent/LlmStatusCard';
import { ChatPanel } from '@/components/agent/ChatPanel';
import { UpgradeToConcierge } from '@/components/agent/UpgradeToConcierge';
import { TIER_DISPLAY } from '@/lib/agent/types';
import { formatChatCost } from '@/lib/agent/credit-display';
import { useActiveAccount } from 'thirdweb/react';
import type { Agent, ActivityLogEntry, AgentEvaluation } from '@/lib/agent/types';

interface MemoryRow {
  id: string;
  created_at: string;
  type: 'preference' | 'brand' | 'style' | 'size' | 'general' | 'consolidated';
  content: string;
  source_session_id: string | null;
}

interface NotificationRow {
  id: string;
  created_at: string;
  kind: 'match_found' | 'chat_followup' | 'system' | string;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
}

// Human-readable labels for activity log actions. Anything not in the
// map falls back to the action name with underscores replaced.
const ACTIVITY_LABELS: Record<string, string> = {
  agent_created: 'Concierge created',
  agent_imported: 'Concierge imported',
  erc8004_minted: 'Trust Registration',
  erc8004_linked: 'Trust Registration linked',
  erc8004_mint_failed: 'Trust Registration failed',
  chat_completed: 'Chat',
  preferences_updated: 'Preferences updated',
  avatar_updated: 'Avatar updated',
  avatar_removed: 'Avatar removed',
  credit_topup: 'Credits topped up',
  tier_upgraded: 'Upgraded to Concierge',
};

const MEMORY_TYPE_LABELS: Record<string, string> = {
  brand: 'Brands',
  size: 'Sizes',
  style: 'Style',
  preference: 'Preferences',
  general: 'Other',
  consolidated: 'Profile',
};

function MemoryPanel({ memories }: { memories: MemoryRow[] }) {
  if (memories.length === 0) {
    return (
      <p className="text-sm text-white/40">
        Nothing yet. Tell your concierge what brands and looks you like, or update your sizes in the wizard next time.
      </p>
    );
  }

  const seedAtSignup = memories.filter(m => !m.source_session_id);
  const learnedFromChat = memories.filter(m => !!m.source_session_id);

  return (
    <div className="space-y-5">
      {seedAtSignup.length > 0 && (
        <MemorySection title="Set at signup" rows={seedAtSignup} />
      )}
      {learnedFromChat.length > 0 && (
        <MemorySection title="Learned from chat" rows={learnedFromChat} />
      )}
    </div>
  );
}

function MemorySection({ title, rows }: { title: string; rows: MemoryRow[] }) {
  // Group by type so brands/sizes/style each get a clean sub-block.
  const byType = new Map<string, MemoryRow[]>();
  for (const r of rows) {
    const arr = byType.get(r.type) ?? [];
    arr.push(r);
    byType.set(r.type, arr);
  }
  const orderedTypes = ['brand', 'size', 'style', 'preference', 'consolidated', 'general'];
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-white/40 mb-2">{title}</div>
      <div className="space-y-3">
        {orderedTypes.filter(t => byType.has(t)).map(t => (
          <div key={t}>
            <div className="text-xs text-white/40 mb-1">{MEMORY_TYPE_LABELS[t] ?? t}</div>
            <ul className="text-sm text-white/80 space-y-1">
              {byType.get(t)!.map(m => (
                <li key={m.id}>{m.content.replace(/\s*\(set at signup\)\s*$/, '')}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeading({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <h2
        style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: 22,
          fontWeight: 400,
          letterSpacing: '-0.01em',
          margin: 0,
        }}
      >
        {children}
      </h2>
      {sub && (
        <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '4px 0 0' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function CollapsibleCard({
  title,
  summary,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="md:col-span-2">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontSize: 22,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            {title}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '4px 0 0' }}>
            {summary}
          </p>
        </div>
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            padding: 0,
            borderBottom: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
            whiteSpace: 'nowrap',
          }}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {expanded && <div style={{ marginTop: 16 }}>{children}</div>}
    </Card>
  );
}

function NotificationsCard({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
}: {
  notifications: NotificationRow[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}) {
  if (notifications.length === 0) {
    return (
      <Card className="md:col-span-2">
        <SectionHeading sub="Async messages from your concierge and the catalogue watcher.">
          Notifications
        </SectionHeading>
        <p className="text-sm text-white/40" style={{ marginTop: 16 }}>
          Nothing yet. Ask your concierge to message you when something appears, or wait for the catalogue watcher to flag a match.
        </p>
      </Card>
    );
  }

  return (
    <Card className="md:col-span-2">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-3">
            <h2
              style={{
                fontFamily: 'var(--font-fraunces), serif',
                fontSize: 22,
                fontWeight: 400,
                letterSpacing: '-0.01em',
                margin: 0,
              }}
            >
              Notifications
            </h2>
            {unreadCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono bg-green-500/10 text-green-700 border border-green-500/30 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse" />
                {unreadCount} unread
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '4px 0 0' }}>
            Async messages from your concierge and the catalogue watcher.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={onMarkAllRead}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'var(--accent)', padding: 0,
              borderBottom: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
              whiteSpace: 'nowrap',
            }}
          >
            Mark all read
          </button>
        )}
      </div>
      <div className="space-y-2">
        {notifications.map((n) => {
          const unread = !n.read_at;
          return (
            <div
              key={n.id}
              className={`p-3 rounded border ${unread ? 'border-green-500/30 bg-green-500/5' : 'border-white/5 bg-transparent'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {unread && <span className="w-1.5 h-1.5 rounded-full bg-green-600 shrink-0" />}
                    <span className="text-sm font-medium text-white/90">{n.title}</span>
                  </div>
                  <div className="text-xs text-white/60 whitespace-pre-wrap">{n.body}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs text-white/30">{new Date(n.created_at).toLocaleString()}</span>
                  {unread && (
                    <button
                      onClick={() => onMarkRead(n.id)}
                      className="text-xs text-green-700 hover:text-green-800 transition-colors cursor-pointer"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function renderActivityDetail(entry: ActivityLogEntry): string | null {
  const d = entry.details ?? {};
  if (entry.action === 'chat_completed') {
    const tokens = Number(d.tokens_used ?? 0);
    const cost = Number(d.cost_usdc ?? 0);
    const toolCount = Number(d.tool_count ?? 0);
    const preview = typeof d.user_message_preview === 'string' ? d.user_message_preview : '';
    const parts: string[] = [];
    if (preview) parts.push(`"${preview}"`);
    parts.push(`${tokens.toLocaleString()} tokens`);
    parts.push(formatChatCost(cost));
    if (toolCount > 0) parts.push(`${toolCount} tool ${toolCount === 1 ? 'call' : 'calls'}`);
    return parts.join(' · ');
  }
  if (entry.action === 'erc8004_mint_failed') {
    return typeof d.error === 'string' ? d.error : null;
  }
  return null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recommendations, setRecommendations] = useState<AgentEvaluation[]>([]);
  const [knowExpanded, setKnowExpanded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
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

      // Always fetch on-chain USDC for the top-right Wallet balance display,
      // regardless of tier. Used for shopping spend.
      try {
        const balRes = await fetch(`/api/agent/wallet/balance?address=${a.wallet_address}`);
        if (balRes.ok) { const { balance_usdc } = await balRes.json(); setBalance(balance_usdc); }
      } catch {}

      // Pro: also sync inbound USDC → credits so the chat credit balance is fresh.
      if (a.tier === 'pro') {
        try {
          const syncRes = await fetch(`/api/agent/${a.id}/credits/sync`, { method: 'POST' });
          if (syncRes.ok) {
            const { credit_balance } = await syncRes.json();
            setAgent(prev => prev ? { ...prev, credit_balance_usdc: Number(credit_balance) } : prev);
          }
        } catch {}
      }

      const actRes = await fetch(`/api/agent/${a.id}/activity`);
      if (actRes.ok) { const { activity: acts } = await actRes.json(); setActivity(acts); }

      const memRes = await fetch(`/api/agent/${a.id}/memory`);
      if (memRes.ok) { const { memories: mems } = await memRes.json(); setMemories(mems ?? []); }

      const notifRes = await fetch(`/api/agent/${a.id}/notifications`);
      if (notifRes.ok) {
        const { notifications: notifs, unread_count } = await notifRes.json();
        setNotifications(notifs ?? []);
        setUnreadCount(Number(unread_count ?? 0));
      }

      // Resolve avatar URL via the resolve endpoint, which mints a fresh
      // signed URL for uploaded/generated avatars and looks up the bundled
      // asset for presets. Without this, uploaded avatars show as initials
      // on every page reload because the signed URL from upload is in-memory only.
      if (a.avatar_path && a.avatar_source !== 'none') {
        try {
          const avRes = await fetch(`/api/agent/${a.id}/avatar`);
          if (avRes.ok) {
            const { avatar_url } = await avRes.json();
            setAvatarUrl(avatar_url ?? null);
          }
        } catch {}
      }

      if (a.tier === 'pro') {
        const recRes = await fetch(`/api/agent/${a.id}/recommendations`);
        if (recRes.ok) { const { recommendations: recs } = await recRes.json(); setRecommendations(recs); }
      }
    } catch {} finally { setLoading(false); }
  }

  async function markNotificationRead(notifId: string) {
    if (!agent) return;
    const prev = notifications;
    const next = prev.map(n => n.id === notifId ? { ...n, read_at: new Date().toISOString() } : n);
    setNotifications(next);
    setUnreadCount(c => Math.max(0, c - 1));
    try {
      const res = await fetch(`/api/agent/${agent.id}/notifications/${notifId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      });
      if (!res.ok) {
        setNotifications(prev);
        setUnreadCount(prev.filter(n => !n.read_at).length);
      }
    } catch {
      setNotifications(prev);
      setUnreadCount(prev.filter(n => !n.read_at).length);
    }
  }

  async function markAllNotificationsRead() {
    if (!agent) return;
    const prev = notifications;
    const now = new Date().toISOString();
    setNotifications(prev.map(n => n.read_at ? n : { ...n, read_at: now }));
    setUnreadCount(0);
    try {
      const res = await fetch(`/api/agent/${agent.id}/notifications/mark-all-read`, {
        method: 'POST',
      });
      if (!res.ok) {
        setNotifications(prev);
        setUnreadCount(prev.filter(n => !n.read_at).length);
      }
    } catch {
      setNotifications(prev);
      setUnreadCount(prev.filter(n => !n.read_at).length);
    }
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
          // Cookie set by the route. Reload to pick it up.
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
            Get your own Personal Shopper or Concierge. They search the VIA network for you.
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
            {/* Avatar. Click to change. */}
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
                {unreadCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono bg-green-500/10 text-green-700 border border-green-500/30 rounded"
                    title={`${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse" />
                    {unreadCount} new
                  </span>
                )}
              </div>
              <p className="text-sm text-white/40 font-mono">{agent.wallet_address}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-light text-green-700">
              {balance !== null ? `$${balance.toFixed(2)}` : '...'}
            </div>
            <div className="text-xs text-white/40">Wallet balance</div>
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
          {/* Upgrade CTA (Personal Shopper only) */}
          {agent.tier === 'basic' && (
            <UpgradeToConcierge
              agent={agent}
              onUpgraded={(next) => setAgent(next)}
            />
          )}

          {/* Chat (Concierge only). Top of the dashboard, it's the
              primary surface and what the owner is here for. */}
          {agent.tier === 'pro' && (
            <ChatPanel agent={agent} />
          )}

          {/* Persona: bio, voice, comm style, interests, style tags and
              free-text instructions. Collapsed by default so the chat
              stays front-and-centre. */}
          <PersonaCard agent={agent} onSave={savePersona} />

          {/* LLM Provider Status (Concierge only) */}
          {agent.tier === 'pro' && (
            <LlmStatusCard
              agent={agent}
              onProviderChange={(provider) => setAgent(prev => prev ? { ...prev, llm_provider: provider } : prev)}
              onTopUp={() => setShowTopUp(true)}
            />
          )}

          {/* Notifications (Concierge only). Async messages from the
              concierge tool + drop-match watcher. */}
          {agent.tier === 'pro' && (
            <NotificationsCard
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={markNotificationRead}
              onMarkAllRead={markAllNotificationsRead}
            />
          )}

          {/* Recommendations (Concierge only). Only renders when there is
              something to show. */}
          {agent.tier === 'pro' && recommendations.length > 0 && (
            <Card className="md:col-span-2">
              <SectionHeading>Recommendations</SectionHeading>
              <div className="space-y-3" style={{ marginTop: 16 }}>
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

          {/* What I know about you (Concierge only). Collapsed by default. */}
          {agent.tier === 'pro' && (
            <CollapsibleCard
              title="What I know about you"
              summary={
                memories.length === 0
                  ? 'Nothing learned yet. Seeded at signup and extended from chat.'
                  : `${memories.length} ${memories.length === 1 ? 'fact' : 'facts'} on file. Used by your concierge in every chat.`
              }
              expanded={knowExpanded}
              onToggle={() => setKnowExpanded(v => !v)}
            >
              <MemoryPanel memories={memories} />
            </CollapsibleCard>
          )}

          {/* Activity log. Collapsed by default. */}
          <CollapsibleCard
            title="Activity"
            summary={
              activity.length === 0
                ? (agent.tier === 'basic'
                    ? 'No activity yet. Your Personal Shopper will report back to you here.'
                    : 'No activity yet. Your Concierge will evaluate drops and chat with you here.')
                : `${activity.length} ${activity.length === 1 ? 'entry' : 'entries'}. Most recent: ${new Date(activity[0].created_at).toLocaleString()}.`
            }
            expanded={activityExpanded}
            onToggle={() => setActivityExpanded(v => !v)}
          >
            {activity.length === 0 ? (
              <p className="text-sm text-white/40">No activity yet.</p>
            ) : (
              <div className="space-y-2">
                {activity.map((entry) => {
                  const label = ACTIVITY_LABELS[entry.action] ?? entry.action.replace(/_/g, ' ');
                  const detail = renderActivityDetail(entry);
                  return (
                    <div key={entry.id} className="flex items-start justify-between text-sm py-2 border-b border-white/5 last:border-0 gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-white/80">{label}</span>
                          {entry.tx_hash && (
                            <a href={`https://basescan.org/tx/${entry.tx_hash}`} target="_blank" rel="noopener noreferrer"
                               className="text-xs text-green-700 hover:underline">tx</a>
                          )}
                        </div>
                        {detail && (
                          <div className="text-xs text-white/40 mt-0.5 truncate">{detail}</div>
                        )}
                      </div>
                      <span className="text-xs text-white/30 shrink-0">
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CollapsibleCard>
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
