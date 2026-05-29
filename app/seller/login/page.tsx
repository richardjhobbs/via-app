'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import HelpTip from '@/components/app/HelpTip';
import { brandLogin } from '@/lib/app/help-content';

// ── Types ──────────────────────────────────────────────────────────────
interface PendingBrand {
  id: string;
  name: string;
  slug: string;
}

// ── Main Page ──────────────────────────────────────────────────────────
function BrandLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isReset = searchParams.get('reset') === 'true';
  const accessToken  = searchParams.get('access_token');
  const refreshToken = searchParams.get('refresh_token');

  const [mode, setMode] = useState<'login' | 'register' | 'pending' | 'forgot' | 'reset'>(
    isReset && accessToken ? 'reset' : 'login',
  );
  const [walletMode, setWalletMode] = useState<'choose' | 'own' | 'new'>('choose');
  const [sellerName,  setBrandName]  = useState('');
  const [ownWallet,  setOwnWallet]  = useState('');
  const [appText,    setAppText]    = useState('');
  const [pendingBrand, setPendingBrand] = useState<PendingBrand | null>(null);

  // Legacy login
  const [showLegacy,  setShowLegacy]  = useState(false);
  const [legacyEmail, setLegacyEmail] = useState('');
  const [legacyPass,  setLegacyPass]  = useState('');

  // Email/password registration (alternative to Google)
  const [showEmailRegister, setShowEmailRegister] = useState(false);
  const [regEmail,       setRegEmail]       = useState('');
  const [regPass,        setRegPass]        = useState('');
  const [emailRegWallet, setEmailRegWallet] = useState(''); // only used when walletMode === 'new'

  // Forgot/reset password
  const [email,   setEmail]   = useState('');
  const [newPass, setNewPass] = useState('');

  const [err,     setErr]     = useState('');
  const [msg,     setMsg]     = useState('');
  const [loading, setLoading] = useState(false);
  const submittedRef = useRef(false);

  // ── Check if already logged in ──────────────────────────────────────
  useEffect(() => {
    fetch('/api/seller/auth/check')
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated && d.brands?.length > 0) {
          router.push(`/seller/${d.brands[0].sellerSlug}/admin`);
        } else if (d.authenticated && d.pendingBrand) {
          setPendingBrand(d.pendingBrand);
          setMode('pending');
        }
      })
      .catch(() => {});
  }, [router]);

  // ── Email/password registration ─────────────────────────────────────
  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sellerName.trim()) {
      setErr('Please enter your brand name');
      return;
    }
    const effectiveWallet = walletMode === 'own' ? ownWallet.trim() : emailRegWallet.trim();
    if (!effectiveWallet) {
      setErr('Please enter a wallet address');
      return;
    }
    setErr('');
    setLoading(true);
    submittedRef.current = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let res: Response;
    try {
      res = await fetch('/api/seller/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: regEmail,
          password: regPass,
          wallet: effectiveWallet,
          sellerName: sellerName.trim(),
          applicationText: appText.trim(),
        }),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      setErr('Registration timed out, please refresh and try again.');
      setLoading(false);
      submittedRef.current = false;
      return;
    }
    clearTimeout(timeout);
    const data = await res.json();
    setLoading(false);

    if (res.ok && data.brand) {
      setPendingBrand(data.brand);
      setMode('pending');
    } else {
      setErr(data.error || 'Registration failed');
      submittedRef.current = false;
    }
  };

  // ── Legacy email/password login ─────────────────────────────────────
  const handleLegacyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setLoading(true);

    const res = await fetch('/api/seller/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: legacyEmail, password: legacyPass }),
    });
    const data = await res.json();
    setLoading(false);

    if (res.ok && data.brands?.length > 0) {
      router.push(`/seller/${data.brands[0].sellerSlug}/admin`);
    } else {
      setErr(data.error || 'Login failed');
    }
  };

  // ── Forgot password ─────────────────────────────────────────────────
  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    setLoading(true);

    const res = await fetch('/api/seller/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    setLoading(false);

    if (res.ok) {
      setMsg(data.message);
    } else {
      setErr(data.error || 'Failed');
    }
  };

  // ── Reset password ──────────────────────────────────────────────────
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    setLoading(true);

    const res = await fetch('/api/seller/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        password: newPass,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (res.ok) {
      setMsg('Password updated. Redirecting…');
      setTimeout(() => router.push('/seller/login'), 1500);
    } else {
      setErr(data.error || 'Failed to reset password');
    }
  };

  // ── Switch modes ────────────────────────────────────────────────────
  const switchMode = (newMode: 'login' | 'register') => {
    setMode(newMode);
    setWalletMode('choose');
    setErr('');
    setMsg('');
    setShowLegacy(false);
    setShowEmailRegister(false);
    setRegEmail('');
    setRegPass('');
    setEmailRegWallet('');
    submittedRef.current = false;
  };

  return (
    <div className="w-full max-w-sm px-6">
      <a href="/rrg" className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-green-400 transition-colors mb-6">
        &larr; Back to Store
      </a>
      <h1 className="text-sm font-mono uppercase tracking-[0.3em] text-white/60 mb-8">
        Brand Partner
      </h1>

      {/* ── PENDING STATE ── */}
      {mode === 'pending' && (
        <div className="space-y-6">
          <div className="border border-yellow-500/30 bg-yellow-500/5 p-6">
            <h2 className="text-sm font-mono uppercase tracking-wider text-yellow-400 mb-3">
              Application Pending
            </h2>
            {pendingBrand && (
              <p className="text-sm text-white/70 mb-3">
                <strong className="text-white">{pendingBrand.name}</strong>
              </p>
            )}
            <p className="text-sm text-white/50 leading-relaxed">
              Your brand application has been submitted and is under review.
              We&apos;ll notify you by email once it&apos;s approved.
            </p>
          </div>
          <button
            type="button"
            onClick={() => switchMode('login')}
            className="w-full text-sm text-white/30 hover:text-white/60 transition-colors font-mono"
          >
            ← Back to login
          </button>
        </div>
      )}

      {/* ── LOGIN MODE ── */}
      {mode === 'login' && (
        <div className="space-y-4">
          {/* Register CTA: most prominent, first in view */}
          <button
            type="button"
            onClick={() => switchMode('register')}
            className="w-full py-4 bg-white text-black text-base font-medium hover:bg-white/90 transition-all"
          >
            Apply as a brand partner →
          </button>

          <div className="flex flex-col items-center gap-1 py-2">
            <span className="text-sm font-mono text-white/70">Are you already registered?</span>
            <span className="text-white/50 text-base">↓</span>
          </div>

          {loading && (
            <p className="text-sm font-mono text-white/50 animate-pulse">Signing in…</p>
          )}

          {err && <p className="text-amber-400 text-sm font-mono">{err}</p>}

          {/* Legacy email/password (hidden by default) */}
          {showLegacy ? (
            <form onSubmit={handleLegacyLogin} className="space-y-3 pt-2 border-t border-white/10">
              <div>
                <label className="text-sm font-mono text-white/60 block mb-1">Email</label>
                <input
                  type="email" required value={legacyEmail}
                  onChange={(e) => setLegacyEmail(e.target.value)}
                  className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                             focus:border-white outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-sm font-mono text-white/60 block mb-1">Password</label>
                <input
                  type="password" required value={legacyPass}
                  onChange={(e) => setLegacyPass(e.target.value)}
                  className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                             focus:border-white outline-none transition-colors"
                />
              </div>
              <button
                type="submit" disabled={loading}
                className="w-full py-3 border border-white/20 text-base text-white/80 hover:text-white
                           hover:border-white/40 disabled:opacity-40 transition-all"
              >
                {loading ? 'Logging in…' : 'Login →'}
              </button>
              <button
                type="button"
                onClick={() => { setMode('forgot'); setErr(''); setMsg(''); }}
                className="w-full text-xs text-white/30 hover:text-white/60 transition-colors font-mono"
              >
                Forgot password?
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowLegacy(true)}
              className="text-sm font-mono text-white/30 hover:text-white/50 transition-colors"
            >
              Login with email/password →
            </button>
          )}
        </div>
      )}

      {/* ── REGISTER: WALLET CHOICE (skip straight to own wallet) ── */}
      {mode === 'register' && walletMode === 'choose' && (
        <div className="space-y-4">
          <p className="text-sm text-white/60 mb-2">
            Brands need their own wallet for receiving revenue. This should be a business wallet separate from any personal wallets.
          </p>

          <button
            type="button"
            onClick={() => setWalletMode('own')}
            className="w-full py-4 border border-white/20 text-base text-white/80
                       hover:border-white/50 hover:text-white transition-all text-left px-5"
          >
            <span className="block font-medium">Continue with registration</span>
            <span className="block text-sm text-white/40 mt-1">
              You&apos;ll enter your brand wallet address in the next step
            </span>
          </button>

          <p className="text-xs text-white/30 leading-relaxed">
            If you need help creating a wallet, contact us at{' '}
            <a href="mailto:contact@getvia.xyz" className="text-green-400 hover:text-green-300 transition-colors">
              contact@getvia.xyz
            </a>
          </p>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="w-full text-sm text-white/50 hover:text-white/80 transition-colors font-mono"
            >
              &larr; Already have an account? Login
            </button>
          </div>
        </div>
      )}

      {/* ── REGISTER: DETAILS + AUTH ── */}
      {mode === 'register' && walletMode !== 'choose' && (
        <div className="space-y-4">
          <p className="text-sm font-mono text-white/50 mb-2">
            Enter your brand details and wallet address, then sign in with Google.
          </p>

          {/* Brand Name */}
          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Brand Name <HelpTip {...brandLogin.sellerName} /></label>
            <input
              type="text" value={sellerName}
              onChange={(e) => { setBrandName(e.target.value); setErr(''); }}
              className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                         focus:border-white outline-none transition-colors"
              placeholder="Your brand name"
              autoFocus
            />
          </div>

          {/* Wallet Address: always required for brands */}
          <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Wallet Address <HelpTip {...brandLogin.walletChoice} /></label>
              <input
                type="text" value={ownWallet}
                onChange={(e) => { setOwnWallet(e.target.value); setErr(''); }}
                className="w-full bg-transparent border border-white/20 px-4 py-3 text-base font-mono
                           focus:border-white outline-none transition-colors"
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-sm text-white/30 mt-1">
                This is where your revenue share will be sent. Use a business wallet, not a personal one.
              </p>
              <p className="text-xs text-white/25 mt-1">
                Need help?{' '}
                <a href="mailto:contact@getvia.xyz" className="text-green-400 hover:text-green-300 transition-colors">
                  contact@getvia.xyz
                </a>
              </p>
            </div>

          {/* Application Text */}
          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">
              Tell us about your brand <HelpTip {...brandLogin.applicationText} />
            </label>
            <textarea
              value={appText}
              onChange={(e) => setAppText(e.target.value)}
              className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                         focus:border-white outline-none transition-colors resize-none"
              rows={3}
              placeholder="What does your brand do? Why do you want to partner with RRG?"
            />
          </div>

          {/* Email/password registration */}
          <>
          <div className="relative flex items-center gap-3">
            <div className="flex-1 border-t border-white/10" />
            <span className="text-xs font-mono text-white/30">or</span>
            <div className="flex-1 border-t border-white/10" />
          </div>

          {showEmailRegister ? (
            <form onSubmit={handleEmailRegister} className="space-y-3">
              <div>
                <label className="text-sm font-mono text-white/60 block mb-1">Email</label>
                <input
                  type="email" required value={regEmail}
                  onChange={(e) => { setRegEmail(e.target.value); setErr(''); }}
                  className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                             focus:border-white outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-sm font-mono text-white/60 block mb-1">Password</label>
                <input
                  type="password" required minLength={8} value={regPass}
                  onChange={(e) => { setRegPass(e.target.value); setErr(''); }}
                  className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                             focus:border-white outline-none transition-colors"
                  placeholder="Min 8 characters"
                />
              </div>
              <button
                type="submit" disabled={loading}
                className="w-full py-3 border border-white/20 text-base text-white/80 hover:text-white
                           hover:border-white/40 disabled:opacity-40 transition-all"
              >
                {loading ? 'Submitting application…' : 'Apply →'}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowEmailRegister(true)}
              className="w-full text-sm font-mono text-white/40 hover:text-white/60 transition-colors text-center"
            >
              Apply with email/password instead →
            </button>
          )}
          </>

          {loading && !showEmailRegister && (
            <p className="text-sm font-mono text-white/50 animate-pulse">Submitting application…</p>
          )}

          {err && <p className="text-red-400 text-sm font-mono">{err}</p>}

          <div className="pt-2 flex gap-4">
            <button
              type="button"
              onClick={() => { setWalletMode('choose'); setErr(''); submittedRef.current = false; }}
              className="text-sm text-white/50 hover:text-white/80 transition-colors font-mono"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="text-sm text-white/50 hover:text-white/80 transition-colors font-mono"
            >
              Already have an account? Login
            </button>
          </div>
        </div>
      )}

      {/* ── FORGOT PASSWORD ── */}
      {mode === 'forgot' && (
        <form onSubmit={handleForgot} className="space-y-4">
          <p className="text-xs text-white/50 mb-4">
            Enter your email and we&apos;ll send a reset link.
          </p>
          <input
            type="email" required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full bg-transparent border border-white/20 px-4 py-3 text-sm
                       focus:border-white outline-none transition-colors placeholder:text-white/20"
            autoFocus
          />
          {err && <p className="text-red-400 text-xs font-mono">{err}</p>}
          {msg && <p className="text-green-400 text-xs font-mono">{msg}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-white text-black text-sm font-medium hover:bg-white/90
                       disabled:opacity-40 transition-all"
          >
            {loading ? 'Sending…' : 'Send Reset Link →'}
          </button>
          <button
            type="button"
            onClick={() => switchMode('login')}
            className="w-full text-xs text-white/30 hover:text-white/60 transition-colors font-mono"
          >
            ← Back to login
          </button>
        </form>
      )}

      {/* ── RESET PASSWORD ── */}
      {mode === 'reset' && (
        <form onSubmit={handleReset} className="space-y-4">
          <p className="text-xs text-white/50 mb-4">
            Choose a new password (min 8 characters).
          </p>
          <input
            type="password" required minLength={8}
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            placeholder="New password"
            className="w-full bg-transparent border border-white/20 px-4 py-3 text-sm
                       focus:border-white outline-none transition-colors placeholder:text-white/20"
            autoFocus
          />
          {err && <p className="text-red-400 text-xs font-mono">{err}</p>}
          {msg && <p className="text-green-400 text-xs font-mono">{msg}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-white text-black text-sm font-medium hover:bg-white/90
                       disabled:opacity-40 transition-all"
          >
            {loading ? 'Updating…' : 'Set New Password →'}
          </button>
        </form>
      )}
    </div>
  );
}

export default function BrandLoginPage() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <Suspense fallback={
        <div className="text-xs font-mono text-white/30">Loading…</div>
      }>
        <BrandLoginInner />
      </Suspense>
    </div>
  );
}
