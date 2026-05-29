'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';

type Mode = 'login' | 'forgot' | 'reset';

interface BrandHit {
  sellerSlug: string;
}

function SellerLoginInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const isReset      = searchParams.get('reset') === 'true';
  const accessToken  = searchParams.get('access_token');
  const refreshToken = searchParams.get('refresh_token');

  const [mode,    setMode]    = useState<Mode>(isReset && accessToken ? 'reset' : 'login');
  const [email,   setEmail]   = useState('');
  const [pass,    setPass]    = useState('');
  const [newPass, setNewPass] = useState('');
  const [err,     setErr]     = useState('');
  const [msg,     setMsg]     = useState('');
  const [loading, setLoading] = useState(false);

  // If a session cookie is already present, send them to their seller dashboard.
  useEffect(() => {
    fetch('/api/seller/auth/check', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        if (d.authenticated && Array.isArray(d.brands) && d.brands.length > 0) {
          const first = (d.brands as BrandHit[])[0];
          router.push(`/seller/${first.sellerSlug}/admin`);
        }
      })
      .catch(() => {});
  }, [router]);

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
        router.push(`/seller/${(data.brands as BrandHit[])[0].sellerSlug}/admin`);
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
        setMsg('Password updated. Signing you in.');
        setTimeout(() => router.push('/seller/login'), 1200);
      } else {
        setErr(data.error || 'Could not reset password.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md px-6">
      <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">
        {mode === 'reset' ? 'Reset password' : mode === 'forgot' ? 'Forgot password' : 'Seller sign in'}
      </p>
      <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-2">
        {mode === 'reset' ? 'Pick a new password.' : mode === 'forgot' ? 'Send me a reset link.' : 'Welcome back.'}
      </h1>
      <p className="text-sm text-neutral-600 mb-8">
        {mode === 'reset'
          ? 'You arrived here from the email link. Enter your new password and we will sign you straight in.'
          : mode === 'forgot'
            ? 'Enter the email on your seller account and we will email a reset link.'
            : (<>
                New to VIA?{' '}
                <Link href="/onboard?role=seller" className="text-neutral-900 underline hover:no-underline">
                  Onboard a seller &rarr;
                </Link>
              </>)}
      </p>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md px-4 py-3 mb-6">{err}</div>
      )}
      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md px-4 py-3 mb-6">{msg}</div>
      )}

      {mode === 'login' && (
        <form onSubmit={handleLogin} className="space-y-5">
          <Field label="Email">
            <input
              type="email" required autoComplete="email" spellCheck={false}
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white border border-neutral-300 rounded-md px-4 py-3 font-mono text-sm focus:outline-none focus:border-neutral-900"
            />
          </Field>
          <Field label="Password">
            <input
              type="password" required autoComplete="current-password"
              value={pass} onChange={(e) => setPass(e.target.value)}
              className="w-full bg-white border border-neutral-300 rounded-md px-4 py-3 font-mono text-sm focus:outline-none focus:border-neutral-900"
            />
          </Field>
          <div className="flex items-center justify-between">
            <button
              type="button" onClick={() => { setMode('forgot'); setErr(''); setMsg(''); }}
              className="text-[10px] font-mono uppercase tracking-widest text-neutral-700 underline hover:no-underline"
            >
              Forgot password?
            </button>
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md disabled:opacity-50"
          >
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
              className="w-full bg-white border border-neutral-300 rounded-md px-4 py-3 font-mono text-sm focus:outline-none focus:border-neutral-900"
            />
          </Field>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button" onClick={() => { setMode('login'); setErr(''); setMsg(''); }}
              className="text-[10px] font-mono uppercase tracking-widest text-neutral-700 underline hover:no-underline"
            >
              <span aria-hidden>&larr;</span> Back to sign in
            </button>
            <button
              type="submit" disabled={loading}
              className="px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </div>
        </form>
      )}

      {mode === 'reset' && (
        <form onSubmit={handleReset} className="space-y-5">
          <Field label="New password">
            <input
              type="password" required minLength={8} autoComplete="new-password"
              value={newPass} onChange={(e) => setNewPass(e.target.value)}
              className="w-full bg-white border border-neutral-300 rounded-md px-4 py-3 font-mono text-sm focus:outline-none focus:border-neutral-900"
            />
          </Field>
          <button
            type="submit" disabled={loading || !accessToken}
            className="w-full px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md disabled:opacity-50"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
          {!accessToken && (
            <p className="text-xs text-amber-700">
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
      <div className="text-xs font-mono tracking-widest text-neutral-500 uppercase mb-2">{label}</div>
      {children}
    </div>
  );
}

export default function SellerLoginPage() {
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
          </Link>
          <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">Seller</span>
        </div>
      </header>

      <section className="flex-1 flex items-start justify-center px-6 py-16">
        <Suspense fallback={
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">Loading…</p>
        }>
          <SellerLoginInner />
        </Suspense>
      </section>
    </main>
  );
}
