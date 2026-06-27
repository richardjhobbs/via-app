'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function InviteAcceptForm({
  token,
  email,
  needsAccount,
}: {
  token: string;
  email: string;
  needsAccount: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [err,      setErr]      = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const res  = await fetch('/api/seller/invite/accept', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok && data.redirect_to) {
        router.push(data.redirect_to);
      } else {
        setErr(data.error || 'Could not accept the invitation.');
      }
    } catch {
      setErr('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {err && (
        <div className="border border-[color:var(--danger)] bg-[color:var(--danger)]/10 text-[color:var(--danger)] text-sm px-4 py-3">{err}</div>
      )}

      {/* Hidden email field so password managers attach the credential to the right account. */}
      <input type="email" value={email} readOnly hidden autoComplete="username" />

      <div>
        <div className="text-xs font-mono tracking-widest text-ink-3 uppercase mb-2">
          {needsAccount ? 'Choose a password' : 'Your password'}
        </div>
        <input
          type="password" required minLength={8}
          autoComplete={needsAccount ? 'new-password' : 'current-password'}
          value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder={needsAccount ? 'At least 8 characters' : 'Your existing VIA password'}
          className="w-full bg-paper border border-line-strong px-4 py-3 font-mono text-sm focus:outline-none focus:border-ink transition-colors"
        />
        <p className="text-xs text-ink-3 mt-2">
          {needsAccount
            ? 'This creates your VIA account for this email.'
            : 'This email already has a VIA account, enter its password to join.'}
        </p>
      </div>

      <button type="submit" disabled={loading} className="btn w-full justify-center disabled:opacity-50">
        {loading ? 'Joining…' : 'Accept invitation'}
      </button>
    </form>
  );
}
