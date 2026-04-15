'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useActiveWallet, useDisconnect } from 'thirdweb/react';
import dynamic from 'next/dynamic';
import HelpTip from '@/components/rrg/HelpTip';
import { creatorDashboard } from '@/lib/rrg/help-content';

// Lazy-load thirdweb Google auth component (client-only, avoids SSR issues)
const GoogleAuthEmbed = dynamic(
  () => import('@/components/rrg/GoogleAuthEmbed'),
  { ssr: false, loading: () => <div className="h-12 border border-white/10 animate-pulse" /> },
);

// ── Types ──────────────────────────────────────────────────────────────
interface CreatorProfile {
  id: string;
  walletAddress: string;
  displayName: string | null;
  avatarUrl: string | null;
  creatorType: 'human' | 'agent';
  email: string;
  createdAt: string;
}

interface Submission {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
  token_id: number | null;
  edition_size: number | null;
  price_usdc: string | null;
  brand_id: string | null;
  creator_type: string;
  brandName: string;
}

interface Drop {
  id: string;
  title: string;
  token_id: number;
  edition_size: number | null;
  price_usdc: string | null;
  brand_id: string | null;
  approved_at: string;
  brandName: string;
  salesCount: number;
  salesRevenue: number;
}

interface Distribution {
  id: string;
  created_at: string;
  total_usdc: string;
  creator_usdc: string;
  brand_usdc: string;
  platform_usdc: string;
  split_type: string;
  status: string;
  notes: string | null;
  creatorTxHash: string | null;
}

interface EarningsTotals {
  totalEarned: number;
  totalPending: number;
  totalPaid: number;
  totalSales: number;
}

interface ContributorStats {
  total_submissions: number;
  total_approved: number;
  total_rejected: number;
  total_revenue_usdc: string;
  bio: string | null;
  brands_contributed: string[];
}

type Tab = 'submissions' | 'drops' | 'earnings' | 'profile';

