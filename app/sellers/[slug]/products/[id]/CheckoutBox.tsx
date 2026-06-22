'use client';

import { useState, useEffect, useCallback } from 'react';
import { PayEmbed, useActiveAccount, useConnectModal } from 'thirdweb/react';
import { inAppWallet, createWallet } from 'thirdweb/wallets';
import { base } from 'thirdweb/chains';
import { thirdwebClient } from '@/lib/app/thirdwebClient';
import { buildUsdcPermitXPayment } from '@/lib/app/sendUsdc';
import { BuyerWalletAutoConnect } from '@/components/app/BuyerWalletAutoConnect';

/* ──────────────────────────────────────────────────────────────────────────
   Human checkout for a single product. Mirrors RRG's PurchaseFlow but settles
   through via-app's own rails: create a pending order -> pay USDC on Base (card
   on-ramp via thirdweb Pay, or a connected wallet) -> POST /api/x402/purchase
   (the SAME settlement the agent path uses). The agent MCP box on the page is
   untouched , this is the human lane alongside it.
   ────────────────────────────────────────────────────────────────────────── */

const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const CARD_MIN_USD = 10; // thirdweb Pay card on-ramp minimum (matches RRG)

const wallets = [
  inAppWallet({ auth: { options: ['google', 'email'] } }),
  createWallet('io.metamask'),
  createWallet('com.coinbase.wallet'),
  createWallet('walletConnect'),
];

interface Delivery {
  name: string; address_line1: string; address_line2: string;
  city: string; region: string; postcode: string; country: string; phone: string;
}
const EMPTY_DELIVERY: Delivery = {
  name: '', address_line1: '', address_line2: '', city: '', region: '', postcode: '', country: '', phone: '',
};

const INPUT_CLS = 'w-full bg-background border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink transition-colors';

interface OrderInfo { order_ref: string; total_usdc: number; }

