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
import { useActiveAccount } from 'thirdweb/react';
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

// Lifetime allowance ceiling. 1000 USDC covers ~20 years of the
// default 1 USDC/week cap, so the owner only ever signs once in
// practice. The weekly cap is what actually gates settlement.
const APPROVAL_LIFETIME_USDC = 1000;

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
          maxWidth: 520, width: '100%', padding: 24,
        }}
      >
        <h2 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 22, fontWeight: 400, margin: '0 0 8px' }}>
          Authorise LLM cost recovery
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, margin: '0 0 12px' }}>
          The platform pays the LLM providers (DeepSeek, OpenAI) up front for every chat, watcher run and search {agentName} makes. This authorisation lets us pull the cost back from your agent wallet at the end of each week, capped at a maximum of <strong style={{ color: 'var(--ink)' }}>1 USDC per week</strong> if the agent is heavily used. If usage exceeds the cap, the agent pauses until you raise it.
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, margin: '0 0 12px' }}>
          You sign this once. The on-chain allowance is set generously so you do not have to repeat it; the real ceiling is the weekly cap, which we enforce server-side and you can change any time from your dashboard.
        </p>
        <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: 12, margin: '0 0 16px', fontSize: 12, color: 'var(--ink-2)' }}>
          <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>You are about to sign</div>
          <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, wordBreak: 'break-all' }}>
            USDC.approve(
            <br />
            &nbsp;&nbsp;spender: {SETTLEMENT_SPENDER},
            <br />
            &nbsp;&nbsp;allowance: {APPROVAL_LIFETIME_USDC} USDC
            <br />
            )
          </div>
        </div>
        {!walletMatches && account && (
          <p style={{ fontSize: 12, color: 'var(--accent-warn, #b5453a)', margin: '0 0 12px' }}>
            Your connected wallet ({account.address.slice(0, 6)}…{account.address.slice(-4)}) is not the agent wallet. Switch to {agentWalletAddress.slice(0, 6)}…{agentWalletAddress.slice(-4)} to sign.
          </p>
        )}
        {!account && (
          <p style={{ fontSize: 12, color: 'var(--accent-warn, #b5453a)', margin: '0 0 12px' }}>
            No wallet connected. Sign in / connect from the topbar first.
          </p>
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
