'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ConnectEmbed, useActiveAccount } from 'thirdweb/react';
import { base } from 'thirdweb/chains';
import { inAppWallet, createWallet } from 'thirdweb/wallets';
import { thirdwebClient } from '@/lib/rrg/thirdwebClient';
import CreatorTermsModal from '@/components/rrg/CreatorTermsModal';
import { CREATOR_TC_VERSION, DFW_CREATOR_TC_VERSION, DFW_BRAND_ID } from '@/lib/rrg/terms';

interface Brief {
  title: string;
  description: string;
  deadline?: string;
}

type Status = 'idle' | 'submitting' | 'success' | 'error';

interface SubmitFormProps {
  brandId: string;
  brandSlug: string;
  brandName: string;
  briefId?: string;
}

export default function SubmitForm({ brandId, brandSlug, brandName, briefId }: SubmitFormProps) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    creator_wallet: '',
    creator_email: '',
    suggested_edition: '20',
    suggested_price_usdc: '1',
    creator_bio: '',
  });
  const [jpeg, setJpeg] = useState<File | null>(null);
  const [additionalFiles, setAdditionalFiles] = useState<FileList | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [tcModalOpen, setTcModalOpen] = useState(false);
  const [walletSignupOpen, setWalletSignupOpen] = useState(false);
  const [emailWalletHint, setEmailWalletHint] = useState<{ wallet: string; source: string; name?: string } | null>(null);
  const thirdwebAccount = useActiveAccount();

  // Auto-fill wallet from Thirdweb connection
  useEffect(() => {
    if (thirdwebAccount?.address && !form.creator_wallet) {
      setForm(prev => ({ ...prev, creator_wallet: thirdwebAccount.address }));
      setWalletSignupOpen(false);
    }
  }, [thirdwebAccount, form.creator_wallet]);

  // Email-based wallet lookup (for cross-session detection)
  const checkEmailForWallet = async (email: string) => {
    if (!email || !email.includes('@') || form.creator_wallet) return;
    try {
      const res = await fetch(`/api/rrg/wallet-lookup?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.found && data.wallet) {
          setEmailWalletHint({ wallet: data.wallet, source: data.source, name: data.name });
        }
      }
    } catch {}
  };

  useEffect(() => {
    const url = briefId
      ? `/api/rrg/brief?briefId=${briefId}`
      : `/api/rrg/brief?brandId=${brandId}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => setBrief(d.brief))
      .catch(() => {});
  }, [brandId, briefId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jpeg) { setError('Please attach a JPEG or PNG image.'); return; }

    setStatus('submitting');
    setError('');

    const fd = new FormData();
    fd.append('title', form.title);
    fd.append('description', form.description);
    fd.append('creator_wallet', form.creator_wallet);
    fd.append('creator_email', form.creator_email);
    fd.append('brand_id', brandId);
    if (form.suggested_edition)    fd.append('suggested_edition', form.suggested_edition);
    if (form.suggested_price_usdc) fd.append('suggested_price_usdc', form.suggested_price_usdc);
    if (form.creator_bio)          fd.append('creator_bio', form.creator_bio);
    fd.append('tc_accepted', '1');
    const isDfw = brandId === DFW_BRAND_ID;
    fd.append('tc_version', isDfw ? `DFW-${DFW_CREATOR_TC_VERSION}` : CREATOR_TC_VERSION);
    fd.append('jpeg', jpeg);
    if (additionalFiles) {
      for (let i = 0; i < additionalFiles.length; i++) {
        fd.append('additional_files', additionalFiles[i]);
      }
    }

    try {
      const res = await fetch('/api/rrg/submit', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');
      setStatus('success');
    } catch (err: unknown) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Submission failed');
    }
  };

  if (status === 'success') {
    return (
      <div className="px-6 py-32 max-w-xl mx-auto text-center">
        <div className="text-5xl mb-6 opacity-60">&#10003;</div>
        <h2 className="text-2xl font-light mb-4">Submission received</h2>
        <p className="text-white/60 text-base leading-relaxed mb-10">
          We&apos;ll review your design and notify you at the email provided if it&apos;s
          approved as a listing. This usually takes 2&ndash;5 days.
        </p>
        <Link
          href={`/brand/${brandSlug}`}
          className="text-base border border-white/30 px-6 py-2.5 hover:border-white transition-all"
        >
          &larr; Back to {brandName}
        </Link>
      </div>
    );
  }

  return (
    <div className="px-6 py-12 max-w-2xl mx-auto">

      {/* Brief context */}
      {brief && (
        <div className="mb-10 p-5 border border-white/10 bg-white/[0.03] text-base">
          <p className="font-mono text-sm uppercase tracking-widest text-white/50 mb-1">
            Responding to
          </p>
          <p className="font-medium text-white">{brief.title}</p>
          <div className="text-white/60 mt-1 text-sm leading-relaxed whitespace-pre-line">{brief.description}</div>
        </div>
      )}

      <h1 className="text-2xl font-mono tracking-wider mb-8">Submit a Design</h1>

      <form onSubmit={handleSubmit} className="space-y-7">

        {/* Title */}
        <div>
          <label className="block text-sm font-mono uppercase tracking-[0.2em] text-white/60 mb-2">
            Title *
          </label>
          <input
            type="text"
            required
            maxLength={120}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                       focus:border-white outline-none transition-colors placeholder:text-white/40"
            placeholder="Give your design a title"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-mono uppercase tracking-[0.2em] text-white/60 mb-2">
            Description
          </label>
          <textarea
            rows={4}
            maxLength={1000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                       focus:border-white outline-none transition-colors resize-none placeholder:text-white/40"
            placeholder="Materials, process, inspiration — anything relevant"
          />
        </div>

        {/* Creator Bio */}
        <div>
          <label className="block text-sm font-mono uppercase tracking-[0.2em] text-white/60 mb-2">
            Creator Bio
          </label>
          <textarea
            rows={4}
            maxLength={2000}
            value={form.creator_bio}
            onChange={(e) => setForm({ ...form, creator_bio: e.target.value })}
            className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                       focus:border-white outline-none transition-colors resize-none placeholder:text-white/40"
            placeholder="Tell collectors about yourself — your practice and where to find you online. Tip: [My Portfolio](https://…) creates a clickable link."
          />
          <p className="mt-1.5 text-sm text-white/50 flex justify-between">
            <span>
              Shown on your listing. URLs become clickable links — or use{' '}
              <span className="font-mono text-white/60">[My Site](https://…)</span>
              {' '}for custom link text.
            </span>
            <span className="tabular-nums ml-4 shrink-0">{form.creator_bio.length}/2000</span>
          </p>
        </div>

        {/* Edition + Price suggestions */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-mono uppercase tracking-[0.2em] text-white/60 mb-2">
              Suggested Edition Size
            </label>
            <input
              type="number"
              min={1}
              max={50}
              placeholder="e.g. 20"
              value={form.suggested_edition}
              onChange={(e) => setForm({ ...form, suggested_edition: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                         focus:border-white outline-none transition-colors placeholder:text-white/40"
            />
          </div>
          <div>
            <label className="block text-sm font-mono uppercase tracking-[0.2em] text-white/60 mb-2">
              Proposed Price (USDC)
            </label>
            <input
              type="number"
              min={0.1}
              step={0.01}
              placeholder="e.g. 1"
              value={form.suggested_price_usdc}
              onChange={(e) => setForm({ ...form, suggested_price_usdc: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                         focus:border-white outline-none transition-colors placeholder:text-white/40"
            />
          </div>
        </div>
        <p className="text-sm text-white/50 -mt-4">
          Optional suggestions for the reviewer. Final edition size and price are set on approval.
        </p>

        {/* Main Image */}
        <div>
          <label className="block text-sm font-mono uppercase tracking-[0.2em] text-white/60 mb-2">
            Main Image (JPEG or PNG) *
          </label>
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png"
            required
            onChange={(e) => setJpeg(e.target.files?.[0] || null)}
            className="w-full border border-white/20 px-4 py-3 text-base text-white/70
                       file:mr-4 file:bg-white file:text-black file:border-0
                       file:px-3 file:py-1 file:text-sm file:font-medium file:cursor-pointer
                       file:hover:bg-white/90 transition-all"
          />
          <p className="mt-1.5 text-sm text-white/50">
            JPEG or PNG · max 5 MB · high-resolution preferred
          </p>
        </div>

        {/* Additional files */}
        <div>
          <label className="block text-sm font-mono uppercase tracking-[0.2em] text-white/60 mb-2">
            Additional Files <span className="normal-case tracking-normal text-white/40">(optional)</span>
          </label>
          <input
            type="file"
            multiple
            onChange={(e) => setAdditionalFiles(e.target.files)}
            className="w-full border border-white/20 px-4 py-3 text-base text-white/70
                       file:mr-4 file:bg-white file:text-black file:border-0
                       file:px-3 file:py-1 file:text-sm file:font-medium file:cursor-pointer
                       file:hover:bg-white/90 transition-all"
          />
          <p className="mt-1.5 text-sm text-white/50">
            ZIP, PDF, SVG, AI, PSD etc. · Delivered to buyers post-purchase · max 50 MB total
          </p>
        </div>

        {/* Creator wallet */}
        <div>
          <label className="block text-sm font-mono uppercase tracking-[0.2em] text-white/60 mb-2">
            Creator Wallet (Base) *
          </label>
          <input
            type="text"
            required
            pattern="^0x[0-9a-fA-F]{40}$"
            title="A valid 0x Ethereum address"
            value={form.creator_wallet}
            onChange={(e) => setForm({ ...form, creator_wallet: e.target.value })}
            className="w-full bg-transparent border border-white/20 px-4 py-3 text-base font-mono
                       focus:border-white outline-none transition-colors placeholder:text-white/40"
            placeholder="0x…"
          />
          <p className="mt-1.5 text-sm text-white/50">
            35% of each sale is transferred here as USDC on Base
          </p>
          {/* Email-based wallet hint */}
          {emailWalletHint && !form.creator_wallet && (
            <div className="mt-2 p-3 border border-green-500/30 bg-green-500/5 rounded">
              <p className="text-sm text-green-400 mb-1">
                Found a wallet linked to your email{emailWalletHint.source === 'agent' ? ' (from your agent)' : ''}{emailWalletHint.name ? ` (${emailWalletHint.name})` : ''}
              </p>
              <p className="text-xs font-mono text-white/50 mb-2">
                {emailWalletHint.wallet.slice(0, 10)}...{emailWalletHint.wallet.slice(-8)}
              </p>
              <button
                type="button"
                onClick={() => { setForm(prev => ({ ...prev, creator_wallet: emailWalletHint.wallet })); setEmailWalletHint(null); }}
                className="text-xs bg-green-500 text-black rounded px-3 py-1 font-medium hover:bg-green-400 transition-colors cursor-pointer"
              >
                Use this wallet
              </button>
            </div>
          )}
          {!form.creator_wallet && !emailWalletHint && (
            <div className="mt-3 space-y-2">
              {!walletSignupOpen ? (
                <>
                  <button
                    type="button"
                    onClick={() => setWalletSignupOpen(true)}
                    className="text-sm text-green-400 hover:text-green-300 transition-colors cursor-pointer block"
                  >
                    Don&apos;t have a wallet? Sign up and we&apos;ll create one for you &rarr;
                  </button>
                  <a
                    href="/agents"
                    className="text-sm text-white/40 hover:text-green-400 transition-colors block"
                  >
                    Or create an agent and get a wallet automatically &rarr;
                  </a>
                </>
              ) : (
                <div className="border border-white/10 rounded-lg overflow-hidden">
                  <ConnectEmbed
                    client={thirdwebClient}
                    wallets={[
                      inAppWallet({ auth: { options: ['google', 'email'] } }),
                      createWallet('io.metamask'),
                      createWallet('com.coinbase.wallet'),
                    ]}
                    chain={base}
                    theme="dark"
                    showThirdwebBranding={false}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-mono uppercase tracking-[0.2em] text-white/60 mb-2">
            Contact Email *
          </label>
          <input
            type="email"
            required
            value={form.creator_email}
            onChange={(e) => setForm({ ...form, creator_email: e.target.value })}
            onBlur={(e) => checkEmailForWallet(e.target.value)}
            className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                       focus:border-white outline-none transition-colors placeholder:text-white/40"
            placeholder="you@example.com"
          />
          <p className="mt-1.5 text-sm text-white/50">
            We&apos;ll notify you when your design is approved as a listing
          </p>
        </div>

        {/* Error */}
        {(status === 'error' || error) && (
          <p className="text-red-400 text-base font-mono border border-red-400/20 bg-red-400/5 px-4 py-3">
            {error}
          </p>
        )}

        {/* ── Creator Terms & Conditions ──────────────────── */}
        {termsAccepted ? (
          <div className="p-4 border border-green-400/20 bg-green-400/5 flex items-center justify-between">
            <div>
              <p className="text-sm font-mono text-green-400/80">
                {brandId === DFW_BRAND_ID
                  ? `DFW Taipei Challenge Terms accepted (v${DFW_CREATOR_TC_VERSION})`
                  : `Creator Terms & Conditions accepted (v${CREATOR_TC_VERSION})`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTcModalOpen(true)}
              className="text-sm text-white/50 hover:text-white/80 transition-colors underline"
            >
              Review Terms
            </button>
          </div>
        ) : (
          <div className="p-5 border border-amber-400/40 bg-amber-400/5 space-y-3">
            <p className="text-sm font-mono uppercase tracking-widest text-amber-400">
              Action Required
            </p>
            <p className="text-base text-white/80">
              You must accept the Creator Terms & Conditions before submitting.
            </p>
            <button
              type="button"
              onClick={() => setTcModalOpen(true)}
              className="px-5 py-2 border border-amber-400/60 text-amber-400 text-base font-medium
                         hover:bg-amber-400/10 transition-all"
            >
              Review & Accept Terms
            </button>
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-5 pt-2">
          <button
            type="submit"
            disabled={status === 'submitting' || !termsAccepted}
            className="px-8 py-3 bg-white text-black text-base font-medium
                       hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {status === 'submitting' ? 'Submitting…' : 'Submit Design →'}
          </button>
          <Link href={`/brand/${brandSlug}`} className="text-base text-white/50 hover:text-white transition-colors">
            Cancel
          </Link>
        </div>
        {!termsAccepted && (
          <p className="text-sm text-amber-400/60 -mt-4">
            Accept the Terms & Conditions above to enable submission.
          </p>
        )}
      </form>

      {/* Creator Terms Modal */}
      <CreatorTermsModal
        open={tcModalOpen}
        onClose={() => setTcModalOpen(false)}
        onAccept={() => {
          setTermsAccepted(true);
          setTcModalOpen(false);
        }}
        variant={brandId === DFW_BRAND_ID ? 'dfw' : 'standard'}
      />
    </div>
  );
}