export function CheckoutBox({
  slug, productId, priceUsdc, kind, buyerWallet, buyerName,
}: {
  slug: string;
  productId: string;
  priceUsdc: number;
  kind: string | null;
  /** The logged-in VIA buyer's funding wallet, if any. Used to greet them and
   *  confirm when the connected wallet is the VIA one they onboarded with. */
  buyerWallet?: string | null;
  buyerName?: string | null;
}) {
  const account = useActiveAccount();
  const { connect, isConnecting } = useConnectModal();
  const isPhysical = kind === 'physical';

  // "Create wallet" and "Connect wallet" open the same thirdweb modal: it offers
  // email/Google (creates a wallet) and external wallets (connect an existing
  // one). Two labelled buttons make the choice obvious to newcomers.
  const openWallet = () => { void connect({ client: thirdwebClient, chain: base, wallets, size: 'compact' }); };

  // True when the connected wallet is the VIA wallet the buyer onboarded with.
  const isViaWallet = Boolean(account && buyerWallet && account.address.toLowerCase() === buyerWallet.toLowerCase());
  const shortWallet = buyerWallet ? `${buyerWallet.slice(0, 6)}…${buyerWallet.slice(-4)}` : null;

  // Live USDC balance of the connected wallet (ported from RRG PurchaseFlow): a
  // raw balanceOf eth_call, so we can flag insufficient funds and offer a top-up
  // BEFORE attempting the transfer, rather than letting the transfer error out.
  const [balance, setBalance] = useState<number | null>(null);
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
    } catch { /* balance read is best-effort */ }
  }, [account?.address]);
  useEffect(() => { void readBalance(); }, [readBalance]);

  const insufficient = !!account && balance !== null && balance < priceUsdc;
  // Top-up on-ramp meets thirdweb's minimum; overshoot stays in the buyer's wallet.
  const topUpAmount = Math.max(priceUsdc, CARD_MIN_USD);

  const [delivery, setDelivery] = useState<Delivery>(EMPTY_DELIVERY);
  const [status, setStatus]     = useState<'idle' | 'working' | 'card' | 'done' | 'error'>('idle');
  const [msg, setMsg]           = useState('');
  const [order, setOrder]       = useState<OrderInfo | null>(null);
  const [orderRef, setOrderRef] = useState('');
  // Signed download links returned by settlement for a digital product.
  const [downloads, setDownloads] = useState<{ filename: string; url: string }[]>([]);

  function setField(k: keyof Delivery, v: string) {
    setDelivery((d) => ({ ...d, [k]: v }));
  }

  function deliveryMissing(): string | null {
    if (!isPhysical) return null;
    const req: Array<[keyof Delivery, string]> = [
      ['name', 'name'], ['address_line1', 'address'], ['city', 'city'],
      ['postcode', 'postcode'], ['country', 'country'], ['phone', 'phone'],
    ];
    const missing = req.filter(([k]) => !delivery[k].trim()).map(([, label]) => label);
    return missing.length ? `Please add: ${missing.join(', ')}.` : null;
  }

  async function createOrder(method: 'usdc' | 'card'): Promise<OrderInfo> {
    const res = await fetch(`/api/sellers/${slug}/products/${productId}/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qty: 1,
        buyer_wallet: account!.address,
        method,
        buyer_country: isPhysical ? delivery.country.trim().toUpperCase() : undefined,
        delivery: isPhysical ? delivery : undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Order failed (${res.status})`);
    return { order_ref: json.order_ref, total_usdc: json.total_usdc };
  }

  async function settle(ref: string, xPayment: string) {
    const res = await fetch('/api/x402/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_ref: ref, x_payment: xPayment }),
    });
    const json = await res.json();
    if (!res.ok || !json.settled) throw new Error(json.error || 'Settlement failed');
    setDownloads(Array.isArray(json.download)
      ? json.download.filter((d: unknown): d is { filename: string; url: string } =>
          !!d && typeof (d as { url?: unknown }).url === 'string')
      : []);
    setOrderRef(ref);
    setStatus('done');
    setMsg('');
  }

  // USDC path: create order, transfer USDC from the connected wallet, settle.
  async function payWithUsdc() {
    if (!account) { setMsg('Connect a wallet first.'); return; }
    const dm = deliveryMissing();
    if (dm) { setMsg(dm); return; }
    setStatus('working'); setMsg('Creating order…');
    try {
      const o = await createOrder('usdc');
      setOrder(o);
      setMsg('Approve the payment in your wallet…');
      const xPayment = await buildUsdcPermitXPayment(account, o.total_usdc);
      setMsg('Settling…');
      await settle(o.order_ref, xPayment);
    } catch (e) {
      setStatus('error');
      setMsg(e instanceof Error ? e.message : 'Payment failed');
    }
  }

  // Card path: create order, then show thirdweb Pay to fund the wallet with USDC.
  async function startCard() {
    if (!account) { setMsg('Connect a wallet first , card funds go to your account wallet.'); return; }
    const dm = deliveryMissing();
    if (dm) { setMsg(dm); return; }
    setStatus('working'); setMsg('Creating order…');
    try {
      const o = await createOrder('card');
      setOrder(o);
      setStatus('card');
      setMsg('');
    } catch (e) {
      setStatus('error');
      setMsg(e instanceof Error ? e.message : 'Could not start card payment');
    }
  }

  // Called after thirdweb Pay funds the wallet: move the USDC to the platform
  // wallet and settle.
  async function afterCardFunded() {
    if (!account || !order) return;
    setStatus('working'); setMsg('Card cleared , transferring USDC…');
    try {
      const xPayment = await buildUsdcPermitXPayment(account, order.total_usdc);
      setMsg('Settling…');
      await settle(order.order_ref, xPayment);
    } catch (e) {
      setStatus('error');
      setMsg(e instanceof Error ? e.message : 'Transfer after card payment failed');
    }
  }

  if (status === 'done') {
    const hasDownloads = downloads.length > 0;
    return (
      <div className="mt-6 border border-line bg-paper p-5">
        <div className="uc-mono text-[color:var(--live)]">Purchase complete</div>
        {hasDownloads ? (
          <>
            <p className="mt-3 text-sm text-ink-2">
              Order <span className="font-mono text-ink">{orderRef}</span> settled in USDC on Base. Your download{downloads.length > 1 ? 's are' : ' is'} ready below, the link is private to you and valid for 24 hours.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {downloads.map((d) => (
                <a key={d.url} href={d.url} target="_blank" rel="noreferrer" download={d.filename}
                  className="btn" style={{ alignSelf: 'flex-start' }}>
                  Download {d.filename}
                </a>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-3">Save it now, the link expires in 24 hours. VIA account holders can re-download from their Purchases page.</p>
          </>
        ) : isPhysical ? (
          <p className="mt-3 text-sm text-ink-2">
            Order <span className="font-mono text-ink">{orderRef}</span> settled in USDC on Base. The seller has been
            notified and will fulfil your order. Keep this reference for any follow-up.
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-2">
            Order <span className="font-mono text-ink">{orderRef}</span> settled in USDC on Base. The seller has been
            notified to deliver. Keep this reference for any follow-up.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 border border-line bg-paper p-5">
      {/* Silently connect a recognised buyer's own in-app wallet (gated by flag). */}
      <BuyerWalletAutoConnect active={Boolean(buyerWallet)} />
      <div className="uc-mono text-ink-3">Buy now</div>
      <p className="mt-2 text-sm text-ink-2">
        Pay {priceUsdc.toFixed(2)} USDC on Base. Settles instantly, the seller is notified to fulfil your order.
      </p>

      {/* Step 1: get a wallet. You pay from your own wallet, the one VIA makes
          for you (sign in with email or Google), or your own (MetaMask, Coinbase).
          Both buttons open the same chooser, labelled for new vs existing users. */}
      <div className="mt-4">
        <div className="uc-mono text-ink-3" style={{ fontSize: 10 }}>Step 1 · Your wallet</div>
        {!account ? (
          buyerName ? (
            // Recognised VIA buyer: one clear action to THEIR own wallet. The
            // first sign-in per browser is one tap (Google) or one email code to
            // the wallet they joined with; thirdweb AutoConnect keeps it connected
            // silently on every visit after that.
            <>
              <p className="mt-2 text-sm text-ink-2">
                Welcome back, {buyerName}. Sign in to your VIA wallet{shortWallet ? <> (<span className="font-mono">{shortWallet}</span>)</> : null} with the email or Google you joined with, it stays connected after the first time.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button type="button" onClick={openWallet} disabled={isConnecting} className="btn disabled:opacity-40">
                  {isConnecting ? 'Opening…' : 'Sign in to your VIA wallet'}
                </button>
                <button type="button" onClick={openWallet} disabled={isConnecting} className="underline text-xs text-ink-3 hover:text-ink">use a different wallet</button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink-2">
                New here? Create a wallet in seconds with your email or Google, you stay in control of it. Already have a wallet? Connect MetaMask, Coinbase or WalletConnect.
              </p>
              <div className="mt-3 flex gap-3">
                <button type="button" onClick={openWallet} disabled={isConnecting} className="btn disabled:opacity-40" style={{ flex: 1 }}>
                  Create wallet
                </button>
                <button type="button" onClick={openWallet} disabled={isConnecting} className="btn ghost disabled:opacity-40" style={{ flex: 1 }}>
                  Connect wallet
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-3">Create makes you a new wallet with email or Google. Connect links a wallet you already have.</p>
            </>
          )
        ) : (
          <div className="mt-2 text-xs">
            {isViaWallet ? (
              <span className="text-[color:var(--live)]">Connected · your VIA wallet {shortWallet ? <span className="font-mono">({shortWallet})</span> : null}</span>
            ) : (
              <span className="text-ink-3">Connected · <span className="font-mono">{account.address.slice(0, 6)}…{account.address.slice(-4)}</span></span>
            )}
            {balance !== null && <span className="text-ink-3"> · balance {balance.toFixed(2)} USDC</span>}
            <button type="button" onClick={openWallet} className="ml-3 underline text-ink-3 hover:text-ink">Use a different wallet</button>
          </div>
        )}
      </div>

      {insufficient && status !== 'card' && (
        <div className="mt-4 border border-line-strong bg-background p-4">
          <p className="text-sm text-ink-2">
            Not enough USDC: you have {balance!.toFixed(2)} USDC, this item costs {priceUsdc.toFixed(2)} USDC. Top up your wallet to continue.
          </p>
          <div className="mt-3">
            <PayEmbed
              client={thirdwebClient}
              payOptions={{
                mode: 'fund_wallet',
                prefillBuy: {
                  chain: base,
                  amount: String(topUpAmount),
                  token: { address: USDC_ADDRESS, name: 'USD Coin', symbol: 'USDC' },
                },
                onPurchaseSuccess: () => { void readBalance(); },
              }}
              connectOptions={{ chain: base, wallets }}
            />
          </div>
          <p className="mt-2 text-xs text-ink-3">Pay by card here, or send USDC on Base to your wallet; the balance updates when it confirms.</p>
        </div>
      )}

      {isPhysical && (
        <div className="mt-5">
        <div className="uc-mono text-ink-3" style={{ fontSize: 10 }}>Delivery address</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input className={`${INPUT_CLS} sm:col-span-2`} placeholder="Full name" value={delivery.name} onChange={(e) => setField('name', e.target.value)} />
          <input className={`${INPUT_CLS} sm:col-span-2`} placeholder="Address line 1" value={delivery.address_line1} onChange={(e) => setField('address_line1', e.target.value)} />
          <input className={`${INPUT_CLS} sm:col-span-2`} placeholder="Address line 2 (optional)" value={delivery.address_line2} onChange={(e) => setField('address_line2', e.target.value)} />
          <input className={INPUT_CLS} placeholder="City" value={delivery.city} onChange={(e) => setField('city', e.target.value)} />
          <input className={INPUT_CLS} placeholder="Region / state (optional)" value={delivery.region} onChange={(e) => setField('region', e.target.value)} />
          <input className={INPUT_CLS} placeholder="Postcode" value={delivery.postcode} onChange={(e) => setField('postcode', e.target.value)} />
          <input className={INPUT_CLS} placeholder="Country (ISO-2, e.g. GB)" maxLength={2} value={delivery.country} onChange={(e) => setField('country', e.target.value.toUpperCase())} />
          <input className={`${INPUT_CLS} sm:col-span-2`} placeholder="Phone" value={delivery.phone} onChange={(e) => setField('phone', e.target.value)} />
        </div>
        </div>
      )}

      {status === 'card' && order ? (
        <div className="mt-5">
          <PayEmbed
            client={thirdwebClient}
            payOptions={{
              mode: 'fund_wallet',
              prefillBuy: {
                chain: base,
                amount: String(order.total_usdc),
                token: { address: USDC_ADDRESS, name: 'USD Coin', symbol: 'USDC' },
              },
              onPurchaseSuccess: () => { void afterCardFunded(); },
            }}
            connectOptions={{ chain: base, wallets }}
          />
          <p className="mt-2 text-xs text-ink-3">After the card payment clears, your USDC is sent to settle order {order.order_ref}.</p>
        </div>
      ) : (
        <div className="mt-5">
          <div className="uc-mono text-ink-3" style={{ fontSize: 10 }}>Step 2 · Pay</div>
          <p className="mt-2 text-xs text-ink-3">
            {account
              ? 'Pay directly from your wallet balance, or use a card (card funds top up your wallet in USDC, then settle).'
              : 'Connect your wallet above to enable payment. Card payments fund your VIA wallet, then settle, so a wallet is needed either way.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void payWithUsdc()}
              disabled={!account || status === 'working' || insufficient}
              className="btn disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === 'working' ? 'Working…' : `Pay ${priceUsdc.toFixed(2)} USDC`}
            </button>
            {priceUsdc >= CARD_MIN_USD && !insufficient && (
              <button
                type="button"
                onClick={() => void startCard()}
                disabled={!account || status === 'working'}
                className="btn ghost disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Pay with card
              </button>
            )}
          </div>
        </div>
      )}

      {priceUsdc < CARD_MIN_USD && (
        <p className="mt-3 text-xs text-ink-3">Card payment is available on orders of {CARD_MIN_USD} USDC or more. Use a wallet for smaller amounts.</p>
      )}
      {msg && <p className={`mt-3 text-sm ${status === 'error' ? 'text-[color:var(--danger)]' : 'text-ink-2'}`}>{msg}</p>}
    </div>
  );
}
