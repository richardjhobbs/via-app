'use client';

import { useState, useEffect } from 'react';
import {
  useAccount,
  useConnect,
  useConnectors,
  useDisconnect,
  useSignTypedData,
  useSwitchChain,
  useChainId,
} from 'wagmi';
import { useActiveAccount as useThirdwebAccount, ConnectEmbed, PayEmbed } from 'thirdweb/react';
import { inAppWallet } from 'thirdweb/wallets';
import { base } from 'thirdweb/chains';
import { thirdwebClient } from '@/lib/rrg/thirdwebClient';
import { sendUsdcToplatform } from '@/lib/rrg/sendUsdc';
import { targetChainId } from '@/lib/rrg/wagmiConfig';

interface Props {
  tokenId:   number;
  priceUsdc: number;
  soldOut:   boolean;
  active:    boolean;
  isPhysicalProduct?: boolean;
  shippingType?: string | null;
  /** Pre-selected size for garment products (passed through to order + shipping notes) */
  selectedSize?: string;
}

type Step = 'idle' | 'connect' | 'email' | 'shipping' | 'signing' | 'confirming' | 'success' | 'error'
  | 'card-auth' | 'card-email' | 'card-topup' | 'card-sending' | 'topup-auth' | 'topup';

interface ShippingAddress {
  name: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  termsAccepted: boolean;
}

const COUNTRY_CODES: Array<[string, string]> = [
  ['United States','US'], ['United Kingdom','GB'], ['Canada','CA'], ['Australia','AU'],
  ['Germany','DE'], ['France','FR'], ['Netherlands','NL'], ['Japan','JP'],
  ['South Korea','KR'], ['Singapore','SG'], ['Hong Kong','HK'], ['India','IN'],
  ['Brazil','BR'], ['Mexico','MX'], ['South Africa','ZA'], ['United Arab Emirates','AE'],
  ['New Zealand','NZ'], ['Sweden','SE'], ['Norway','NO'], ['Denmark','DK'],
  ['Finland','FI'], ['Ireland','IE'], ['Belgium','BE'], ['Switzerland','CH'],
  ['Austria','AT'], ['Italy','IT'], ['Spain','ES'], ['Portugal','PT'],
  ['Poland','PL'], ['Czech Republic','CZ'], ['Thailand','TH'], ['Indonesia','ID'],
  ['Philippines','PH'], ['Malaysia','MY'], ['Vietnam','VN'], ['Taiwan','TW'],
  ['Israel','IL'], ['Turkey','TR'], ['Saudi Arabia','SA'], ['Argentina','AR'],
  ['Chile','CL'], ['Colombia','CO'], ['Peru','PE'],
];
const COUNTRIES = COUNTRY_CODES.map(([name]) => name);
const COUNTRY_NAME_TO_CODE: Record<string, string> = Object.fromEntries(COUNTRY_CODES);

interface ShippingRateOption {
  handle: string;
  title: string;
  amount: number;
  currency_code: string;
  delivery_method_type: string;
  code: string | null;
}

interface PurchaseResult {
  txHash:      string;
  downloadUrl: string;
}