// ── Avatar Component ──────────────────────────────────────────────────
function Avatar({
  src,
  name,
  size = 40,
  className = '',
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const initials = (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const colors = [
    'bg-violet-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600',
    'bg-cyan-600', 'bg-indigo-600', 'bg-pink-600', 'bg-teal-600',
  ];
  const colorIdx = (name || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;

  if (src) {
    return (
      <img
        src={src}
        alt={name || 'Avatar'}
        width={size}
        height={size}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 ${colors[colorIdx]} ${className}`}
      style={{ width: size, height: size }}
    >
      <span
        className="font-medium text-white select-none"
        style={{ fontSize: size * 0.4 }}
      >
        {initials}
      </span>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function CreatorDashboard() {
  const [authed,  setAuthed]  = useState<boolean | null>(null);
  const [profile, setProfile] = useState<CreatorProfile | null>(null);

  useEffect(() => {
    // Check for OAuth callback tokens in URL hash (after Google sign-in redirect)
    const hash = window.location.hash;
    if (hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken  = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      // Clear the hash from the URL
      window.history.replaceState(null, '', window.location.pathname);

      if (accessToken) {
        // Exchange OAuth tokens for server-side session cookies
        fetch('/api/creator/auth/oauth-callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.profile) {
              setAuthed(true);
              setProfile(d.profile);
            } else {
              setAuthed(false);
            }
          })
          .catch(() => setAuthed(false));
        return;
      }
    }

    // Normal auth check (cookie-based)
    fetch('/api/creator/auth/check')
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated && d.profile) {
          setAuthed(true);
          setProfile(d.profile);
        } else {
          setAuthed(false);
        }
      })
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-sm font-mono text-white/50">Loading…</p>
      </div>
    );
  }

  if (!authed || !profile) {
    return <AuthPage onLogin={(p) => { setAuthed(true); setProfile(p); }} />;
  }

  return <DashboardPage profile={profile} onLogout={() => { setAuthed(false); setProfile(null); }} />;
}

// ── Auth Page (Login + Register) ───────────────────────────────────────
function AuthPage({ onLogin }: { onLogin: (p: CreatorProfile) => void }) {
  const [mode,        setMode]        = useState<'login' | 'register'>('login');
  const [walletMode,  setWalletMode]  = useState<'choose' | 'own' | 'new'>('choose');
  const [displayName, setDisplayName] = useState('');
  const [creatorType, setCreatorType] = useState<'human' | 'agent'>('human');
  const [ownWallet,   setOwnWallet]   = useState('');
  const [err,         setErr]         = useState('');
  const [loading,     setLoading]     = useState(false);
  const submittedRef = useRef(false); // prevent double-submit

  // Legacy login state (hidden by default)
  const [showLegacy, setShowLegacy] = useState(false);
  const [legacyEmail, setLegacyEmail] = useState('');
  const [legacyPass,  setLegacyPass]  = useState('');

  // Email/password registration (alternative to Google)
  const [showEmailRegister, setShowEmailRegister] = useState(false);
  const [regEmail,      setRegEmail]      = useState('');
  const [regPass,       setRegPass]       = useState('');
  const [emailRegWallet, setEmailRegWallet] = useState(''); // only used when walletMode === 'new'

  // ── Thirdweb connected: auto-login or auto-register ──
  const handleGoogleAuth = useCallback(async (wallet: string, email: string) => {
    if (submittedRef.current || loading) return;
    submittedRef.current = true;
    setErr('');
    setLoading(true);

    // If user chose "own wallet", use that instead of the thirdweb-created one
    const effectiveWallet = (mode === 'register' && walletMode === 'own' && ownWallet.trim())
      ? ownWallet.trim()
      : wallet;

    try {
      if (mode === 'register') {
        if (!displayName.trim()) {
          setErr('Please enter a display name first');
          setLoading(false);
          submittedRef.current = false;
          return;
        }

        if (walletMode === 'own' && !ownWallet.trim()) {
          setErr('Please enter your wallet address');
          setLoading(false);
          submittedRef.current = false;
          return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout
        let res: Response;
        try {
          res = await fetch('/api/creator/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              wallet: effectiveWallet,
              displayName: displayName.trim(),
              creatorType,
              oauthRegistration: true,
            }),
            signal: controller.signal,
          });
        } catch (fetchErr) {
          clearTimeout(timeout);
          setErr('Registration timed out — please refresh the page and try again.');
          setLoading(false);
          submittedRef.current = false;
          return;
        }
        clearTimeout(timeout);
        const data = await res.json();

        if (res.ok && data.profile) {
          onLogin(data.profile);
        } else {
          setErr(data.error || 'Registration failed');
          submittedRef.current = false;
        }
      } else {
        // Login mode
        const res = await fetch('/api/creator/auth/wallet-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet, email }),
        });
        const data = await res.json();

        if (res.ok && data.profile) {
          onLogin(data.profile);
        } else if (res.status === 403) {
          // No account found — this is a new user who clicked "Sign in" instead of "Register".
          // Slide them into registration mode; their thirdweb session is still active so
          // clicking Register with Google will fire immediately.
          submittedRef.current = false;
          setMode('register');
          setWalletMode('choose');
          setErr('No account found — please register below.');
        } else {
          setErr(data.error || 'Login failed');
          submittedRef.current = false;
        }
      }
    } catch {
      setErr('Something went wrong. Please try again.');
      submittedRef.current = false;
    }
    setLoading(false);
  }, [mode, walletMode, ownWallet, displayName, creatorType, loading, onLogin]);

  // ── Email/password registration ──
  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setErr('Please enter a display name first');
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
      res = await fetch('/api/creator/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: regEmail,
          password: regPass,
          wallet: effectiveWallet,
          displayName: displayName.trim(),
          creatorType,
        }),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      setErr('Registration timed out — please refresh and try again.');
      setLoading(false);
      submittedRef.current = false;
      return;
    }
    clearTimeout(timeout);
    const data = await res.json();
    setLoading(false);

    if (res.ok && data.profile) {
      onLogin(data.profile);
    } else {
      setErr(data.error || 'Registration failed');
      submittedRef.current = false;
    }
  };

  // ── Legacy email/password login ──
  const handleLegacyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setLoading(true);

    const res = await fetch('/api/creator/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: legacyEmail, password: legacyPass }),
    });
    const data = await res.json();
    setLoading(false);

    if (res.ok && data.profile) {
      onLogin(data.profile);
    } else {
      setErr(data.error || 'Login failed');
    }
  };

  // Reset submitted ref when switching modes
  const switchMode = (newMode: 'login' | 'register') => {
    setMode(newMode);
    setWalletMode('choose');
    setErr('');
    setShowLegacy(false);
    setShowEmailRegister(false);
    setRegEmail('');
    setRegPass('');
    setEmailRegWallet('');
    submittedRef.current = false;
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="w-full max-w-sm px-6">
        <a href="/rrg" className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-green-400 transition-colors mb-6">
          &larr; Back to Store
        </a>
        <h1 className="text-sm font-mono uppercase tracking-[0.3em] text-white/60 mb-8">
          Creator Partner
        </h1>

        {mode === 'login' ? (
          /* ── LOGIN MODE ── */
          <div className="space-y-4">
            {/* Register CTA — most prominent, first in view */}
            <button
              type="button"
              onClick={() => switchMode('register')}
              className="w-full py-4 bg-white text-black text-base font-medium hover:bg-white/90 transition-all"
            >
              Create an account →
            </button>

            <div className="flex flex-col items-center gap-1 py-2">
              <span className="text-sm font-mono text-white/70">Are you already registered?</span>
              <span className="text-white/50 text-base">↓</span>
            </div>

            {/* Thirdweb Google embed — for existing users only */}
            <GoogleAuthEmbed
              onAuthenticated={handleGoogleAuth}
              buttonLabel="Sign in with Google"
            />

            {loading && (
              <p className="text-sm font-mono text-white/50 animate-pulse">Signing in…</p>
            )}

            {err && <p className="text-amber-400 text-sm font-mono">{err}</p>}

            {/* Legacy email/password — hidden by default */}
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
        ) : walletMode === 'choose' ? (
          /* ── REGISTER: WALLET CHOICE ── */
          <div className="space-y-4">
            <p className="text-sm font-mono text-white/50 mb-2">
              First — do you have a crypto wallet?
            </p>

            <button
              type="button"
              onClick={() => setWalletMode('own')}
              className="w-full py-4 border border-white/20 text-base text-white/80
                         hover:border-white/50 hover:text-white transition-all text-left px-5"
            >
              <span className="block font-medium">I have my own wallet</span>
              <span className="block text-sm text-white/40 mt-1">
                Use your existing wallet address for payouts and purchases
              </span>
            </button>

            <button
              type="button"
              onClick={() => setWalletMode('new')}
              className="w-full py-4 border border-white/20 text-base text-white/80
                         hover:border-white/50 hover:text-white transition-all text-left px-5"
            >
              <span className="block font-medium">Set me up with a wallet</span>
              <span className="block text-sm text-white/40 mt-1">
                We&apos;ll create a wallet for you — linked to your Google account
              </span>
            </button>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="w-full text-sm text-white/50 hover:text-white/80 transition-colors font-mono"
              >
                ← Already have an account? Login
              </button>
            </div>
          </div>
        ) : (
          /* ── REGISTER: DETAILS + AUTH ── */
          <div className="space-y-4">
            <p className="text-sm font-mono text-white/50 mb-2">
              {walletMode === 'own'
                ? 'Enter your details and wallet, then sign in with Google to create your account.'
                : 'Enter your details, then sign in with Google to create your account and wallet.'}
            </p>

            {/* Display Name */}
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Display Name</label>
              <input
                type="text" value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setErr(''); }}
                className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                           focus:border-white outline-none transition-colors"
                placeholder="How you want to be known"
                autoFocus
              />
            </div>

            {/* Creator Type */}
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Creator Type</label>
              <div className="flex gap-4">
                {(['human', 'agent'] as const).map((t) => (
                  <button
                    key={t} type="button"
                    onClick={() => setCreatorType(t)}
                    className={`flex-1 py-2 text-sm font-mono uppercase border transition-all ${
                      creatorType === t
                        ? 'border-white text-white'
                        : 'border-white/20 text-white/50 hover:border-white/50'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Wallet address — only shown for "own wallet" path */}
            {walletMode === 'own' && (
              <div>
                <label className="text-sm font-mono text-white/60 block mb-1">Wallet Address</label>
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
                  This is where your earnings and NFTs will be sent
                </p>
              </div>
            )}

            {/* Google sign-in → auto-register */}
            <div className="pt-2">
              <GoogleAuthEmbed
                onAuthenticated={handleGoogleAuth}
                buttonLabel="Register with Google"
              />
            </div>

            {/* Email/password alternative — only for 'own wallet' path (Google creates the wallet for 'new') */}
            {walletMode === 'own' && (
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
                  {loading ? 'Creating account…' : 'Register →'}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowEmailRegister(true)}
                className="w-full text-sm font-mono text-white/40 hover:text-white/60 transition-colors text-center"
              >
                Register with email/password instead →
              </button>
            )}
            </>
            )}

            {loading && !showEmailRegister && (
              <p className="text-sm font-mono text-white/50 animate-pulse">Creating account…</p>
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
      </div>
    </div>
  );
}

// ── Dashboard Page ─────────────────────────────────────────────────────
function DashboardPage({
  profile,
  onLogout,
}: {
  profile: CreatorProfile;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<Tab>('submissions');
  const activeWallet = useActiveWallet();
  const { disconnect } = useDisconnect();

  const handleLogout = async () => {
    // Disconnect thirdweb wallet first (prevents auto-reconnect on auth page)
    if (activeWallet) {
      disconnect(activeWallet);
    }
    await fetch('/api/creator/auth/logout', { method: 'POST' });
    onLogout();
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <Avatar
              src={profile.avatarUrl}
              name={profile.displayName || profile.email}
              size={48}
            />
            <div>
              <h1 className="text-sm font-mono uppercase tracking-[0.3em] text-white/60 mb-1">
                Creator Partner
              </h1>
              <p className="text-base text-white/80">
                {profile.displayName || profile.email}
                <span className="ml-2 px-2 py-0.5 text-sm font-mono uppercase border border-white/20 text-white/50">
                  {profile.creatorType}
                </span>
              </p>
            </div>
          </div>
          <div className="flex gap-3 items-center">
            <a
              href="/rrg"
              className="text-sm font-mono text-white/50 hover:text-white/80 transition-colors"
            >
              Store
            </a>
            <button
              onClick={handleLogout}
              className="text-sm font-mono text-white/50 hover:text-red-400 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 border-b border-white/10 mb-8">
          {(['submissions', 'drops', 'earnings', 'profile'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 text-sm font-mono uppercase tracking-widest transition-all ${
                tab === t
                  ? 'text-white border-b-2 border-white'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'submissions' && <><div className="flex items-center gap-2 mb-4"><h2 className="text-xs font-mono text-white/40 uppercase tracking-widest">My Submissions</h2><HelpTip {...creatorDashboard.submissions} /></div><SubmissionsTab wallet={profile.walletAddress} /></>}
        {tab === 'drops'       && <><div className="flex items-center gap-2 mb-4"><h2 className="text-xs font-mono text-white/40 uppercase tracking-widest">My Drops</h2><HelpTip {...creatorDashboard.drops} /></div><DropsTab wallet={profile.walletAddress} /></>}
        {tab === 'earnings'    && <><div className="flex items-center gap-2 mb-4"><h2 className="text-xs font-mono text-white/40 uppercase tracking-widest">Earnings</h2><HelpTip {...creatorDashboard.earnings} /></div><EarningsTab wallet={profile.walletAddress} /></>}
        {tab === 'profile'     &&<><div className="flex items-center gap-2 mb-4"><h2 className="text-xs font-mono text-white/40 uppercase tracking-widest">Profile</h2><HelpTip {...creatorDashboard.profile} /></div><ProfileTab profile={profile} /></>}
      </div>
    </div>
  );
}

// ── Submissions Tab ────────────────────────────────────────────────────
function SubmissionsTab({ wallet }: { wallet: string }) {
  const [items,   setItems]   = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/creator/submissions')
      .then((r) => r.json())
      .then((d) => setItems(d.submissions || []))
      .finally(() => setLoading(false));
  }, [wallet]);

  const statusColor = (s: string) => {
    if (s === 'approved') return 'text-green-400 border-green-400/30';
    if (s === 'rejected') return 'text-red-400 border-red-400/30';
    return 'text-amber-400 border-amber-400/30';
  };

  if (loading) return <p className="text-sm font-mono text-white/50">Loading…</p>;
  if (items.length === 0) return <p className="text-sm font-mono text-white/40">No submissions yet.</p>;

  return (
    <div className="space-y-3">
      {items.map((s) => (
        <div key={s.id} className="border border-white/10 p-4 flex justify-between items-start">
          <div>
            <h3 className="text-base font-medium">{s.title}</h3>
            <p className="text-sm text-white/60 font-mono mt-1">
              {s.brandName} · {new Date(s.created_at).toLocaleDateString()}
              {s.token_id != null && ` · Token #${s.token_id}`}
              {s.price_usdc && ` · $${parseFloat(s.price_usdc).toFixed(2)}`}
            </p>
          </div>
          <span className={`text-sm font-mono uppercase px-2 py-0.5 border ${statusColor(s.status)}`}>
            {s.status}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Drops Tab ──────────────────────────────────────────────────────────
function DropsTab({ wallet }: { wallet: string }) {
  const [items,   setItems]   = useState<Drop[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/creator/drops')
      .then((r) => r.json())
      .then((d) => setItems(d.drops || []))
      .finally(() => setLoading(false));
  }, [wallet]);

  if (loading) return <p className="text-sm font-mono text-white/50">Loading…</p>;
  if (items.length === 0) return <p className="text-sm font-mono text-white/40">No approved drops yet.</p>;

  const totalRevenue = items.reduce((sum, d) => sum + d.salesRevenue, 0);
  const totalSales   = items.reduce((sum, d) => sum + d.salesCount, 0);

  return (
    <div>
      {/* Summary */}
      <div className="mb-6 p-4 border border-white/10 grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-sm font-mono text-white/50 mb-1">Drops</p>
          <p className="text-base font-medium">{items.length}</p>
        </div>
        <div>
          <p className="text-sm font-mono text-white/50 mb-1">Total Sales</p>
          <p className="text-base font-medium">{totalSales}</p>
        </div>
        <div>
          <p className="text-sm font-mono text-white/50 mb-1">Gross Revenue</p>
          <p className="text-base font-medium text-green-400">${totalRevenue.toFixed(2)}</p>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {items.map((d) => (
          <div key={d.id} className="border border-white/10 p-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-medium">
                  <a href={`/rrg/drop/${d.token_id}`} className="hover:underline">
                    {d.title}
                  </a>
                </h3>
                <p className="text-sm text-white/60 font-mono mt-1">
                  Token #{d.token_id} · {d.brandName} · ${parseFloat(d.price_usdc ?? '0').toFixed(2)}
                  · {d.edition_size ?? '∞'} editions
                </p>
              </div>
              <div className="text-right">
                <p className="text-base font-medium text-green-400">{d.salesCount} sold</p>
                <p className="text-sm text-white/60 font-mono">${d.salesRevenue.toFixed(2)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Earnings Tab ───────────────────────────────────────────────────────
function EarningsTab({ wallet }: { wallet: string }) {
  const [items,   setItems]   = useState<Distribution[]>([]);
  const [totals,  setTotals]  = useState<EarningsTotals | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/creator/earnings')
      .then((r) => r.json())
      .then((d) => {
        setItems(d.distributions || []);
        setTotals(d.totals || null);
      })
      .finally(() => setLoading(false));
  }, [wallet]);

  const splitLabel = (s: string) => {
    const labels: Record<string, string> = {
      'challenge_35_35_30':  '35/35/30',
      'brand_product_tiered': 'Tiered',
      'brand_product_70_30': '70/30',
      'rrg_challenge_35_65': '35/65',
      'legacy_70_30':        'Legacy',
    };
    return labels[s] || s;
  };

  const statusColor = (s: string) => {
    if (s === 'completed') return 'text-green-400 border-green-400/30';
    if (s === 'failed')    return 'text-red-400 border-red-400/30';
    return 'text-amber-400 border-amber-400/30';
  };

  if (loading) return <p className="text-sm font-mono text-white/50">Loading…</p>;

  return (
    <div>
      {/* Summary */}
      {totals && (
        <div className="mb-6 p-4 border border-white/10 grid grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-sm font-mono text-white/50 mb-1">Total Sales</p>
            <p className="text-base font-medium">{totals.totalSales}</p>
          </div>
          <div>
            <p className="text-sm font-mono text-white/50 mb-1">Total Earned</p>
            <p className="text-base font-medium text-green-400">${totals.totalEarned.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm font-mono text-white/50 mb-1">Paid Out</p>
            <p className="text-base font-medium">${totals.totalPaid.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm font-mono text-white/50 mb-1">Pending</p>
            <p className="text-base font-medium text-amber-400">${totals.totalPending.toFixed(2)}</p>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm font-mono text-white/40">No earnings yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <div key={d.id} className="border border-white/10 p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm text-white/60 font-mono">
                    {new Date(d.created_at).toLocaleDateString()} · {splitLabel(d.split_type)}
                  </p>
                  <p className="text-base mt-1">
                    Your share: <span className="text-green-400 font-medium">${parseFloat(d.creator_usdc).toFixed(2)}</span>
                    <span className="text-white/50 ml-2">of ${parseFloat(d.total_usdc).toFixed(2)} total</span>
                  </p>
                  {d.creatorTxHash && d.status === 'completed' && (
                    <a
                      href={`https://basescan.org/tx/${d.creatorTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-mono text-blue-400 hover:underline mt-1 inline-block"
                    >
                      View on Basescan ↗
                    </a>
                  )}
                </div>
                <span className={`text-sm font-mono uppercase px-2 py-0.5 border ${statusColor(d.status)}`}>
                  {d.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Profile Tab ────────────────────────────────────────────────────────
function ProfileTab({ profile }: { profile: CreatorProfile }) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [bio,         setBio]         = useState('');
  const [avatarUrl,   setAvatarUrl]   = useState(profile.avatarUrl ?? null);
  const [stats,       setStats]       = useState<ContributorStats | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const [msg,         setMsg]         = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/creator/profile')
      .then((r) => r.json())
      .then((d) => {
        setStats(d.stats);
        if (d.stats?.bio) setBio(d.stats.bio);
        if (d.stats?.avatar_url) setAvatarUrl(d.stats.avatar_url);
      });
  }, []);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setMsg('Error: Avatar must be under 2 MB');
      return;
    }

    setUploading(true);
    setMsg('');

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const res = await fetch('/api/creator/profile', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (res.ok && data.avatarUrl) {
        setAvatarUrl(data.avatarUrl);
        setMsg('Avatar updated');
      } else {
        setMsg(`Error: ${data.error || 'Upload failed'}`);
      }
    } catch {
      setMsg('Error: Avatar upload failed');
    }
    setUploading(false);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');

    const res = await fetch('/api/creator/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, bio }),
    });

    setSaving(false);
    if (res.ok) {
      setMsg('Profile updated');
    } else {
      const data = await res.json();
      setMsg(`Error: ${data.error}`);
    }
  };

  return (
    <div className="max-w-lg">
      {/* Stats */}
      {stats && (
        <div className="mb-8 p-4 border border-white/10 grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-sm font-mono text-white/50 mb-1">Submissions</p>
            <p className="text-base font-medium">{stats.total_submissions}</p>
          </div>
          <div>
            <p className="text-sm font-mono text-white/50 mb-1">Approved</p>
            <p className="text-base font-medium text-green-400">{stats.total_approved}</p>
          </div>
          <div>
            <p className="text-sm font-mono text-white/50 mb-1">Lifetime Earnings</p>
            <p className="text-base font-medium text-green-400">
              ${parseFloat(stats.total_revenue_usdc || '0').toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {/* Avatar */}
      <div className="mb-8 flex items-center gap-6">
        <Avatar
          src={avatarUrl}
          name={displayName || profile.email}
          size={80}
        />
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleAvatarUpload}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 text-sm font-mono border border-white/20 text-white/80
                       hover:border-white/50 hover:text-white disabled:opacity-40 transition-all"
          >
            {uploading ? 'Uploading…' : avatarUrl ? 'Change Avatar' : 'Upload Avatar'}
          </button>
          <p className="text-sm text-white/30 mt-1 font-mono">JPEG, PNG, or WebP · Max 2 MB</p>
        </div>
      </div>

      {/* Info */}
      <div className="mb-6 space-y-2">
        <div className="flex justify-between text-sm font-mono">
          <span className="text-white/60">Wallet</span>
          <span className="text-white/80">{profile.walletAddress}</span>
        </div>
        <div className="flex justify-between text-sm font-mono">
          <span className="text-white/60">Email</span>
          <span className="text-white/80">{profile.email}</span>
        </div>
        <div className="flex justify-between text-sm font-mono">
          <span className="text-white/60">Type</span>
          <span className="text-white/80 uppercase">{profile.creatorType}</span>
        </div>
        <div className="flex justify-between text-sm font-mono">
          <span className="text-white/60">Joined</span>
          <span className="text-white/80">{profile.createdAt ? new Date(profile.createdAt.replace(' ', 'T')).toLocaleDateString() : '—'}</span>
        </div>
      </div>

      {/* Edit Form */}
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="text-sm font-mono text-white/60 block mb-1">Display Name</label>
          <input
            type="text" value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                       focus:border-white outline-none transition-colors"
          />
        </div>
        <div>
          <label className="text-sm font-mono text-white/60 block mb-1">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            maxLength={2000}
            className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                       focus:border-white outline-none transition-colors resize-none"
          />
        </div>
        {msg && (
          <p className={`text-sm font-mono ${msg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {msg}
          </p>
        )}
        <button
          type="submit" disabled={saving}
          className="px-6 py-2 bg-white text-black text-base font-medium hover:bg-white/90
                     disabled:opacity-40 transition-all"
        >
          {saving ? 'Saving…' : 'Save Profile'}
        </button>
      </form>
    </div>
  );
}
