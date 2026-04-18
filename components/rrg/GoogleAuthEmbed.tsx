'use client';

/**
 * GoogleAuthEmbed — Single-click Google authentication via thirdweb.
 *
 * Shows a thirdweb ConnectEmbed pre-configured for Google-only auth.
 * On successful auth, extracts the wallet address and email, then calls
 * `onAuthenticated(wallet, email)`.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ConnectEmbed, lightTheme, useActiveAccount, useProfiles } from 'thirdweb/react';
import { base } from 'thirdweb/chains';
import { inAppWallet } from 'thirdweb/wallets';
import { thirdwebClient } from '@/lib/rrg/thirdwebClient';

// Maison-palette light theme for thirdweb ConnectEmbed. The embed doesn't
// react to [data-theme] changes, so we hard-wire the light palette here and
// live with dark-mode users briefly seeing a light-mode OAuth card.
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
    selectedTextBg: '#1a1612',
    selectedTextColor: '#faf7f2',
  },
});

interface Props {
  onAuthenticated: (wallet: string, email: string) => void;
  buttonLabel?: string;
}

const wallets = [
  inAppWallet({
    auth: {
      options: ['google'],
    },
  }),
];

export default function GoogleAuthEmbed({ onAuthenticated, buttonLabel }: Props) {
  const account = useActiveAccount();
  const { data: profiles, isLoading: profilesLoading } = useProfiles({ client: thirdwebClient });
  const firedRef = useRef(false);
  const [retryCount, setRetryCount] = useState(0);

  // Stable ref for the callback to avoid re-triggering effects
  const onAuthRef = useRef(onAuthenticated);
  onAuthRef.current = onAuthenticated;

  // Extract email from profiles
  const extractEmail = useCallback((): string | null => {
    if (!profiles || profiles.length === 0) return null;
    for (const p of profiles) {
      // Check details.email (Google/Apple profiles)
      if (p.details?.email) return p.details.email;
    }
    return null;
  }, [profiles]);

  // Main effect: fire onAuthenticated when we have both wallet and email
  useEffect(() => {
    if (firedRef.current) return;
    if (!account?.address) return;

    const email = extractEmail();
    console.log('[GoogleAuthEmbed] account:', account.address, 'profiles:', profiles, 'email:', email);

    if (email) {
      firedRef.current = true;
      onAuthRef.current(account.address, email);
      return;
    }

    // Profiles not loaded yet — retry up to 10 times (5 seconds total)
    if (!profilesLoading && retryCount < 10) {
      const timer = setTimeout(() => setRetryCount((c) => c + 1), 500);
      return () => clearTimeout(timer);
    }
  }, [account?.address, profiles, profilesLoading, extractEmail, retryCount]);

  // Already connected — show processing state
  if (account?.address) {
    const email = extractEmail();
    return (
      <div style={{ padding: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, background: 'var(--live)', borderRadius: 99, animation: 'cc-pulse 2s infinite' }} />
          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 12, color: 'var(--ink-3)', letterSpacing: '0.08em' }}>
            {email ? 'Connected, processing…' : 'Connected, loading profile…'}
          </span>
        </div>
        {retryCount >= 10 && !email && (
          <p style={{ marginTop: 8, fontFamily: 'var(--font-jetbrains), monospace', fontSize: 12, color: '#b5453a' }}>
            Could not retrieve email from Google. Please refresh the page.
          </p>
        )}
      </div>
    );
  }

  return (
    <ConnectEmbed
      client={thirdwebClient}
      wallets={wallets}
      chain={base}
      theme={maisonTheme}
      showThirdwebBranding={false}
      header={{ title: buttonLabel || 'Continue with Google', titleIcon: '' }}
    />
  );
}