export default function PurchaseFlow({ tokenId, priceUsdc, soldOut, active, isPhysicalProduct, shippingType, selectedSize }: Props) {
  const { address, isConnected } = useAccount();
  const { connect }              = useConnect();
  const connectors               = useConnectors();
  const { disconnect }           = useDisconnect();
  const { signTypedDataAsync }   = useSignTypedData();
  const { switchChainAsync }     = useSwitchChain();
  const chainId                  = useChainId();

  // Thirdweb in-app wallet (creator partner account wallet)
  const thirdwebAccount = useThirdwebAccount();
  const [useAccountWallet, setUseAccountWallet] = useState(false);

  // Effective wallet: thirdweb account wallet (if opted in) or wagmi wallet
  const effectiveAddress = useAccountWallet && thirdwebAccount?.address
    ? thirdwebAccount.address
    : address;

  const [step,    setStep]    = useState<Step>('idle');
  const [email,   setEmail]   = useState('');
  const [cardEmail, setCardEmail] = useState('');
  const [isCardFlow, setIsCardFlow] = useState(false);
  const [error,   setError]   = useState('');
  const [result,  setResult]  = useState<PurchaseResult | null>(null);
  const [mounted, setMounted] = useState(false);
  const [shipping, setShipping] = useState<ShippingAddress>({
    name: '', addressLine1: '', addressLine2: '', city: '',
    state: '', postalCode: '', country: '', phone: '', termsAccepted: false,
  });

  // ── Live Shopify shipping rates (physical + Shopify-backed drops) ─────
  const [shippingRates,   setShippingRates]   = useState<ShippingRateOption[] | null>(null);
  const [selectedRate,    setSelectedRate]    = useState<ShippingRateOption | null>(null);
  const [ratesLoading,    setRatesLoading]    = useState(false);
  const [ratesError,      setRatesError]      = useState<string | null>(null);
  const [notDeliverable,  setNotDeliverable]  = useState(false);

  // Fetch live rates whenever the buyer has filled the minimum address fields
  useEffect(() => {
    if (!isPhysicalProduct) return;
    const code = COUNTRY_NAME_TO_CODE[shipping.country];
    const ready = shipping.addressLine1 && shipping.city && shipping.postalCode && code;
    if (!ready) {
      setShippingRates(null); setSelectedRate(null); setNotDeliverable(false); setRatesError(null);
      return;
    }
    const ctrl = new AbortController();
    const debounce = setTimeout(async () => {
      setRatesLoading(true); setRatesError(null); setNotDeliverable(false);
      try {
        const r = await fetch('/api/rrg/shipping-rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenId,
            address: {
              address1:  shipping.addressLine1,
              address2:  shipping.addressLine2 || undefined,
              city:      shipping.city,
              province:  shipping.state || undefined,
              zip:       shipping.postalCode,
              countryCode: code,
              firstName: shipping.name.split(' ')[0] || 'Buyer',
              lastName:  shipping.name.split(' ').slice(1).join(' ') || '',
              phone:     shipping.phone || undefined,
            },
          }),
          signal: ctrl.signal,
        });
        const d = await r.json();
        if (!r.ok) {
          // 409 "no variant GID" = drop not on Shopify channel; skip silently
          if (r.status === 409) { setShippingRates(null); setSelectedRate(null); return; }
          setRatesError(d.error || `Rate lookup failed (${r.status})`);
          return;
        }
        if (!d.deliverable || (d.options ?? []).length === 0) {
          setNotDeliverable(true); setShippingRates([]); setSelectedRate(null);
          return;
        }
        setShippingRates(d.options);
        // auto-select cheapest by default
        const cheapest = [...d.options].sort((a: ShippingRateOption, b: ShippingRateOption) => a.amount - b.amount)[0];
        setSelectedRate(cheapest);
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setRatesError(e instanceof Error ? e.message : 'Rate lookup failed');
      } finally {
        setRatesLoading(false);
      }
    }, 500);
    return () => { clearTimeout(debounce); ctrl.abort(); };
  }, [isPhysicalProduct, tokenId, shipping.addressLine1, shipping.addressLine2, shipping.city, shipping.state, shipping.postalCode, shipping.country, shipping.name, shipping.phone]);

  // USDC balance for account wallet
  const [accountBalance, setAccountBalance] = useState<string | null>(null);
  useEffect(() => {
    if (!thirdwebAccount?.address) { setAccountBalance(null); return; }
    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const data = '0x70a08231000000000000000000000000' + thirdwebAccount.address.slice(2).toLowerCase();
    fetch(process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: USDC, data }, 'latest'] }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.result) {
          const raw = BigInt(d.result);
          const whole = raw / 1000000n;
          const frac = raw % 1000000n;
          setAccountBalance(`${whole}.${frac.toString().padStart(6, '0').slice(0, 2)}`);
        }
      })
      .catch(() => {});
  }, [thirdwebAccount?.address]);

  // Read referral code from cookie or localStorage
  const [referralCode, setReferralCode] = useState<string | null>(null);
  useEffect(() => {
    setMounted(true);
    // Try cookie first, then localStorage
    const cookieMatch = document.cookie.match(/(?:^|; )rrg_ref=([^;]*)/);
    const ref = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
    setReferralCode(ref || (typeof localStorage !== 'undefined' ? localStorage.getItem('rrg_ref') : null));
  }, []);

  const scanBase = 'https://basescan.org';

  // ── Guards ──────────────────────────────────────────────────────────
  if (!active) {
    return (
      <p className="text-white/60 text-base font-mono py-4">
        This drop is currently paused.
      </p>
    );
  }
  if (soldOut) {
    return (
      <p className="text-red-400 text-base font-mono py-4">
        Sold out — no remaining editions.
      </p>
    );
  }

  // ── Success ─────────────────────────────────────────────────────────
  if (step === 'success' && result) {
    return (
      <div className="border border-white/20 bg-white/5 p-6">
        <div className="text-3xl mb-4">✓</div>
        <h3 className="text-lg font-medium mb-1">Purchase complete</h3>
        <p className="text-base text-white/70 mb-6">
          Token #{tokenId} minted on Base. Your files are ready.
        </p>
        <a
          href={result.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center py-3 bg-white text-black text-base font-medium
                     hover:bg-white/90 transition-all mb-4"
        >
          Download Files →
        </a>
        <a
          href={`${scanBase}/tx/${result.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-mono text-white/40 hover:text-white/70 transition-colors block text-center"
        >
          {result.txHash.slice(0, 10)}…{result.txHash.slice(-6)} ↗
        </a>
      </div>
    );
  }

  // ── Connect wallet ───────────────────────────────────────────────────
  if (step === 'connect') {
    const handleConnect = (connector: (typeof connectors)[number]) => {
      connect(
        { connector },
        {
          onSuccess: () => setStep('email'),
          onError:   (err) => setError(err.message),
        }
      );
    };
    return (
      <div className="border border-white/20 p-6 space-y-3">
        <p className="text-base text-white/80 mb-2">Connect a wallet to purchase</p>
        {connectors.map((connector) => (
          <button
            key={connector.id}
            onClick={() => handleConnect(connector)}
            className="w-full py-3 border border-white/30 text-base hover:border-white
                       transition-all text-left px-4"
          >
            {connector.name}
          </button>
        ))}
        <div className="pt-2 border-t border-white/10">
          <p className="text-sm text-white/50 mb-2">Don&apos;t have a wallet?</p>
          <ConnectEmbed
            client={thirdwebClient}
            wallets={[inAppWallet({ auth: { options: ['google', 'apple', 'email'] } })]}
            chain={base}
            theme="dark"
            showThirdwebBranding={false}
          />
        </div>
        {error && <p className="text-red-400 text-sm font-mono">{error}</p>}
        <button
          onClick={() => { setStep('idle'); setError(''); }}
          className="w-full text-sm text-white/40 hover:text-white/70 transition-colors pt-2"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Email & confirm ─────────────────────────────────────────────────
  if (step === 'email') {
    const displayAddr = effectiveAddress;
    return (
      <div className="border border-white/20 p-6 space-y-5">
        {/* Wallet indicator */}
        <div className="flex justify-between items-center text-sm font-mono">
          <span className="text-white/60">
            {useAccountWallet && (
              <span className="text-green-400/70 mr-1.5">● account</span>
            )}
            {displayAddr?.slice(0, 6)}…{displayAddr?.slice(-4)}
            {useAccountWallet && accountBalance !== null && (
              <span className="text-white/40 ml-2">(${accountBalance})</span>
            )}
          </span>
          <button
            onClick={() => { if (!useAccountWallet) disconnect(); setUseAccountWallet(false); setStep('idle'); }}
            className="text-white/40 hover:text-white/70 transition-colors"
          >
            {useAccountWallet ? 'Change' : 'Disconnect'}
          </button>
        </div>

        <div className="border-t border-white/10 pt-4">
          <p className="text-base text-white/80">
            Purchasing for{' '}
            <span className="text-white font-medium">${priceUsdc.toFixed(2)} USDC</span>
          </p>
          <p className="text-sm text-white/60 mt-1">
            You&apos;ll sign a gasless USDC permit — no ETH needed for gas.
          </p>
        </div>

        <div>
          <label className="block text-sm font-mono uppercase tracking-[0.15em] text-white/50 mb-2">
            Email for file delivery{' '}
            <span className="normal-case tracking-normal text-white/40">(optional)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full bg-transparent border border-white/20 px-4 py-2.5 text-base
                       focus:border-white outline-none transition-colors placeholder:text-white/40"
          />
          <p className="mt-1.5 text-sm text-white/50">
            Files also accessible via wallet lookup after purchase
          </p>
        </div>

        {error && (
          <p className="text-red-400 text-sm font-mono border border-red-400/20 bg-red-400/5 px-3 py-2">
            {error}
          </p>
        )}

        <button
          onClick={() => {
            if (isPhysicalProduct) {
              setStep('shipping');
            } else {
              handlePurchase();
            }
          }}
          className="w-full py-3.5 bg-white text-black text-base font-medium
                     hover:bg-white/90 transition-all"
        >
          {isPhysicalProduct ? 'Continue to Shipping →' : 'Sign & Purchase →'}
        </button>
        <button
          onClick={() => { setStep('idle'); setError(''); }}
          className="w-full text-sm text-white/40 hover:text-white/70 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Shipping address (physical products only) ──────────────────────
  if (step === 'shipping' && isPhysicalProduct) {
    // Live rates are fetched whenever the address is filled. If the brand
    // uses live rates (Shopify-backed), the buyer must pick one before
    // proceeding. If Shopify returns no options, the brand does not ship
    // to that destination — block.
    const needsRate = shippingRates !== null && shippingRates.length > 0;
    const shippingValid = shipping.name && shipping.addressLine1 && shipping.city
      && shipping.postalCode && shipping.country && shipping.termsAccepted
      && !notDeliverable
      && (!needsRate || !!selectedRate);

    return (
      <div className="border border-white/20 p-6 space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-base text-white/80 font-medium">Shipping Address</p>
          <button
            onClick={() => setStep('email')}
            className="text-sm text-white/50 hover:text-white/80 transition-colors"
          >
            ← Back
          </button>
        </div>

        {shippingType === 'quote_after_payment' && (
          <div className="border border-amber-400/30 bg-amber-400/5 px-3 py-2">
            <p className="text-sm text-amber-400/80">
              Shipping cost is not included in the price. The brand will contact
              you after purchase with a shipping quote.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-sm font-mono text-white/50 block mb-1">Full Name *</label>
            <input
              type="text" required value={shipping.name}
              onChange={(e) => setShipping({ ...shipping, name: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none placeholder:text-white/40"
              placeholder="Jane Smith"
            />
          </div>
          <div className="col-span-2">
            <label className="text-sm font-mono text-white/50 block mb-1">Address Line 1 *</label>
            <input
              type="text" required value={shipping.addressLine1}
              onChange={(e) => setShipping({ ...shipping, addressLine1: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none placeholder:text-white/40"
              placeholder="123 Main Street"
            />
          </div>
          <div className="col-span-2">
            <label className="text-sm font-mono text-white/50 block mb-1">Address Line 2</label>
            <input
              type="text" value={shipping.addressLine2}
              onChange={(e) => setShipping({ ...shipping, addressLine2: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none placeholder:text-white/40"
              placeholder="Apt 4B"
            />
          </div>
          <div>
            <label className="text-sm font-mono text-white/50 block mb-1">City *</label>
            <input
              type="text" required value={shipping.city}
              onChange={(e) => setShipping({ ...shipping, city: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
            />
          </div>
          <div>
            <label className="text-sm font-mono text-white/50 block mb-1">State / Province</label>
            <input
              type="text" value={shipping.state}
              onChange={(e) => setShipping({ ...shipping, state: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
            />
          </div>
          <div>
            <label className="text-sm font-mono text-white/50 block mb-1">Postal Code *</label>
            <input
              type="text" required value={shipping.postalCode}
              onChange={(e) => setShipping({ ...shipping, postalCode: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
            />
          </div>
          <div>
            <label className="text-sm font-mono text-white/50 block mb-1">Country *</label>
            <select
              value={shipping.country}
              onChange={(e) => setShipping({ ...shipping, country: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
            >
              <option value="">Select…</option>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-sm font-mono text-white/50 block mb-1">Phone <span className="text-white/40">(optional)</span></label>
            <input
              type="tel" value={shipping.phone}
              onChange={(e) => setShipping({ ...shipping, phone: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none placeholder:text-white/40"
              placeholder="+1 555 123 4567"
            />
          </div>
        </div>

        {/* ── Live shipping rates (Shopify-backed drops) ──────────────── */}
        {ratesLoading && (
          <div className="border border-white/10 px-3 py-2">
            <p className="text-sm font-mono text-white/50">Looking up shipping options…</p>
          </div>
        )}
        {ratesError && !ratesLoading && (
          <div className="border border-red-400/30 bg-red-400/5 px-3 py-2">
            <p className="text-sm text-red-400">{ratesError}</p>
          </div>
        )}
        {notDeliverable && !ratesLoading && (
          <div className="border border-red-400/30 bg-red-400/5 px-3 py-2">
            <p className="text-sm text-red-400">
              The brand does not ship to {shipping.country}. Try a different delivery country.
            </p>
          </div>
        )}
        {shippingRates && shippingRates.length > 0 && !ratesLoading && (
          <div className="border border-white/15 px-4 py-3 space-y-2">
            <p className="text-sm font-mono uppercase tracking-wider text-white/50">Choose shipping</p>
            {shippingRates.map(r => (
              <label key={r.handle} className="flex items-center gap-3 cursor-pointer py-1">
                <input
                  type="radio"
                  name="shipping-rate"
                  checked={selectedRate?.handle === r.handle}
                  onChange={() => setSelectedRate(r)}
                  className="accent-white w-3.5 h-3.5"
                />
                <span className="flex-1 text-sm text-white/80">{r.title}</span>
                <span className="text-sm font-mono tabular-nums text-white/90">
                  {r.amount.toFixed(2)} {r.currency_code}
                </span>
              </label>
            ))}
            <p className="text-xs font-mono text-white/40 pt-1">
              Live rates from the brand's Shopify. Charged at the carrier's rate for your destination.
            </p>
          </div>
        )}

        <label className="flex items-start gap-2.5 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={shipping.termsAccepted}
            onChange={(e) => setShipping({ ...shipping, termsAccepted: e.target.checked })}
            className="accent-white w-3.5 h-3.5 mt-0.5"
          />
          <span className="text-sm text-white/60 leading-relaxed">
            I understand this purchase includes a physical product. Shipping is arranged
            directly between the brand and me. I accept the terms for physical delivery. *
          </span>
        </label>

        {error && (
          <p className="text-red-400 text-sm font-mono border border-red-400/20 bg-red-400/5 px-3 py-2">
            {error}
          </p>
        )}

        <button
          onClick={() => isCardFlow ? setStep('card-topup') : handlePurchase()}
          disabled={!shippingValid}
          className="w-full py-3.5 bg-white text-black text-base font-medium
                     hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {isCardFlow ? 'Continue to Payment →' : 'Sign & Purchase →'}
        </button>
        <button
          onClick={() => { setIsCardFlow(false); setStep('idle'); setError(''); }}
          className="w-full text-sm text-white/40 hover:text-white/70 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── In-progress ─────────────────────────────────────────────────────
  if (step === 'signing' || step === 'confirming') {
    return (
      <div className="border border-white/10 p-8 text-center">
        <p className="text-white/80 text-base font-mono animate-pulse">
          {step === 'signing' ? 'Waiting for signature…' : 'Minting on Base…'}
        </p>
        <p className="text-sm text-white/60 mt-3">
          {step === 'signing'
            ? 'Check your wallet — approve the USDC permit'
            : 'Transaction submitted, awaiting confirmation (10–30s)'}
        </p>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────
  if (step === 'error') {
    return (
      <div className="space-y-4">
        <div className="border border-red-400/30 bg-red-400/5 px-4 py-3 text-base text-red-400 font-mono">
          {error}
        </div>
        <button
          onClick={() => { setStep('idle'); setError(''); }}
          className="w-full py-3 border border-white/20 text-base hover:border-white transition-all"
        >
          Try Again
        </button>
        {isConnected && (
          <button
            onClick={() => { disconnect(); setStep('idle'); setError(''); }}
            className="w-full text-sm text-white/40 hover:text-white/70 transition-colors pt-1"
          >
            Disconnect wallet
          </button>
        )}
      </div>
    );
  }

  // ── Card auth ──────────────────────────────────────────────────────
  if (step === 'card-auth') {
    if (thirdwebAccount?.address) {
      setStep('card-email');
      return null;
    }
    return (
      <div className="border border-white/20 p-6 space-y-4">
        <p className="text-base text-white/80 mb-2">Sign in to pay with card</p>
        <ConnectEmbed
          client={thirdwebClient}
          chain={base}
          wallets={[inAppWallet({ auth: { options: ['google', 'email'] } })]}
          onConnect={() => setStep('card-email')}
        />
        <button onClick={() => { setStep('idle'); setError(''); }}
          className="w-full text-sm text-white/40 hover:text-white/70 transition-colors pt-2">
          Cancel
        </button>
      </div>
    );
  }

  // ── Card email ────────────────────────────────────────────────────
  if (step === 'card-email') {
    return (
      <div className="border border-white/20 p-6 space-y-5">
        <div className="flex justify-between items-center text-sm font-mono">
          <span className="text-white/60">
            <span className="text-blue-400/70 mr-1.5">&#x1f4b3; card</span>
            {thirdwebAccount?.address?.slice(0, 6)}&hellip;{thirdwebAccount?.address?.slice(-4)}
          </span>
          <button onClick={() => setStep('idle')}
            className="text-white/40 hover:text-white/70 transition-colors">
            Change
          </button>
        </div>
        <div className="border-t border-white/10 pt-4">
          <p className="text-base text-white/80">
            Purchasing for <span className="text-white font-medium">${priceUsdc.toFixed(2)} USDC</span>
          </p>
          <p className="text-sm text-white/60 mt-1">
            Card processing fees apply (~3%). You&apos;ll enter card details next.
          </p>
        </div>
        <div>
          <label className="block text-sm font-mono uppercase tracking-[0.15em] text-white/50 mb-2">
            Email for file delivery
          </label>
          <input type="email" value={cardEmail} onChange={(e) => setCardEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full bg-transparent border border-white/20 px-4 py-2.5 text-base
                       focus:border-white outline-none transition-colors placeholder:text-white/40" />
        </div>
        {error && <p className="text-red-400 text-sm font-mono border border-red-400/20 bg-red-400/5 px-3 py-2">{error}</p>}
        <button onClick={() => {
            if (isPhysicalProduct) { setIsCardFlow(true); setStep('shipping'); } else { setStep('card-topup'); }
          }}
          className="w-full py-3.5 bg-white text-black text-base font-medium hover:bg-white/90 transition-all">
          {isPhysicalProduct ? 'Continue to Shipping \u2192' : 'Continue to Payment \u2192'}
        </button>
        <button onClick={() => { setStep('idle'); setError(''); }}
          className="w-full text-sm text-white/40 hover:text-white/70 transition-colors">
          Cancel
        </button>
      </div>
    );
  }

  // ── Card topup ────────────────────────────────────────────────────
  if (step === 'card-topup') {
    return (
      <div className="border border-white/20 p-6 space-y-4">
        <p className="text-base text-white/80">Fund your wallet to complete purchase</p>
        <p className="text-sm text-white/60">
          Add <span className="text-white">${priceUsdc.toFixed(2)} USDC</span> to your wallet, then click below.
        </p>
        <PayEmbed
          client={thirdwebClient}
          theme="dark"
          payOptions={{
            mode: 'fund_wallet',
            prefillBuy: {
              chain: base,
              amount: String(priceUsdc),
              token: {
                address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                name: 'USD Coin',
                symbol: 'USDC',
              },
            },
          }}
          connectOptions={{
            chain: base,
            wallets: [inAppWallet({ auth: { options: ['google', 'email'] } })],
          }}
        />
        <div className="text-center py-2">
          <p className="text-xs font-mono text-white/40">Wallet: {thirdwebAccount?.address?.slice(0,6)}&hellip;{thirdwebAccount?.address?.slice(-4)}</p>
          {accountBalance !== null && <p className="text-xs font-mono text-white/40 mt-1">Balance: ${accountBalance} USDC</p>}
        </div>
        <button onClick={() => handleCardSend()}
          disabled={!accountBalance || parseFloat(accountBalance) < priceUsdc}
          className="w-full py-3.5 bg-white text-black text-base font-medium hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          Complete Purchase &rarr;
        </button>
        <button onClick={() => { setStep('idle'); setError(''); }}
          className="w-full text-sm text-white/40 hover:text-white/70 transition-colors">
          Cancel
        </button>
      </div>
    );
  }

  // ── Card sending ──────────────────────────────────────────────────
  if (step === 'card-sending') {
    return (
      <div className="border border-white/20 p-6 space-y-4 text-center">
        <div className="animate-pulse text-3xl">&#x23f3;</div>
        <p className="text-base text-white/80">Processing your purchase...</p>
        <p className="text-sm text-white/60">Transferring payment and minting your token.</p>
        {error && <p className="text-red-400 text-sm font-mono">{error}</p>}
      </div>
    );
  }

  // ── Top-up auth ──────────────────────────────────────────────────────
  if (step === 'topup-auth') {
    if (thirdwebAccount?.address) {
      setStep('topup');
      return null;
    }
    return (
      <div className="border border-white/20 p-6 space-y-4">
        <p className="text-base text-white/80 mb-2">Sign in to top up your wallet</p>
        <ConnectEmbed
          client={thirdwebClient}
          chain={base}
          wallets={[inAppWallet({ auth: { options: ['google', 'email'] } })]}
          onConnect={() => setStep('topup')}
        />
        <button onClick={() => { setStep('idle'); setError(''); }}
          className="w-full text-sm text-white/40 hover:text-white/70 transition-colors pt-2">
          Cancel
        </button>
      </div>
    );
  }

  // ── Top-up wallet (PayEmbed, $10 default) ──────────────────────────
  if (step === 'topup') {
    return (
      <div className="border border-white/20 p-6 space-y-4">
        <p className="text-base text-white/80">Top up your wallet with USDC</p>
        <p className="text-sm text-white/60">
          Add USDC to your wallet using a credit or debit card. Once funded, you can purchase any item instantly.
        </p>
        <PayEmbed
          client={thirdwebClient}
          theme="dark"
          payOptions={{
            mode: 'fund_wallet',
            prefillBuy: {
              chain: base,
              amount: '10',
              token: {
                address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                name: 'USD Coin',
                symbol: 'USDC',
              },
            },
          }}
          connectOptions={{
            chain: base,
            wallets: [inAppWallet({ auth: { options: ['google', 'email'] } })],
          }}
        />
        <div className="text-center py-2">
          <p className="text-xs font-mono text-white/40">
            Wallet: {thirdwebAccount?.address?.slice(0, 6)}&hellip;{thirdwebAccount?.address?.slice(-4)}
          </p>
          {accountBalance !== null && (
            <p className="text-xs font-mono text-white/40 mt-1">Balance: ${accountBalance} USDC</p>
          )}
        </div>
        <button onClick={() => { setStep('idle'); setError(''); }}
          className="w-full py-3 border border-white/20 text-white/70 text-sm hover:border-white/40 hover:text-white transition-all">
          Done &mdash; Back to Purchase
        </button>
      </div>
    );
  }

  // ── Idle — main CTA ──────────────────────────────────────────────────
  const walletReady = mounted && isConnected && !!address;
  const hasAccountWallet = mounted && !!thirdwebAccount?.address;

  return (
    <div className="space-y-3">
      {/* Account wallet option — shown when creator is logged in via thirdweb */}
      {hasAccountWallet && !walletReady && (
        <button
          onClick={() => { setUseAccountWallet(true); setStep('email'); }}
          className="w-full py-4 bg-white text-black text-base font-medium
                     hover:bg-white/90 transition-all tracking-wide"
        >
          Buy with Account Wallet · ${priceUsdc.toFixed(2)}
        </button>
      )}
      {hasAccountWallet && !walletReady && (
        <div className="text-center">
          <p className="text-sm font-mono text-white/50">
            {thirdwebAccount.address.slice(0, 6)}…{thirdwebAccount.address.slice(-4)}
          </p>
          {accountBalance !== null && (
            <p className="text-xs font-mono text-white/40 mt-0.5">
              Balance: ${accountBalance} USDC
            </p>
          )}
        </div>
      )}

      {/* Separator when both options available */}
      {hasAccountWallet && !walletReady && (
        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 border-t border-white/10" />
          <span className="text-sm font-mono text-white/30">or</span>
          <div className="flex-1 border-t border-white/10" />
        </div>
      )}

      {/* Standard wallet connection */}
      <button
        onClick={handleBuy}
        className={`w-full py-4 text-base font-medium transition-all tracking-wide ${
          hasAccountWallet && !walletReady
            ? 'border border-white/20 text-white/80 hover:border-white/40 hover:text-white'
            : 'bg-white text-black hover:bg-white/90'
        }`}
      >
        {walletReady
          ? `Purchase for $${priceUsdc.toFixed(2)} USDC`
          : 'Connect External Wallet'}
      </button>
      {walletReady && (
        <p className="text-sm font-mono text-white/50 text-center">
          {address.slice(0, 6)}…{address.slice(-4)}
          <button
            onClick={() => disconnect()}
            className="ml-2 hover:text-white/80 transition-colors"
          >
            (disconnect)
          </button>
        </p>
      )}
      <p className="text-sm text-white/50 text-center">
        Gasless · USDC on Base · files delivered on mint
      </p>

      {/* Card payment — only for items >= $10 */}
      {priceUsdc >= 10 ? (
        <>
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 border-t border-white/10" />
            <span className="text-sm font-mono text-white/30">or</span>
            <div className="flex-1 border-t border-white/10" />
          </div>

          <button
            onClick={() => setStep('card-auth')}
            className="w-full py-4 border border-white/20 text-white/80 text-base font-medium
                       hover:border-white/40 hover:text-white transition-all tracking-wide"
          >
            &#x1f4b3; Buy with Card &middot; ${priceUsdc.toFixed(2)}
          </button>
          <p className="text-sm text-white/50 text-center">
            Credit/debit card &middot; processing fees apply
          </p>
        </>
      ) : (
        <div className="border border-white/10 bg-white/5 px-4 py-3 mt-2 space-y-3">
          <p className="text-sm text-white/60">
            &#x1f4b3; Fees can be high when buying a low price item. We suggest you top up your wallet
            with $10 USDC so you have a better rate and more options!
          </p>
          <button
            onClick={() => setStep('topup-auth')}
            className="w-full py-3 border border-white/20 text-white/70 text-sm font-medium
                       hover:border-white/40 hover:text-white transition-all"
          >
            Top Up Wallet &rarr;
          </button>
        </div>
      )}
    </div>
  );

  // ── Handlers ─────────────────────────────────────────────────────────
  async function handleCardSend() {
    if (!thirdwebAccount) return;
    setStep('card-sending');
    setError('');
    try {
      // Send USDC from embedded wallet to platform wallet
      const txHash = await sendUsdcToplatform(thirdwebAccount, priceUsdc);

      // Confirm with server
      const confirmBody: Record<string, unknown> = {
        tokenId,
        buyerWallet: thirdwebAccount.address,
        buyerEmail: cardEmail || null,
        txHash,
        cardFeeUsdc: priceUsdc * 0.03, // estimated 3% card fee
      };
      if (isPhysicalProduct) {
        confirmBody.shipping_name = shipping.name;
        confirmBody.shipping_address_line1 = shipping.addressLine1;
        confirmBody.shipping_address_line2 = shipping.addressLine2 || null;
        confirmBody.shipping_city = shipping.city;
        confirmBody.shipping_state = shipping.state || null;
        confirmBody.shipping_postal_code = shipping.postalCode;
        confirmBody.shipping_country = shipping.country;
        confirmBody.shipping_phone = shipping.phone || null;
        confirmBody.physical_terms_accepted = shipping.termsAccepted;
        if (selectedRate) {
          confirmBody.shipping_rate_handle   = selectedRate.handle;
          confirmBody.shipping_rate_title    = selectedRate.title;
          confirmBody.shipping_rate_amount   = selectedRate.amount;
          confirmBody.shipping_rate_currency = selectedRate.currency_code;
          confirmBody.shipping_rate_code     = selectedRate.code;
        }
      }
      if (selectedSize) confirmBody.selected_size = selectedSize;
      if (referralCode) confirmBody.referralCode = referralCode;

      const res = await fetch('/api/rrg/confirm-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmBody),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Purchase failed');

      setResult({ txHash: data.txHash, downloadUrl: data.downloadUrl });
      setStep('success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
      setStep('error');
    }
  }

  async function handleBuy() {
    setError('');
    setUseAccountWallet(false);
    if (!isConnected || !address) {
      setStep('connect');
      return;
    }
    // Ensure correct chain
    if (chainId !== targetChainId) {
      try {
        await switchChainAsync({ chainId: targetChainId });
      } catch {
        setError('Please switch to Base in your wallet.');
        return;
      }
    }
    setStep('email');
  }

  async function handlePurchase() {
    const buyerAddr = effectiveAddress;
    if (!buyerAddr) return;
    setStep('signing');
    setError('');

    try {
      // For external wallets: ensure correct chain
      if (!useAccountWallet) {
        try {
          await switchChainAsync({ chainId: targetChainId });
        } catch {
          throw new Error('Please switch to Base in your wallet.');
        }
      }

      // 1 — Get permit payload from server
      const purchaseRes = await fetch('/api/rrg/purchase', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tokenId, buyerWallet: buyerAddr }),
      });
      const purchaseData = await purchaseRes.json();
      if (!purchaseRes.ok) throw new Error(purchaseData.error || 'Purchase prep failed');

      const { domain, types, value } = purchaseData.permitPayload;

      // 2 — Sign EIP-2612 permit (thirdweb account or wagmi)
      let signature: string;

      if (useAccountWallet && thirdwebAccount) {
        // Sign via thirdweb in-app wallet (may trigger Google re-auth)
        signature = await thirdwebAccount.signTypedData({
          domain: {
            name:              domain.name,
            version:           domain.version,
            chainId:           BigInt(domain.chainId),
            verifyingContract: domain.verifyingContract as `0x${string}`,
          },
          types,
          primaryType: 'Permit',
          message: {
            owner:    value.owner as `0x${string}`,
            spender:  value.spender as `0x${string}`,
            value:    BigInt(value.value),
            nonce:    BigInt(value.nonce),
            deadline: BigInt(value.deadline),
          },
        });
      } else {
        // Sign via wagmi (MetaMask / Coinbase / WalletConnect)
        signature = await signTypedDataAsync({
          domain,
          types,
          primaryType: 'Permit',
          message:     value,
        });
      }

      // 3 — Confirm + mint
      setStep('confirming');
      const confirmBody: Record<string, unknown> = {
        tokenId,
        buyerWallet: buyerAddr,
        buyerEmail:  email || null,
        deadline:    value.deadline,
        signature,
      };
      // Include shipping data for physical products
      if (isPhysicalProduct) {
        confirmBody.shipping_name          = shipping.name;
        confirmBody.shipping_address_line1 = shipping.addressLine1;
        confirmBody.shipping_address_line2 = shipping.addressLine2 || null;
        confirmBody.shipping_city          = shipping.city;
        confirmBody.shipping_state         = shipping.state || null;
        confirmBody.shipping_postal_code   = shipping.postalCode;
        confirmBody.shipping_country       = shipping.country;
        confirmBody.shipping_phone         = shipping.phone || null;
        confirmBody.physical_terms_accepted = shipping.termsAccepted;
        if (selectedRate) {
          confirmBody.shipping_rate_handle   = selectedRate.handle;
          confirmBody.shipping_rate_title    = selectedRate.title;
          confirmBody.shipping_rate_amount   = selectedRate.amount;
          confirmBody.shipping_rate_currency = selectedRate.currency_code;
          confirmBody.shipping_rate_code     = selectedRate.code;
        }
      }
      // Include selected size (garment products)
      if (selectedSize) confirmBody.selected_size = selectedSize;
      // Include referral code if present (from cookie/localStorage)
      if (referralCode) {
        confirmBody.referralCode = referralCode;
      }
      const confirmRes = await fetch('/api/rrg/confirm', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(confirmBody),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error || 'Mint failed');

      setResult({ txHash: confirmData.txHash, downloadUrl: confirmData.downloadUrl });
      setStep('success');

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
      setStep('error');
    }
  }
}
