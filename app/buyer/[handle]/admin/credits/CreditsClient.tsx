'use client';

import { useState, useEffect, useCallback } from 'react';
import { PayEmbed, useActiveAccount, useConnectModal } from 'thirdweb/react';
import { inAppWallet, createWallet } from 'thirdweb/wallets';
import { base } from 'thirdweb/chains';
import { thirdwebClient } from '@/lib/app/thirdwebClient';
import { buildUsdcPermitXPayment } from '@/lib/app/sendUsdc';

export interface CreditTx {
  id: string;
  created_at: string;
  type: 'topup' | 'deduction' | 'refund';
  amount_usdc: number;
  balance_after: number;
  description: string | null;
  tx_hash: string | null;
}

interface Props {
  buyerId: string;
  initialCredits: number;
  initialHistory: CreditTx[];
}

const CREDITS_PER_USD = 1000;
const RECOMMENDED_MIN_USD = 10; // below this, card-processor fees eat a big share
const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const toCredits = (usd: number) => Math.round(usd * CREDITS_PER_USD);

const wallets = [
  inAppWallet({ auth: { options: ['google', 'email'] } }),
  createWallet('io.metamask'),
  createWallet('com.coinbase.wallet'),
  createWallet('walletConnect'),
];

export function CreditsClient({ buyerId, initialCredits, initialHistory }: Props) {
  const account = useActiveAccount();
  const { connect, isConnecting } = useConnectModal();

  const [credits, setCredits] = useState(initialCredits);
  const [history, setHistory] = useState<CreditTx[]>(initialHistory);
  const [amount, setAmount]   = useState('10');
  const [showCard, setShowCard] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [ok, setOk]           = useState('');
  const [copied, setCopied]   = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  const openWallet = () => { void connect({ client: thirdwebClient, chain: base, wallets, size: 'compact' }); };

  // Live USDC balance of the connected in-app wallet (raw balanceOf eth_call).
  const readBalance = useCallback(async () => {
    if (!account?.address) { setBalance(null); return; }
    const data = '0x70a08231000000000000000000000000' + account.address.slice(2).toLowerCase();
    try {
      const r = await fetch(process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: USDC_ADDRESS, data }, 'latest'] }),
      });
      const d = await r.json();
      if (d.result) setBalance(Number(BigInt(d.result)) / 1_000_000);
    } catch { /* best-effort */ }
  }, [account?.address]);
  useEffect(() => { void readBalance(); }, [readBalance]);

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

  // Sign a gasless permit for `usd` USDC -> platform wallet, settle, credit.
  async function creditFromWallet(usd: number) {
    if (!account) { setErr('Sign in to your VIA wallet first.'); return; }
    if (!(usd > 0)) { setErr('Enter an amount greater than 0.'); return; }
    setErr(''); setOk(''); setBusy(true);
    try {
      const xPayment = await buildUsdcPermitXPayment(account, usd);
      const res = await fetch(`/api/buyer/${buyerId}/credits/topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x_payment: xPayment }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || `Failed (${res.status})`); return; }
      setCredits(json.credits);
      setOk(`Added ${toCredits(json.credited).toLocaleString()} credits.`);
      setHistory((h) => [{
        id: json.tx_hash,
        created_at: new Date().toISOString(),
        type: 'topup',
        amount_usdc: json.credited,
        balance_after: json.new_balance,
        description: 'USDC top-up',
        tx_hash: json.tx_hash,
      }, ...h]);
      void readBalance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add credits');
    } finally {
      setBusy(false);
    }
  }

  const usd = Number(amount);
  const usdValid = Number.isFinite(usd) && usd > 0;
  const haveEnough = balance !== null && usdValid && balance >= usd;

  return (
    <div className="space-y-8">
      {/* Balance */}
      <div className="bg-paper border border-line rounded-lg p-6">
        <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-2">Balance</div>
        <div className="font-serif text-4xl tracking-tight">{credits.toLocaleString()} <span className="text-ink-3 text-2xl">credits</span></div>
        <div className="text-xs text-ink-3 mt-1">{(credits / CREDITS_PER_USD).toFixed(2)} USD · 1,000 credits = 1 USD</div>
      </div>

      {/* Top up */}
      <div className="bg-paper border border-line rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm font-medium mb-1">Add credits</h2>
          <p className="text-sm text-ink-2">
            Top up by card or by sending USDC to your in-app wallet, then convert it to credits in one tap.
            No gas, no transaction hashes. 1 USDC = 1,000 credits.
          </p>
        </div>

        {/* Connect */}
        {!account ? (
          <div>
            <button type="button" onClick={openWallet} disabled={isConnecting}
              className="px-4 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 transition-colors rounded-md">
              {isConnecting ? 'Opening…' : 'Sign in to your VIA wallet'}
            </button>
            <p className="text-xs text-ink-3 mt-2">Sign in with the email or Google you joined with to top up.</p>
          </div>
        ) : (
          <>
            <div className="text-xs text-ink-3">
              In-app wallet · <span className="font-mono">{account.address.slice(0, 6)}…{account.address.slice(-4)}</span>
              {balance !== null && <> · balance <span className="font-mono">{balance.toFixed(2)} USDC</span></>}
              <button type="button" onClick={openWallet} className="ml-3 underline hover:text-ink">Use a different wallet</button>
            </div>

            {/* Amount */}
            <div>
              <label className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-2">Amount (USD)</label>
              <div className="flex items-center gap-2 max-w-[200px]">
                <span className="text-ink-3">$</span>
                <input
                  type="number" min="0" step="1" inputMode="decimal"
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                  className="w-full bg-background border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink transition-colors disabled:opacity-50"
                />
              </div>
              <p className="text-xs text-ink-3 mt-2">
                Any amount works. We recommend topping up at least ${RECOMMENDED_MIN_USD} at a time to minimise card-processing fees.
              </p>
            </div>

            {/* Method 1: pay by card (funds the wallet, then convert below) */}
            {showCard ? (
              <div className="border border-line-strong rounded-md p-4 bg-background">
                <PayEmbed
                  client={thirdwebClient}
                  payOptions={{
                    mode: 'fund_wallet',
                    prefillBuy: {
                      chain: base,
                      amount: usdValid ? String(usd) : String(RECOMMENDED_MIN_USD),
                      token: { address: USDC_ADDRESS, name: 'USD Coin', symbol: 'USDC' },
                    },
                    onPurchaseSuccess: () => { setShowCard(false); void readBalance(); setOk('Card cleared. Tap “Add to credits” to finish.'); },
                  }}
                  connectOptions={{ chain: base, wallets }}
                />
                <button type="button" onClick={() => setShowCard(false)} className="text-xs underline text-ink-3 hover:text-ink mt-3">Cancel card payment</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void creditFromWallet(usd)}
                  disabled={busy || !usdValid || !haveEnough}
                  className="px-4 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md"
                  title={!haveEnough ? 'Fund your wallet first (card or transfer)' : ''}
                >
                  {busy ? 'Adding…' : 'Add to credits'}
                </button>
                <button
                  type="button"
                  onClick={() => { setErr(''); setOk(''); setShowCard(true); }}
                  disabled={busy || !usdValid}
                  className="px-4 py-2 border border-line-strong text-xs font-mono tracking-widest uppercase hover:border-ink disabled:opacity-40 transition-colors rounded-md"
                >
                  Pay by card
                </button>
              </div>
            )}

            {/* Method 2: transfer USDC in */}
            <div className="border-t border-line pt-4">
              <div className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-2">Or send USDC on Base to your wallet</div>
              <div className="flex items-center gap-2">
                <code className="font-mono text-sm break-all bg-background border border-line-strong px-3 py-2 flex-1">{account.address}</code>
                <button type="button" onClick={() => copy(account.address)} className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink px-2 py-2 shrink-0">
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-ink-3 mt-2">
                Send USDC on Base to this address from any wallet or exchange, then refresh and tap “Add to credits”.
                <button type="button" onClick={() => void readBalance()} className="ml-2 underline hover:text-ink">Refresh balance</button>
              </p>
            </div>

            {!haveEnough && usdValid && balance !== null && (
              <p className="text-xs text-ink-3">Your wallet holds {balance.toFixed(2)} USDC. Fund it by card or transfer above to add ${usd} of credits.</p>
            )}
          </>
        )}

        {err && <p className="text-xs text-[color:var(--danger)]">{err}</p>}
        {ok  && <p className="text-xs text-[color:var(--live)]">{ok}</p>}
      </div>

      {/* Ledger */}
      <div>
        <h2 className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-3">Recent activity</h2>
        {history.length === 0 ? (
          <p className="text-sm text-ink-3">No credit activity yet.</p>
        ) : (
          <ul className="divide-y divide-line border border-line rounded-lg overflow-hidden">
            {history.map((t) => {
              const creditsDelta = toCredits(t.amount_usdc);
              const positive = creditsDelta >= 0;
              return (
                <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3 bg-paper">
                  <div className="min-w-0">
                    <div className="text-sm text-ink truncate">{t.description ?? t.type}</div>
                    <div className="text-[10px] font-mono text-ink-3">{new Date(t.created_at).toISOString().slice(0, 16).replace('T', ' ')}</div>
                  </div>
                  <div className={`font-mono text-sm shrink-0 ${positive ? 'text-[color:var(--live)]' : 'text-ink-2'}`}>
                    {positive ? '+' : ''}{creditsDelta.toLocaleString()}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
