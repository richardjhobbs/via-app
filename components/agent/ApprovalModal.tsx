'use client';

/**
 * One-time on-chain authorisation from the agent wallet to the platform
 * settlement spender. Without this row, the daily settlement cron skips
 * the agent (no on-chain transfer happens). With it, the cron pulls
 * back the LLM cost the company has been carrying, up to the per-agent
 * weekly cap (default 1 USDC / week).
 *
 * Allowance is set to a deliberately large number so the user never has
 * to re-sign. The WEEKLY CAP that actually bounds spend is enforced
 * server-side in /api/rrg/admin/credits/settle, not by the on-chain
 * allowance.
 */

import { useState } from 'react';
import { prepareContractCall, sendTransaction, getContract } from 'thirdweb';
import { base } from 'thirdweb/chains';
import { useActiveAccount, ConnectEmbed, lightTheme } from 'thirdweb/react';
import { inAppWallet, createWallet } from 'thirdweb/wallets';
import { thirdwebClient } from '@/lib/rrg/thirdwebClient';
import { Button } from '@/components/ui/Button';

const USDC_ADDRESS =
  process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET ??
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Same value the server uses as the settlement recipient + signer
// identity (PLATFORM_PRIVATE_KEY in env is expected to control this
// address). Agent grants allowance to THIS address.
const SETTLEMENT_SPENDER = (
  process.env.NEXT_PUBLIC_SETTLEMENT_SPENDER ??
  process.env.NEXT_PUBLIC_PLATFORM_WALLET ??
  '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed'
).toLowerCase();

// One full year of the default 1 USDC/week cap. Bounded enough not to
// alarm; large enough not to require frequent re-signing. The real
// per-week ceiling is enforced server-side in the settlement cron.
const APPROVAL_LIFETIME_USDC = 52;

// Same wallet set as registration so the modal works for the user's
// existing wallet without forcing them to leave the dashboard.
const wallets = [
  inAppWallet({ auth: { options: ['google', 'email'] } }),
  createWallet('io.metamask'),
  createWallet('com.coinbase.wallet'),
];

export function ApprovalModal({
  agentId,
  agentName,
  agentWalletAddress,
  onClose,
  onApproved,
}: {
  agentId: string;
  agentName: string;
  agentWalletAddress: string;
  onClose: () => void;
  onApproved: () => void;
}) {
  const account = useActiveAccount();
  const [signing, setSigning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const walletMatches =
    !!account && account.address.toLowerCase() === agentWalletAddress.toLowerCase();

  async function authorise() {
    if (!account) {
      setErr('Connect a wallet first.');
      return;
    }
    if (!walletMatches) {
      setErr(
        `Connected wallet ${account.address.slice(0, 6)}…${account.address.slice(-4)} does not match the agent wallet. Switch wallets and try again.`,
      );
      return;
    }
    setSigning(true);
    setErr(null);
    try {
      const usdc = getContract({
        client: thirdwebClient,
        chain: base,
        address: USDC_ADDRESS,
      });
      const allowance = BigInt(APPROVAL_LIFETIME_USDC * 1_000_000);
      const tx = prepareContractCall({
        contract: usdc,
        method: 'function approve(address spender, uint256 value) returns (bool)',
        params: [SETTLEMENT_SPENDER, allowance],
      });
      const result = await sendTransaction({ transaction: tx, account });
      const txHash = result.transactionHash;

      const res = await fetch(`/api/agent/${agentId}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_hash: txHash, spender: SETTLEMENT_SPENDER }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? 'Authorisation recorded on-chain but server save failed. Refresh and try again.');
        return;
      }
      onApproved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSigning(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)',
          maxWidth: 540, width: '100%', padding: 24, maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <h2 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 22, fontWeight: 400, margin: '0 0 8px' }}>
          Authorise LLM cost recovery
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, margin: '0 0 12px' }}>
          The platform pays the LLM providers (DeepSeek, OpenAI) up front for every chat, watcher run and search {agentName} makes. This authorisation lets us pull the cost back from your agent wallet at the end of each week, capped at <strong style={{ color: 'var(--ink)' }}>1 USDC per week</strong>. If usage exceeds the cap, {agentName} pauses until you raise it.
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, margin: '0 0 16px' }}>
          You sign this once. Works the same way whether you registered with a Thirdweb in-app wallet (Google / email) or connected an external wallet (MetaMask / Coinbase). The weekly cap is what governs what we can actually settle; we enforce it server-side and you can change it any time from your dashboard.
        </p>

        {/* Inline connect when no wallet is active. Embedded wallets
            auto-reconnect via the global AutoConnect; external wallets do
            not, so we offer the same wallet set used at registration so
            the owner can resume right here. */}
        {!account && (
          <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: 14, margin: '0 0 16px' }}>
            <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10 }}>
              Connect the agent wallet
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 10px' }}>
              Sign in with the same method you used to create {agentName} (Google / email for in-app wallets, or your external wallet).
            </p>
            <ConnectEmbed
              client={thirdwebClient}
              chain={base}
              wallets={wallets}
              theme={lightTheme()}
            />
          </div>
        )}

        {/* Wrong wallet connected: explain + offer to disconnect (no
            programmatic switch in Thirdweb v5; user picks). */}
        {account && !walletMatches && (
          <div style={{ background: 'color-mix(in srgb, #b5453a 6%, transparent)', border: '1px solid color-mix(in srgb, #b5453a 35%, transparent)', padding: 14, margin: '0 0 16px' }}>
            <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#b5453a', marginBottom: 6 }}>
              Wrong wallet connected
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: 0 }}>
              You are signed in as {account.address.slice(0, 6)}…{account.address.slice(-4)}. {agentName}'s wallet is {agentWalletAddress.slice(0, 6)}…{agentWalletAddress.slice(-4)}. Disconnect from the topbar and reconnect with the wallet you used to register {agentName}.
            </p>
          </div>
        )}

        {/* Transaction preview, only shown when ready to sign. */}
        {account && walletMatches && (
          <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: 12, margin: '0 0 16px', fontSize: 12, color: 'var(--ink-2)' }}>
            <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>
              You are about to sign
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong style={{ color: 'var(--ink)' }}>USDC.approve</strong> to the platform settlement spender, capacity {APPROVAL_LIFETIME_USDC} USDC. That is roughly <strong style={{ color: 'var(--ink)' }}>one year of weekly caps</strong> at the default 1 USDC/week, so you do not have to re-sign every week. The platform can never pull more than the weekly cap regardless of allowance.
            </div>
            <details style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Show raw call</summary>
              <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, wordBreak: 'break-all', marginTop: 6 }}>
                USDC.approve(
                <br />
                &nbsp;&nbsp;spender: {SETTLEMENT_SPENDER},
                <br />
                &nbsp;&nbsp;allowance: {APPROVAL_LIFETIME_USDC} USDC
                <br />
                )
              </div>
            </details>
          </div>
        )}

        {err && (
          <p style={{ fontSize: 12, color: 'var(--accent-warn, #b5453a)', margin: '0 0 12px' }}>{err}</p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={signing}>Cancel</Button>
          <Button size="sm" onClick={authorise} loading={signing} disabled={!account || !walletMatches}>
            Authorise
          </Button>
        </div>
      </div>
    </div>
  );
}
