'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/app/Wordmark';
import { useRouter, useSearchParams } from 'next/navigation';

type Mode = 'login' | 'forgot' | 'reset';

interface BrandHit {
  sellerSlug: string;
}

function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  // Only honour same-origin relative paths under /seller/ to avoid
  // open-redirect issues. Anything else falls through to the default.
  if (!raw.startsWith('/seller/')) return null;
  // Block protocol-relative URLs like //evil.example.com
  if (raw.startsWith('//')) return null;
  return raw;
}

function SellerLoginInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const isReset      = searchParams.get('reset') === 'true';
  const nextPath     = safeNext(searchParams.get('next'));

  // Supabase returns the recovery tokens in the URL HASH fragment
  // (#access_token=…&refresh_token=…&type=recovery), which useSearchParams
  // cannot read. They are parsed from the hash in an effect below.
  const [accessToken,  setAccessToken]  = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);

  const [mode,    setMode]    = useState<Mode>('login');
  const [email,   setEmail]   = useState('');
  const [pass,    setPass]    = useState('');
  const [newPass, setNewPass] = useState('');
  const [err,     setErr]     = useState('');
  const [msg,     setMsg]     = useState('');
  const [loading, setLoading] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  // Recovery tokens arrive in the URL hash, not the query string. Parse them
  // client-side and switch to the reset form so the user can set a new
  // password. Without this the page falls back to the sign-in form.
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    const h  = new URLSearchParams(raw);
    const at = h.get('access_token');
    const rt = h.get('refresh_token');
    if (at && (h.get('type') === 'recovery' || isReset)) {
      setAccessToken(at);
      setRefreshToken(rt);
      setMode('reset');
    }
  }, [isReset]);

  // If a session cookie is already present, send them straight on. Honour
  // ?next= when it's a safe relative /seller/ path so notification deep
  // links work without an extra hop through the slug guess.
  useEffect(() => {
    // A recovery visit carries its token in the hash; don't bounce it to the
    // dashboard, let the user set a new password first.
    if (window.location.hash.includes('access_token')) return;
    fetch('/api/seller/auth/check', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        if (d.authenticated && Array.isArray(d.brands) && d.brands.length > 0) {
          if (nextPath) {
            router.push(nextPath);
            return;
          }
          const first = (d.brands as BrandHit[])[0];
          router.push(`/seller/${first.sellerSlug}/admin`);
        }
      })
      .catch(() => {});
  }, [router, nextPath]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg(''); setLoading(true);
    try {
      const res  = await fetch('/api/seller/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password: pass }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.brands) && data.brands.length > 0) {
        if (nextPath) {
          router.push(nextPath);
        } else {
          router.push(`/seller/${(data.brands as BrandHit[])[0].sellerSlug}/admin`);
        }
      } else {
        setErr(data.error || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg(''); setLoading(true);
    try {
      const res  = await fetch('/api/seller/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) setMsg(data.message || 'Check your inbox for a reset link.');
      else        setErr(data.error || 'Could not send reset link.');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg(''); setLoading(true);
    try {
      const res  = await fetch('/api/seller/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          access_token:  accessToken,
          refresh_token: refreshToken,
          password:      newPass,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Success: hide the form and take them to their dashboard. The reset
        // route has already set the session cookie, so resolve the store slug
        // and go straight there. A full navigation to a different path is used
        // because the recovery hash still on this URL blocks the auto-forward.
        setResetDone(true);
        setErr('');
        setMsg('Password updated. Taking you to your dashboard.');
        let dest = '/seller/login';
        try {
          const chk = await fetch('/api/seller/auth/check', { cache: 'no-store' });
          const d = chk.ok ? await chk.json() : null;
          const slug = d?.brands?.[0]?.sellerSlug;
          if (slug) dest = `/seller/${slug}/admin`;
        } catch { /* fall back to the login page, which forwards once the hash is gone */ }
        setTimeout(() => { window.location.href = dest; }, 1000);
      } else {
        setErr(data.error || 'Could not reset password.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md px-6">
      <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">
        {mode === 'reset' ? 'Reset password' : mode === 'forgot' ? 'Forgot password' : 'Seller sign in'}
      </p>
      <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-2">
        {mode === 'reset' ? 'Pick a new password.' : mode === 'forgot' ? 'Send me a reset link.' : 'Welcome back.'}
      </h1>
      <p className="text-sm text-ink-2 mb-8">
        {mode === 'reset'
          ? (resetDone
              ? 'All set. Taking you to your dashboard.'
              : 'You arrived here from the email link. Enter your new password and we will sign you straight in.')
          : mode === 'forgot'
            ? 'Enter the email on your seller account and we will email a reset link.'
            : (<>
                New to VIA?{' '}
                <Link href="/onboard?role=seller" className="text-ink underline hover:no-underline">
                  Onboard a seller &rarr;
                </Link>
              </>)}
      </p>

      {err && (
        <div className="border border-[color:var(--danger)] bg-[color:var(--danger)]/10 text-[color:var(--danger)] text-sm px-4 py-3 mb-6">{err}</div>
      )}
      {msg && (
        <div className="border border-[color:var(--live)] bg-[color:var(--live)]/10 text-[color:var(--live)] text-sm px-4 py-3 mb-6">{msg}</div>
      )}

      {mode === 'login' && (
        <form onSubmit={handleLogin} className="space-y-5">
          <Field label="Email">
            <input
              type="email" required autoComplete="email" spellCheck={false}
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-paper border border-line-strong px-4 py-3 font-mono text-sm focus:outline-none focus:border-ink transition-colors"
            />
          </Field>
          <Field label="Password">
            <input
              type="password" required autoComplete="current-password"
              value={pass} onChange={(e) => setPass(e.target.value)}
              className="w-full bg-paper border border-line-strong px-4 py-3 font-mono text-sm focus:outline-none focus:border-ink transition-colors"
            />
          </Field>
          <div className="flex items-center justify-between">
            <button
              type="button" onClick={() => { setMode('forgot'); setErr(''); setMsg(''); }}
              className="text-[10px] font-mono uppercase tracking-widest text-ink-2 underline hover:no-underline"
            >
              Forgot password?
            </button>
          </div>
          <button type="submit" disabled={loading} className="btn w-full justify-center disabled:opacity-50">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}

      {mode === 'forgot' && (
        <form onSubmit={handleForgot} className="space-y-5">
          <Field label="Email">
            <input
              type="email" required autoComplete="email" spellCheck={false}
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-paper border border-line-strong px-4 py-3 font-mono text-sm focus:outline-none focus:border-ink transition-colors"
            />
          </Field>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button" onClick={() => { setMode('login'); setErr(''); setMsg(''); }}
              className="text-[10px] font-mono uppercase tracking-widest text-ink-2 underline hover:no-underline"
            >
              <span aria-hidden>&larr;</span> Back to sign in
            </button>
            <button type="submit" disabled={loading} className="btn justify-center disabled:opacity-50">
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </div>
        </form>
      )}

      {mode === 'reset' && !resetDone && (
        <form onSubmit={handleReset} className="space-y-5">
          <Field label="New password">
            <input
              type="password" required minLength={8} autoComplete="new-password"
              value={newPass} onChange={(e) => setNewPass(e.target.value)}
              className="w-full bg-paper border border-line-strong px-4 py-3 font-mono text-sm focus:outline-none focus:border-ink transition-colors"
            />
          </Field>
          <button type="submit" disabled={loading || !accessToken} className="btn w-full justify-center disabled:opacity-50">
            {loading ? 'Updating…' : 'Update password'}
          </button>
          {!accessToken && (
            <p className="text-xs text-[color:var(--warning)]">
              The reset link is missing its token. Request a new one from the forgot-password screen.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-mono tracking-widest text-ink-3 uppercase mb-2">{label}</div>
      {children}
    </div>
  );
}

export default function SellerLoginPage() {
  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home"><Wordmark /></Link>
          <span className="text-xs font-mono tracking-widest uppercase text-ink-3">Seller</span>
        </div>
      </header>

      <section className="flex-1 flex items-start justify-center px-6 py-16">
        <Suspense fallback={
          <p className="text-xs font-mono uppercase tracking-widest text-ink-3">Loading…</p>
        }>
          <SellerLoginInner />
        </Suspense>
      </section>
    </main>
  );
}
