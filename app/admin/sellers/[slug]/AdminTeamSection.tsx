'use client';

import { useState } from 'react';
import type { TeamMember, PendingInvite, AssignableRole } from '@/lib/app/seller-team';

interface Props {
  sellerId:       string;
  sellerName:     string;
  initialMembers: TeamMember[];
  initialInvites: PendingInvite[];
}

/**
 * Superadmin team management for a single store. Lets a superadmin add, edit
 * (role) and remove admin/viewer users for any seller, and revoke pending
 * invites. Talks to /api/admin/sellers/[id]/team*, gated by the admin cookie.
 */
export function AdminTeamSection({ sellerId, sellerName, initialMembers, initialInvites }: Props) {
  const [members, setMembers] = useState<TeamMember[]>(initialMembers);
  const [invites, setInvites] = useState<PendingInvite[]>(initialInvites);

  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState<AssignableRole>('admin');
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState('');
  const [info,  setInfo]  = useState('');

  async function refresh() {
    const res = await fetch(`/api/admin/sellers/${sellerId}/team`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setMembers(data.members ?? []);
      setInvites(data.invites ?? []);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setInfo(''); setBusy(true);
    try {
      const res  = await fetch(`/api/admin/sellers/${sellerId}/team`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, role }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      setInfo(json.message || 'Done.');
      setEmail('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, newRole: AssignableRole) {
    setErr(''); setInfo(''); setBusy(true);
    try {
      const res = await fetch(`/api/admin/sellers/${sellerId}/team/${userId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ role: newRole }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string, label: string) {
    if (!confirm(`Remove ${label} from ${sellerName}? They lose access immediately.`)) return;
    setErr(''); setInfo(''); setBusy(true);
    try {
      const res = await fetch(`/api/admin/sellers/${sellerId}/team/${userId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(inviteId: string) {
    setErr(''); setInfo(''); setBusy(true);
    try {
      const res = await fetch(`/api/admin/sellers/${sellerId}/team/invites/${inviteId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="flex items-end justify-between mb-4">
        <h2 className="font-serif text-2xl tracking-tight">Team &amp; access</h2>
        <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">{members.length} members</span>
      </div>

      {err  && <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md px-4 py-3 mb-4">{err}</div>}
      {info && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md px-4 py-3 mb-4">{info}</div>}

      {/* Add */}
      <div className="bg-paper border border-line rounded-lg p-6 mb-4">
        <p className="text-xs text-ink-2 mb-4">
          Add an admin or viewer to this store. If the email already has a VIA account it&apos;s linked at once;
          otherwise an invite email is sent so they can set a password and join.
        </p>
        <form onSubmit={add} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email" required placeholder="name@company.com" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="flex-1 bg-paper border border-line-strong rounded-md px-3 py-2 text-sm font-mono"
          />
          <select
            value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}
            className="bg-paper border border-line-strong rounded-md px-3 py-2 text-sm font-mono"
          >
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            type="submit" disabled={busy}
            className="px-5 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 transition-opacity rounded-md disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Add user'}
          </button>
        </form>
      </div>

      {/* Members */}
      <div className="bg-paper border border-line rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-background text-xs font-mono uppercase tracking-widest text-ink-3">
            <tr>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {members.map((m) => (
              <tr key={m.userId}>
                <td className="px-4 py-3 font-mono text-xs break-all">{m.email || m.userId}</td>
                <td className="px-4 py-3 font-mono text-xs text-ink-3">{m.acceptedAt ? 'Active' : 'Pending'}</td>
                <td className="px-4 py-3">
                  {m.isOwner ? (
                    <span className="inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest rounded bg-line text-ink-2">Owner</span>
                  ) : (
                    <select
                      value={m.role}
                      onChange={(e) => void changeRole(m.userId, e.target.value as AssignableRole)}
                      disabled={busy}
                      className="bg-paper border border-line-strong rounded-md px-2 py-1 text-xs font-mono"
                    >
                      <option value="admin">Admin</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  )}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {m.isOwner ? (
                    <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Protected</span>
                  ) : (
                    <button
                      type="button" disabled={busy} onClick={() => void remove(m.userId, m.email || m.userId)}
                      className="text-[10px] font-mono uppercase tracking-widest text-red-700 underline hover:no-underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="bg-paper border border-line rounded-lg overflow-hidden mt-4">
          <table className="w-full text-sm">
            <thead className="bg-background text-xs font-mono uppercase tracking-widest text-ink-3">
              <tr>
                <th className="text-left px-4 py-3">Pending invite</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Expires</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invites.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3 font-mono text-xs break-all">{i.email}</td>
                  <td className="px-4 py-3 font-mono text-xs">{i.role}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-3 whitespace-nowrap">
                    {new Date(i.expiresAt).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button" disabled={busy} onClick={() => void revoke(i.id)}
                      className="text-[10px] font-mono uppercase tracking-widest text-red-700 underline hover:no-underline disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
