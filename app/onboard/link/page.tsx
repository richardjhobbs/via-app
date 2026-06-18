'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Wordmark } from '@/components/app/Wordmark';

type Phase = 'checking' | 'linking' | 'need-auth' | 'done' | 'error';

function LinkInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [phase, setPhase] = useState<Phase>('checking');
  const [err, setErr] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const finish = useCallback(
    (redirectTo: string) => {
      setPhase('done');
      router.push(redirectTo);
    },
    [router],
  );

  const submitLink = useCallback(
    async (creds?: { email: string; password: string }) => {
      const res = await fetch('/api/buyer/link-rrg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...(creds ?? {}) }),
      });
      const data = await res.json();
      if (res.ok && data.redirect_to) {
        finish(data.redirect_to as string);
        return true;
      }
      if (res.status === 401 && data.needsAuth) {
        setPhase('need-auth');
        if (data.error) setErr(data.error);
        return false;
      }
      setPhase('error');
      setErr(data.error || 'Could not bring your concierge across.');
      return false;
    },
    [token, finish],
  );

  // On load: validate token presence, then try to link using an existing
  // session. If unauthenticated, fall back to the email/password form.
  useEffect(() => {
    if (!token) {
      setPhase('error');
      setErr('This link is missing its handoff token. Start again from your RRG concierge.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/buyer/auth/check');
        const d = await r.json();
        if (cancelled) return;
        if (d.authenticated) {
          setPhase('linking');
          await submitLink();
        } else {
          setPhase('need-auth');
        }
      } catch {
        if (!cancelled) setPhase('need-auth');
      }
    })();
    return () => { cancelled = true; };
  }, [token, submitLink]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    setPhase('linking');
    const ok = await submitLink({ email, password });
    setLoading(false);
    if (!ok) setPhase('need-auth');
  };

  const inputClass =
    'w-full bg-paper border border-line-strong px-4 py-3 text-sm outline-none focus:border-ink transition-colors';

  return (
    <div className="w-full max-w-sm px-6">
      <Link href="/" aria-label="VIA home" className="inline-block mb-8"><Wordmark /></Link>
      <p className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-2">Bring your concierge to VIA</p>

      {(phase === 'checking' || phase === 'linking' || phase === 'done') && (
        <div className="space-y-3">
          <h1 className="font-serif text-3xl tracking-tight">
            {phase === 'done' ? 'Linked' : 'Linking your concierge'}
          </h1>
          <p className="text-sm text-ink-2 font-mono">
            {phase === 'checking' && 'Checking your session…'}
            {phase === 'linking' && 'Importing your taste, budget and memories…'}
            {phase === 'done' && 'Done. Taking you to your Buying Agent…'}
          </p>
        </div>
      )}

      {phase === 'need-auth' && (
        <form onSubmit={handleAuthSubmit} className="space-y-4">
          <h1 className="font-serif text-3xl tracking-tight mb-1">Sign in to finish</h1>
          <p className="text-sm text-ink-2 mb-2">
            Your concierge keeps the same wallet, taste and memories. Sign in to your VIA account, or set a password to create one.
          </p>
          <div>
            <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoFocus />
          </div>
          <div>
            <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Password</label>
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </div>
          {err && <p className="text-sm text-[color:var(--danger)] font-mono">{err}</p>}
          <button type="submit" disabled={loading} className="btn w-full justify-center disabled:opacity-40">
            {loading ? 'Linking…' : 'Bring my concierge across'}
          </button>
        </form>
      )}

      {phase === 'error' && (
        <div className="space-y-3">
          <h1 className="font-serif text-3xl tracking-tight">Something went wrong</h1>
          <p className="text-sm text-[color:var(--danger)] font-mono">{err}</p>
          <Link href="/onboard?role=buyer" className="text-xs font-mono text-ink-3 hover:text-ink transition-colors">
            Create a Buying Agent instead <span aria-hidden>&rarr;</span>
          </Link>
        </div>
      )}
    </div>
  );
}

export default function LinkConciergePage() {
  return (
    <div className="min-h-screen bg-background text-ink flex items-center justify-center">
      <Suspense fallback={<div className="text-xs font-mono text-ink-3">Loading…</div>}>
        <LinkInner />
      </Suspense>
    </div>
  );
}
