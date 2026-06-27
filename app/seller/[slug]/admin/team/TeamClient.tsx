'use client';

import { useState } from 'react';
import type { TeamMember, PendingInvite, AssignableRole } from '@/lib/app/seller-team';
import type { SellerRole } from '@/lib/app/seller-auth';

export function TeamClient({
  sellerId,
  currentUserId,
  currentRole,
  initialMembers,
  initialInvites,
}: {
  sellerId: string;
  slug: string;
  currentUserId: string;
  currentRole: SellerRole;
  initialMembers: TeamMember[];
  initialInvites: PendingInvite[];
}) {
  const [members, setMembers] = useState<TeamMember[]>(initialMembers);
  const [invites, setInvites] = useState<PendingInvite[]>(initialInvites);

  const [email,   setEmail]   = useState('');
  const [role,    setRole]    = useState<AssignableRole>('admin');
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const [msg,     setMsg]     = useState('');

  const isOwnerOrAdmin = currentRole === 'owner' || currentRole === 'admin';

  async function refresh() {
    const res = await fetch(`/api/seller/${sellerId}/team`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setMembers(data.members ?? []);
      setInvites(data.invites ?? []);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    try {
      const res  = await fetch(`/api/seller/${sellerId}/team`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(data.message || 'Done.');
        setEmail('');
        await refresh();
      } else {
        setErr(data.error || 'Could not send invite.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, newRole: AssignableRole) {
    setErr(''); setMsg('');
    const res = await fetch(`/api/seller/${sellerId}/team/${userId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ role: newRole }),
    });
    if (res.ok) { await refresh(); }
    else { const d = await res.json(); setErr(d.error || 'Could not change role.'); }
  }

  async function removeMember(userId: string) {
    setErr(''); setMsg('');
    const res = await fetch(`/api/seller/${sellerId}/team/${userId}`, { method: 'DELETE' });
    if (res.ok) { await refresh(); }
    else { const d = await res.json(); setErr(d.error || 'Could not remove member.'); }
  }

  async function revoke(inviteId: string) {
    setErr(''); setMsg('');
    const res = await fetch(`/api/seller/${sellerId}/team/invites/${inviteId}`, { method: 'DELETE' });
    if (res.ok) { await refresh(); }
    else { const d = await res.json(); setErr(d.error || 'Could not revoke invite.'); }
  }

  return (
    <div className="space-y-12">
      {err && (
        <div className="border border-[color:var(--danger)] bg-[color:var(--danger)]/10 text-[color:var(--danger)] text-sm px-4 py-3">{err}</div>
      )}
      {msg && (
        <div className="border border-[color:var(--live)] bg-[color:var(--live)]/10 text-[color:var(--live)] text-sm px-4 py-3">{msg}</div>
      )}

      {/* Invite form */}
      {isOwnerOrAdmin && (
        <div className="border border-line p-6">
          <p className="text-xs font-mono tracking-widest text-ink-3 uppercase mb-4">Invite a teammate</p>
          <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
            <input
              type="email" required placeholder="name@company.com" spellCheck={false}
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="flex-1 bg-paper border border-line-strong px-4 py-3 font-mono text-sm focus:outline-none focus:border-ink transition-colors"
            />
            <select
              value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}
              className="bg-paper border border-line-strong px-4 py-3 font-mono text-sm focus:outline-none focus:border-ink transition-colors"
            >
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
            <button type="submit" disabled={busy} className="btn justify-center disabled:opacity-50">
              {busy ? 'Sending…' : 'Send invite'}
            </button>
          </form>
          <p className="text-xs text-ink-3 mt-3">
            If the email already has a VIA account they&apos;re added straight away. Otherwise they get an email link to set
            a password and join.
          </p>
        </div>
      )}

      {/* Members */}
      <div>
        <p className="text-xs font-mono tracking-widest text-ink-3 uppercase mb-4">Members</p>
        <div className="border border-line divide-y divide-line">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="font-mono text-sm text-ink truncate">{m.email || m.userId}</p>
                <p className="text-xs text-ink-3 mt-0.5">
                  {m.userId === currentUserId ? 'You' : m.acceptedAt ? 'Active' : 'Pending'}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {m.isOwner ? (
                  <span className="text-xs font-mono uppercase tracking-widest text-ink-2">Owner</span>
                ) : isOwnerOrAdmin ? (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.userId, e.target.value as AssignableRole)}
                      className="bg-paper border border-line-strong px-3 py-2 font-mono text-xs focus:outline-none focus:border-ink"
                    >
                      <option value="admin">Admin</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      type="button" onClick={() => removeMember(m.userId)}
                      className="text-[10px] font-mono uppercase tracking-widest text-[color:var(--danger)] underline hover:no-underline"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <span className="text-xs font-mono uppercase tracking-widest text-ink-2">{m.role}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div>
          <p className="text-xs font-mono tracking-widest text-ink-3 uppercase mb-4">Pending invites</p>
          <div className="border border-line divide-y divide-line">
            {invites.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-ink truncate">{i.email}</p>
                  <p className="text-xs text-ink-3 mt-0.5">
                    Invited as {i.role} · expires {new Date(i.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                {isOwnerOrAdmin && (
                  <button
                    type="button" onClick={() => revoke(i.id)}
                    className="text-[10px] font-mono uppercase tracking-widest text-[color:var(--danger)] underline hover:no-underline shrink-0"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
