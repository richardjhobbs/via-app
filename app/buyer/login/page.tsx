'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

function BuyerLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isReset      = searchParams.get('reset') === 'true';
  const accessToken  = searchParams.get('access_token');
  const refreshToken = searchParams.get('refresh_token');

  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>(
    isReset && accessToken ? 'reset' : 'login',
  );

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [newPass,  setNewPass]  = useState('');
  const [err,      setErr]      = useState('');
  const [msg,      setMsg]      = useState('');
  const [loading,  setLoading]  = useState(false);

  // Bounce already-signed-in buyers straight to their dashboard.
  useEffect(() => {
    fetch('/api/buyer/auth/check')
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated && d.buyers?.length > 0) {
          router.push(`/buyer/${d.buyers[0].handle}/admin`);
        }
      })
      .catch(() => {});
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setLoading(true);

    const res = await fetch('/api/buyer/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (res.ok && data.buyers?.length > 0) {
      router.push(`/buyer/${data.buyers[0].handle}/admin`);
    } else {
      setErr(data.error || 'Login failed');
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    setLoading(true);

    const res = await fetch('/api/buyer/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    setLoading(false);

    if (res.ok) setMsg(data.message);
    else setErr(data.error || 'Failed');
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    setLoading(true);

    const res = await fetch('/api/buyer/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, password: newPass }),
    });
    const data = await res.json();
    setLoading(false);

    if (res.ok) {
      setMsg('Password updated. Redirecting…');
      setTimeout(() => router.push('/buyer/login'), 1500);
    } else {
      setErr(data.error || 'Failed to reset password');
    }
  };

  const inputClass =
    'w-full bg-white border border-neutral-300 rounded-md px-4 py-3 text-sm outline-none focus:border-neutral-900 transition-colors';

  return (
    <div className="w-full max-w-sm px-6">
      <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto mb-8 invert" />
      <p className="text-xs font-mono tracking-widest uppercase text-neutral-500 mb-2">Buying Agent</p>

      {mode === 'login' && (
        <form onSubmit={handleLogin} className="space-y-4">
          <h1 className="font-serif text-3xl tracking-tight mb-4">Sign in</h1>
          <div>
            <label className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoFocus />
          </div>
          <div>
            <label className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Password</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </div>
          {err && <p className="text-sm text-red-600 font-mono">{err}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 disabled:opacity-40 transition-colors rounded-md"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => { setMode('forgot'); setErr(''); setMsg(''); }}
              className="text-xs font-mono text-neutral-400 hover:text-neutral-900 transition-colors"
            >
              Forgot password?
            </button>
            <Link href="/onboard?role=buyer" className="text-xs font-mono text-neutral-400 hover:text-neutral-900 transition-colors">
              Create an agent <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        </form>
      )}

      {mode === 'forgot' && (
        <form onSubmit={handleForgot} className="space-y-4">
          <h1 className="font-serif text-3xl tracking-tight mb-2">Reset password</h1>
          <p className="text-sm text-neutral-600 mb-2">Enter your email and we will send a reset link.</p>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className={inputClass} autoFocus />
          {err && <p className="text-sm text-red-600 font-mono">{err}</p>}
          {msg && <p className="text-sm text-emerald-700 font-mono">{msg}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 disabled:opacity-40 transition-colors rounded-md"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
          <button
            type="button"
            onClick={() => { setMode('login'); setErr(''); setMsg(''); }}
            className="w-full text-xs font-mono text-neutral-400 hover:text-neutral-900 transition-colors"
          >
            <span aria-hidden>&larr;</span> Back to sign in
          </button>
        </form>
      )}

      {mode === 'reset' && (
        <form onSubmit={handleReset} className="space-y-4">
          <h1 className="font-serif text-3xl tracking-tight mb-2">New password</h1>
          <p className="text-sm text-neutral-600 mb-2">Choose a new password (8+ characters).</p>
          <input type="password" required minLength={8} value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="New password" className={inputClass} autoFocus />
          {err && <p className="text-sm text-red-600 font-mono">{err}</p>}
          {msg && <p className="text-sm text-emerald-700 font-mono">{msg}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 disabled:opacity-40 transition-colors rounded-md"
          >
            {loading ? 'Updating…' : 'Set new password'}
          </button>
        </form>
      )}
    </div>
  );
}

export default function BuyerLoginPage() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex items-center justify-center">
      <Suspense fallback={<div className="text-xs font-mono text-neutral-400">Loading…</div>}>
        <BuyerLoginInner />
      </Suspense>
    </div>
  );
}
