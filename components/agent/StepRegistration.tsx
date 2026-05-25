'use client';

import { useState, useEffect, useCallback } from 'react';
import { ConnectEmbed, lightTheme, useActiveAccount, useProfiles } from 'thirdweb/react';
import { base } from 'thirdweb/chains';
import { inAppWallet, createWallet } from 'thirdweb/wallets';
import { thirdwebClient } from '@/lib/rrg/thirdwebClient';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TIER_DISPLAY } from '@/lib/agent/types';
import type { WizardState } from '@/lib/agent/types';

interface Props {
  state: WizardState;
  update: (partial: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

const wallets = [
  inAppWallet({ auth: { options: ['google', 'email'] } }),
  createWallet('io.metamask'),
  createWallet('com.coinbase.wallet'),
  createWallet('walletConnect'),
];

const maisonTheme = lightTheme({
  colors: {
    modalBg: '#ffffff',
    primaryText: '#1a1612',
    secondaryText: '#3a342d',
    tertiaryBg: '#f2ede5',
    accentText: '#6b4f3a',
    accentButtonBg: '#1a1612',
    accentButtonText: '#faf7f2',
    primaryButtonBg: '#1a1612',
    primaryButtonText: '#faf7f2',
    secondaryButtonBg: '#faf7f2',
    secondaryButtonText: '#1a1612',
    secondaryButtonHoverBg: '#f2ede5',
    borderColor: 'rgba(26,22,18,0.22)',
    separatorLine: 'rgba(26,22,18,0.12)',
  },
});

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

interface WalletLookup {
  found: boolean;
  wallet?: string;
  source?: 'creator' | 'agent';
  name?: string;
}

// ── Local presentation tokens ──────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-jetbrains), monospace',
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 8,
};

const panelBase: React.CSSProperties = {
  padding: 14,
  border: '1px solid var(--line)',
  background: 'var(--bg-2)',
};
const panelSuccess: React.CSSProperties = {
  padding: 14,
  border: '1px solid var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
};

const heading: React.CSSProperties = {
  fontFamily: 'var(--font-fraunces), serif',
  fontSize: 28,
  fontWeight: 300,
  letterSpacing: '-0.015em',
  margin: '0 0 10px',
  lineHeight: 1.15,
};

const subhead: React.CSSProperties = {
  color: 'var(--ink-2)',
  fontSize: 15,
  lineHeight: 1.55,
  margin: '0 0 28px',
  fontWeight: 300,
  maxWidth: '52ch',
};

export function StepRegistration({ state, update, onNext, onBack }: Props) {
  const [walletMode, setWalletMode] = useState<'new' | 'import'>('new');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [existingCreator, setExistingCreator] = useState<boolean>(false);
  const [existingAgent, setExistingAgent] = useState<{ name: string; tier: string } | null>(null);
  const [emailLookup, setEmailLookup] = useState<WalletLookup | null>(null);
  const [lookupDismissed, setLookupDismissed] = useState(false);
  const account = useActiveAccount();
  const { data: profiles } = useProfiles({ client: thirdwebClient });

  useEffect(() => {
    if (account?.address) {
      update({ wallet_address: account.address, wallet_type: 'embedded' });

      if (profiles) {
        for (const p of profiles) {
          const details = (p as Record<string, unknown>).details as Record<string, string> | undefined;
          if (details?.email && !state.email) {
            update({ email: details.email });
            break;
          }
        }
      }

      fetch(`/api/rrg/creator-check?wallet=${account.address}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.exists) setExistingCreator(true); })
        .catch(() => {});

      fetch(`/api/agent/session?wallet=${account.address}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.agent) {
            setExistingAgent({ name: data.agent.name, tier: data.agent.tier });
          }
        })
        .catch(() => {});
    }
  }, [account?.address, profiles, state.email, update]);

  const checkEmailWallet = useCallback(async (email: string) => {
    if (!email || !email.includes('@')) return;
    setLookupDismissed(false);

    // First: authoritative agent-existence check. The session endpoint
    // returns the canonical agent row (with tier) when one exists for
    // this email, so we can route the user straight to "welcome back"
    // before they spend any more time in the wizard. Pre-flight here
    // is the difference between catching a duplicate at email-blur vs
    // catching it at final submit (4 steps later).
    try {
      const sessionRes = await fetch(`/api/agent/session?email=${encodeURIComponent(email)}`);
      if (sessionRes.ok) {
        const data = await sessionRes.json();
        if (data?.agent) {
          setExistingAgent({
            name: data.agent.name || 'your agent',
            tier: data.agent.tier === 'pro' ? 'pro' : 'basic',
          });
          return;
        }
      }
    } catch {
      // Network blip on preflight: don't block, fall through to creator
      // lookup. The server-side 409 in /api/agent/create is the final
      // backstop.
    }

    try {
      const res = await fetch(`/api/rrg/wallet-lookup?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.found && data.source === 'agent') {
          setExistingAgent({ name: data.name || 'your agent', tier: 'basic' });
        } else if (data.found && data.source === 'creator') {
          setEmailLookup(data);
        } else {
          setEmailLookup(null);
        }
      }
    } catch {
      setEmailLookup(null);
    }
  }, []);

  const useExistingWallet = () => {
    if (emailLookup?.wallet) {
      update({ wallet_address: emailLookup.wallet, wallet_type: 'imported' });
      setWalletMode('import');
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!state.email || !state.email.includes('@')) errs.email = 'Valid email required';
    if (!state.name.trim()) errs.name = 'Name required';
    if (walletMode === 'new' && !state.wallet_address) errs.wallet = 'Connect a wallet to continue';
    if (walletMode === 'import' && !isValidAddress(state.wallet_address)) errs.wallet = 'Valid wallet address required (0x...)';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => {
    if (!validate()) return;
    update({ wallet_type: walletMode === 'new' ? 'embedded' : 'imported' });
    onNext();
  };

  const walletAlreadyConnected = !!account?.address && !!state.wallet_address;

  if (existingAgent) {
    return (
      <div>
        <h2 style={heading}>Welcome back.</h2>
        <div style={{ ...panelSuccess, marginBottom: 24 }}>
          <p style={{ color: 'var(--accent)', margin: '0 0 8px', fontFamily: 'var(--font-fraunces), serif', fontSize: 16 }}>
            You already have a {existingAgent.tier === 'pro' ? 'Concierge' : 'Personal Shopper'}: <strong>{existingAgent.name}</strong>
          </p>
          <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.55, margin: '0 0 14px' }}>
            Go to your dashboard to manage preferences, chat, and view activity.
          </p>
          <a
            href="/agents/dashboard"
            className="btn"
            style={{ display: 'inline-flex', fontSize: 12, padding: '10px 18px' }}
          >
            Go to your dashboard <span style={{ marginLeft: 6 }}>→</span>
          </a>
        </div>
        <button
          onClick={onBack}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--ink-3)',
          }}
        >
          ← Back
        </button>
      </div>
    );
  }

  const tierLabel = TIER_DISPLAY[state.tier].label;

  return (
    <div>
      <h2 style={heading}>Register your {tierLabel}.</h2>
      <p style={subhead}>
        Give your {tierLabel} a name and choose how to set up the wallet.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 32 }}>
        <div>
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={state.email}
            onChange={(e) => update({ email: e.target.value })}
            onBlur={(e) => checkEmailWallet(e.target.value)}
            error={errors.email}
          />
          {emailLookup?.found && !lookupDismissed && !walletAlreadyConnected && (
            <div style={{ ...panelSuccess, marginTop: 10 }}>
              <p style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 15, color: 'var(--ink)', margin: '0 0 4px' }}>
                We found a creator account with this email{emailLookup.name ? ` (${emailLookup.name})` : ''}.
              </p>
              <p style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: 'var(--ink-3)', margin: '0 0 10px' }}>
                {emailLookup.wallet?.slice(0, 10)}...{emailLookup.wallet?.slice(-8)}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={useExistingWallet} className="btn" style={{ fontSize: 11, padding: '8px 14px' }}>
                  Use this wallet
                </button>
                <button
                  type="button"
                  onClick={() => setLookupDismissed(true)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10,
                    letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)',
                  }}
                >
                  Use a different wallet
                </button>
              </div>
            </div>
          )}
        </div>

        <Input
          label="Name"
          placeholder="e.g. StyleHunter, DropScout"
          value={state.name}
          onChange={(e) => update({ name: e.target.value })}
          error={errors.name}
        />

        {walletAlreadyConnected ? (
          <div>
            <label style={labelStyle}>Wallet</label>
            <div style={panelSuccess}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--live)' }} />
                <span style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 15, color: 'var(--ink)' }}>
                  {existingCreator ? 'Connected (same as your creator wallet)' : 'Wallet connected'}
                </span>
              </div>
              <p style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: 'var(--ink-3)', margin: '4px 0 0' }}>
                {state.wallet_address}
              </p>
            </div>
            {existingCreator && (
              <p style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                Your agent will use the same wallet and on-chain identity as your creator account.
              </p>
            )}
          </div>
        ) : (
          <>
            <div>
              <label style={labelStyle}>Wallet setup</label>
              <div style={{ display: 'flex', gap: 12 }}>
                <WalletModeButton
                  active={walletMode === 'new'}
                  onClick={() => { setWalletMode('new'); if (!emailLookup?.wallet) update({ wallet_address: '' }); }}
                  title="Create new wallet"
                  subtitle="Sign in with Google or email. No seed phrase."
                />
                <WalletModeButton
                  active={walletMode === 'import'}
                  onClick={() => { setWalletMode('import'); if (!emailLookup?.wallet) update({ wallet_address: '' }); }}
                  title="Import existing"
                  subtitle="Paste your wallet address."
                />
              </div>
            </div>

            {walletMode === 'new' && (
              <div>
                {state.wallet_address ? (
                  <div style={panelSuccess}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--live)' }} />
                      <span style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 15, color: 'var(--ink)' }}>Wallet connected</span>
                    </div>
                    <p style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: 'var(--ink-3)', margin: '4px 0 0' }}>
                      {state.wallet_address}
                    </p>
                  </div>
                ) : (
                  <div style={{ border: '1px solid var(--line-strong)', overflow: 'hidden' }}>
                    <ConnectEmbed
                      client={thirdwebClient}
                      wallets={wallets}
                      chain={base}
                      theme={maisonTheme}
                      showThirdwebBranding={false}
                    />
                  </div>
                )}
                {errors.wallet && (
                  <p style={{ marginTop: 6, fontSize: 11, color: '#b5453a', fontFamily: 'var(--font-jetbrains), monospace' }}>
                    {errors.wallet}
                  </p>
                )}
              </div>
            )}

            {walletMode === 'import' && (
              <Input
                label="Wallet address"
                placeholder="0x..."
                value={state.wallet_address}
                onChange={(e) => update({ wallet_address: e.target.value })}
                error={errors.wallet}
              />
            )}
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={handleNext}>Continue</Button>
      </div>
    </div>
  );
}

function WalletModeButton({
  active, onClick, title, subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: 16,
        textAlign: 'left',
        cursor: 'pointer',
        background: active ? 'var(--paper)' : 'transparent',
        border: `1px solid ${active ? 'var(--ink)' : 'var(--line-strong)'}`,
        color: 'var(--ink)',
        transition: 'all 0.15s',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 16, fontWeight: 400, marginBottom: 4, letterSpacing: '-0.005em' }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>{subtitle}</div>
    </button>
  );
}
