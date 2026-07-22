'use client';

/**
 * In-room exclusive offers: the brand's card and the one-button buy.
 *
 * A brand member of the room posts one of its products at a room price
 * (usually preferential, ahead of or below the public listing). The card
 * renders inside the room and members buy it right here with the wallet their
 * agent already runs on. Two brand kinds, one card:
 *  - VIA store offers settle through /api/x402/purchase (order -> permit -> settle)
 *  - RRG brand offers settle through the room settle route, which executes the
 *    same gasless permit and then claims on RRG (mint + delivery + brand payout
 *    at the room price). Buyer-side, both are one Buy press plus whatever
 *    details the product genuinely needs (email, size, address).
 * Nobody leaves the room.
 */
import { useCallback, useEffect, useState } from 'react';
import { useActiveAccount, useConnectModal } from 'thirdweb/react';
import { inAppWallet, createWallet } from 'thirdweb/wallets';
import { base } from 'thirdweb/chains';
import { thirdwebClient } from '@/lib/app/thirdwebClient';
import { buildUsdcPermitXPayment } from '@/lib/app/sendUsdc';
import { BuyerWalletAutoConnect } from '@/components/app/BuyerWalletAutoConnect';

export interface RoomOffer {
  id: string;
  platform: 'via' | 'rrg';
  product_id: string;
  seller_slug: string;
  seller_name: string;
  title: string;
  description: string | null;
  kind: string;
  image_url: string | null;
  price_usdc: number;
  list_price_usdc: number;
  terms: string | null;
  sizes: string[];
  qty_cap: number | null;
  sold: number;
  remaining: number | null;
  created_by_ref: string;
  created_at: string;
}

interface SellerProductLite {
  id: string; title: string; kind: string; price_usdc: number; image_url: string | null;
  sizes?: string[]; remaining?: number | null;
}

interface Delivery {
  name: string; address_line1: string; address_line2: string;
  city: string; region: string; postcode: string; country: string; phone: string;
}
const EMPTY_DELIVERY: Delivery = {
  name: '', address_line1: '', address_line2: '', city: '', region: '', postcode: '', country: '', phone: '',
};

const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const wallets = [
  inAppWallet({ auth: { options: ['google', 'email'] } }),
  createWallet('io.metamask'),
  createWallet('com.coinbase.wallet'),
  createWallet('walletConnect'),
];

const input: React.CSSProperties = {
  width: '100%', background: 'var(--bg)', color: 'var(--ink)',
  border: '1px solid var(--line-strong)', borderRadius: 4, padding: '9px 11px', fontSize: 14, fontFamily: 'inherit',
};

export function RoomOffers({
  roomId, handle, offers, setOffers, youAreBrandSeller, youAreFounder, buyerWallet, buyerName, accent,
}: {
  roomId: string;
  handle: string;
  offers: RoomOffer[];
  setOffers: (offers: RoomOffer[]) => void;
  /** True when the member is a seller-kind identity (VIA store or RRG brand). */
  youAreBrandSeller: boolean;
  youAreFounder: boolean;
  /** The signed-in buyer's own agent wallet, if they are a VIA buyer. Enables
   *  the silent auto-connect so Buy is a confirm, not a wallet connection. */
  buyerWallet: string | null;
  buyerName: string | null;
  accent: string;
}) {
  const withdraw = useCallback(async (offer: RoomOffer) => {
    if (!confirm(`Withdraw the room offer for "${offer.title}"?`)) return;
    const res = await fetch(`/api/backroom/room/${roomId}/offer/${offer.id}?ref=${encodeURIComponent(handle)}`, { method: 'DELETE' });
    if (res.ok) { const j = await res.json() as { offers?: RoomOffer[] }; if (j.offers) setOffers(j.offers); }
    else { const j = await res.json().catch(() => ({})); alert((j as { error?: string }).error ?? 'could not withdraw that'); }
  }, [roomId, handle, setOffers]);

  if (offers.length === 0 && !youAreBrandSeller) return null;

  return (
    <section style={{ marginBottom: 24 }}>
      {/* Silently connect a recognised buyer's own agent wallet, so buying an
          offer is a single confirm rather than a wallet connection. Gated by the
          same flag the product checkout uses; inert until it is on. */}
      <BuyerWalletAutoConnect active={Boolean(buyerWallet)} />
      {offers.length > 0 && (
        <>
          <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 10px' }}>
            For this room first
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {offers.map((o) => (
              <OfferCard
                key={o.id} roomId={roomId} handle={handle} offer={o} accent={accent}
                buyerWallet={buyerWallet} buyerName={buyerName}
                canWithdraw={youAreFounder || o.created_by_ref.toLowerCase() === handle.toLowerCase()}
                onWithdraw={() => void withdraw(o)}
              />
            ))}
          </div>
        </>
      )}
      {youAreBrandSeller && (
        <OfferComposer roomId={roomId} handle={handle} accent={accent} onOffered={setOffers} hasOffers={offers.length > 0} />
      )}
    </section>
  );
}

/**
 * One offer, one buy button. A connected wallet buying a VIA digital item pays
 * in a single press; anything needing details (email for an RRG item, a size,
 * a delivery address) opens its panel first, then pays with the same permit.
 */
function OfferCard({
  roomId, handle, offer, accent, buyerWallet, buyerName, canWithdraw, onWithdraw,
}: {
  roomId: string; handle: string; offer: RoomOffer; accent: string;
  buyerWallet: string | null; buyerName: string | null;
  canWithdraw: boolean; onWithdraw: () => void;
}) {
  const account = useActiveAccount();
  const { connect, isConnecting } = useConnectModal();
  const isViaWallet = Boolean(account && buyerWallet && account.address.toLowerCase() === buyerWallet.toLowerCase());
  const isPhysical = offer.kind === 'physical';
  const isRrg = offer.platform === 'rrg';
  const needsPanel = isPhysical || isRrg; // email / size / address before paying

  const [open, setOpen] = useState(false);
  const [delivery, setDelivery] = useState<Delivery>(EMPTY_DELIVERY);
  const [email, setEmail] = useState('');
  const [size, setSize] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [downloads, setDownloads] = useState<{ filename: string; url: string }[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  // RRG settle retry: the paid-but-unclaimed order id, so a claim blip never
  // strands the buyer's money behind a fresh charge.
  const [retryOrderId, setRetryOrderId] = useState<string | null>(null);

  // Live USDC balance of the connected wallet, so a short balance is explained
  // before the permit fails cryptically.
  useEffect(() => {
    if (!account?.address) { setBalance(null); return; }
    const data = '0x70a08231000000000000000000000000' + account.address.slice(2).toLowerCase();
    void (async () => {
      try {
        const r = await fetch(process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: USDC_ADDRESS, data }, 'latest'] }),
        });
        const d = await r.json();
        if (d.result) setBalance(Number(BigInt(d.result)) / 1_000_000);
      } catch { /* balance read is best-effort */ }
    })();
  }, [account?.address]);

  const openWallet = () => { void connect({ client: thirdwebClient, chain: base, wallets, size: 'compact' }); };

  const detailsMissing = useCallback((): string | null => {
    const missing: string[] = [];
    if (isRrg && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) missing.push('a valid email');
    if (isRrg && offer.sizes.length > 0 && !size) missing.push('a size');
    if (isPhysical) {
      const req: Array<[keyof Delivery, string]> = [
        ['name', 'name'], ['address_line1', 'address'], ['city', 'city'],
        ['postcode', 'postcode'], ['country', 'country'], ['phone', 'phone'],
      ];
      missing.push(...req.filter(([k]) => !delivery[k].trim()).map(([, label]) => label));
    }
    return missing.length ? `Please add: ${missing.join(', ')}.` : null;
  }, [isRrg, isPhysical, email, size, offer.sizes, delivery]);

  const applyDone = (ref: string, downloadUrl: string | null) => {
    setDownloads(downloadUrl ? [{ filename: offer.title, url: downloadUrl }] : []);
    setOrderRef(ref);
    setRetryOrderId(null);
    setStatus('done'); setMsg('');
  };

  // RRG settle call, shared by the fresh path and the retry path.
  const settleRrg = useCallback(async (roomOrderId: string, xPayment: string | null) => {
    const res = await fetch(`/api/backroom/room/${roomId}/offer/${offer.id}/settle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: handle, room_order_id: roomOrderId, ...(xPayment ? { x_payment: xPayment } : {}) }),
    });
    const json = await res.json();
    if (!res.ok || !json.settled) {
      if (json.retryable) setRetryOrderId(roomOrderId);
      throw new Error(json.error || 'Settlement failed');
    }
    applyDone(roomOrderId.slice(0, 8), typeof json.download_url === 'string' ? json.download_url : null);
  }, [roomId, offer.id, handle]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = useCallback(async () => {
    if (!account) { setOpen(true); setMsg(''); return; }
    const dm = detailsMissing();
    if (dm) { setOpen(true); setMsg(dm); return; }
    if (balance !== null && balance < offer.price_usdc) {
      setOpen(true);
      setMsg(`Not enough USDC: your wallet holds ${balance.toFixed(2)}, this costs ${offer.price_usdc.toFixed(2)}. Top up your wallet, then buy here.`);
      return;
    }
    setStatus('working'); setMsg('Creating your order…');
    try {
      // Retry lane: money already captured on RRG path, just re-claim.
      if (retryOrderId) {
        setMsg('Retrying settlement…');
        await settleRrg(retryOrderId, null);
        return;
      }
      const res = await fetch(`/api/backroom/room/${roomId}/offer/${offer.id}/order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: handle,
          buyer_wallet: account.address,
          qty: 1,
          email: isRrg ? email.trim() : undefined,
          selected_size: isRrg && size ? size : undefined,
          buyer_country: isPhysical ? delivery.country.trim().toUpperCase() : undefined,
          delivery: isPhysical ? delivery : undefined,
        }),
      });
      const order = await res.json();
      if (!res.ok) throw new Error(order.error || `Order failed (${res.status})`);
      setMsg('Approve the payment in your wallet…');
      const xPayment = await buildUsdcPermitXPayment(account, order.total_usdc);
      setMsg('Settling…');
      if (isRrg) {
        await settleRrg(order.room_order_id as string, xPayment);
      } else {
        const settle = await fetch('/api/x402/purchase', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_ref: order.order_ref, x_payment: xPayment }),
        });
        const settled = await settle.json();
        if (!settle.ok || !settled.settled) throw new Error(settled.error || 'Settlement failed');
        const dl = Array.isArray(settled.download) && settled.download[0] && typeof settled.download[0].url === 'string'
          ? settled.download[0].url as string : null;
        applyDone(order.order_ref as string, dl);
      }
    } catch (e) {
      setStatus('error'); setOpen(true);
      setMsg(e instanceof Error ? e.message : 'Payment failed');
    }
  }, [account, balance, delivery, detailsMissing, email, size, handle, isPhysical, isRrg, offer.id, offer.price_usdc, retryOrderId, roomId, settleRrg]);

  const onBuy = () => {
    if (status === 'working') return;
    if (!account || needsPanel) { setOpen(true); return; }
    void pay();
  };

  const soldOut = offer.remaining !== null && offer.remaining <= 0;
  const discount = offer.list_price_usdc > offer.price_usdc;

  return (
    <article style={{ border: `1px solid ${accent}`, borderRadius: 8, background: 'var(--paper)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 14, padding: 14 }}>
        {offer.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={offer.image_url} alt={offer.title}
            style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)', flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: accent, margin: 0 }}>
            {offer.seller_name} · room offer
          </p>
          <p className="br-serif" style={{ fontSize: 19, margin: '3px 0 2px', color: 'var(--ink)', wordBreak: 'break-word' }}>{offer.title}</p>
          <p className="br-sans" style={{ fontSize: 14, color: 'var(--ink)', margin: '2px 0 0' }}>
            {offer.price_usdc.toFixed(2)} USDC
            {discount && <span style={{ color: 'var(--ink-3)', textDecoration: 'line-through', marginLeft: 8 }}>{offer.list_price_usdc.toFixed(2)}</span>}
            {offer.remaining !== null && (
              <span style={{ color: 'var(--ink-3)', marginLeft: 8 }}>· {soldOut ? 'fully taken' : `${offer.remaining} left for the room`}</span>
            )}
          </p>
          {offer.terms && <p className="br-sans" style={{ fontSize: 13, color: 'var(--ink-2)', margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{offer.terms}</p>}
        </div>
      </div>

      {status === 'done' ? (
        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 14px' }}>
          <p className="br-sans" style={{ fontSize: 14, color: 'var(--live)', margin: 0 }}>
            Bought for the room price. Order <span style={{ fontFamily: 'monospace' }}>{orderRef}</span> settled in USDC on Base.
          </p>
          {downloads.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {downloads.map((d) => (
                <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className="br-sans"
                  style={{ fontSize: 14, color: accent }}>Download {d.filename}</a>
              ))}
            </div>
          )}
          {downloads.length === 0 && (
            <p className="br-sans" style={{ fontSize: 12, color: 'var(--ink-3)', margin: '6px 0 0' }}>
              {isRrg
                ? 'Your order confirmation is on its way by email, and the brand fulfils from here.'
                : 'The seller has been notified to fulfil your order. Keep the reference.'}
            </p>
          )}
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 14px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={onBuy} disabled={status === 'working' || soldOut} className="br-sans"
              style={{
                padding: '10px 22px', borderRadius: 999, border: `1px solid ${accent}`, background: accent,
                color: 'var(--bg)', fontSize: 14, cursor: soldOut ? 'default' : 'pointer',
                opacity: status === 'working' || soldOut ? 0.6 : 1,
              }}>
              {status === 'working' ? 'Working…' : soldOut ? 'Fully taken' : retryOrderId ? 'Retry settlement' : `Buy · ${offer.price_usdc.toFixed(2)} USDC`}
            </button>
            {account ? (
              <span className="br-sans" style={{ fontSize: 12, color: isViaWallet ? 'var(--live)' : 'var(--ink-3)' }}>
                {isViaWallet ? 'Your agent wallet' : 'Paying from'} <span style={{ fontFamily: 'monospace' }}>{account.address.slice(0, 6)}…{account.address.slice(-4)}</span>
                {balance !== null && <> · {balance.toFixed(2)} USDC</>}
              </span>
            ) : (
              <span className="br-sans" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {buyerWallet ? 'Connecting your agent wallet…' : 'Pays with your agent’s wallet.'}
              </span>
            )}
            {canWithdraw && (
              <button type="button" onClick={onWithdraw} className="br-sans"
                style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                Withdraw
              </button>
            )}
          </div>

          {open && !account && (
            <div style={{ marginTop: 10 }}>
              <p className="br-sans" style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 8px' }}>
                {buyerName
                  ? `${buyerName}, sign in to your VIA wallet with the email or Google you joined with. It stays connected after the first time, then buying is a single tap.`
                  : 'Sign in to your VIA wallet with the email or Google you joined with; it stays connected after the first time.'}
              </p>
              <button type="button" onClick={openWallet} disabled={isConnecting} className="br-sans"
                style={{ padding: '9px 16px', borderRadius: 4, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 13, cursor: 'pointer', opacity: isConnecting ? 0.6 : 1 }}>
                {isConnecting ? 'Opening…' : 'Sign in to your VIA wallet'}
              </button>
            </div>
          )}

          {open && account && needsPanel && !retryOrderId && (
            <div style={{ marginTop: 10 }}>
              {isRrg && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: isPhysical ? 8 : 0 }}>
                  <input className="br-sans" style={{ ...input, flex: '2 1 200px' }} type="email" placeholder="you@example.com (receipt + delivery)"
                    value={email} onChange={(e) => setEmail(e.target.value)} />
                  {offer.sizes.length > 0 && (
                    <select className="br-sans" value={size} onChange={(e) => setSize(e.target.value)} style={{ ...input, flex: '1 1 100px' }}>
                      <option value="">Size…</option>
                      {offer.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
              )}
              {isPhysical && (
                <>
                  <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '8px 0' }}>Delivery address</p>
                  <div style={{ display: 'grid', gap: 6, gridTemplateColumns: '1fr 1fr' }}>
                    <input className="br-sans" style={{ ...input, gridColumn: '1 / -1' }} placeholder="Full name" value={delivery.name} onChange={(e) => setDelivery((d) => ({ ...d, name: e.target.value }))} />
                    <input className="br-sans" style={{ ...input, gridColumn: '1 / -1' }} placeholder="Address line 1" value={delivery.address_line1} onChange={(e) => setDelivery((d) => ({ ...d, address_line1: e.target.value }))} />
                    <input className="br-sans" style={{ ...input, gridColumn: '1 / -1' }} placeholder="Address line 2 (optional)" value={delivery.address_line2} onChange={(e) => setDelivery((d) => ({ ...d, address_line2: e.target.value }))} />
                    <input className="br-sans" style={input} placeholder="City" value={delivery.city} onChange={(e) => setDelivery((d) => ({ ...d, city: e.target.value }))} />
                    <input className="br-sans" style={input} placeholder="Region (optional)" value={delivery.region} onChange={(e) => setDelivery((d) => ({ ...d, region: e.target.value }))} />
                    <input className="br-sans" style={input} placeholder="Postcode" value={delivery.postcode} onChange={(e) => setDelivery((d) => ({ ...d, postcode: e.target.value }))} />
                    <input className="br-sans" style={input} maxLength={2} placeholder="Country (ISO-2, e.g. GB)" value={delivery.country} onChange={(e) => setDelivery((d) => ({ ...d, country: e.target.value.toUpperCase() }))} />
                    <input className="br-sans" style={{ ...input, gridColumn: '1 / -1' }} placeholder="Phone" value={delivery.phone} onChange={(e) => setDelivery((d) => ({ ...d, phone: e.target.value }))} />
                  </div>
                </>
              )}
              <button type="button" onClick={() => void pay()} disabled={status === 'working'} className="br-sans"
                style={{ marginTop: 8, padding: '9px 18px', borderRadius: 999, border: `1px solid ${accent}`, background: accent, color: 'var(--bg)', fontSize: 13, cursor: 'pointer', opacity: status === 'working' ? 0.6 : 1 }}>
                {status === 'working' ? 'Working…' : `Pay ${offer.price_usdc.toFixed(2)} USDC`}
              </button>
            </div>
          )}

          {msg && <p className="br-sans" style={{ fontSize: 13, color: status === 'error' ? 'var(--danger)' : 'var(--ink-2)', margin: '8px 0 0' }}>{msg}</p>}
        </div>
      )}
    </article>
  );
}

/**
 * The brand side: pick one of your products (a VIA store's catalogue, or an
 * RRG brand's live drops fetched over the federation), set the room price and
 * terms, offer it to the room.
 */
function OfferComposer({
  roomId, handle, accent, onOffered, hasOffers,
}: {
  roomId: string; handle: string; accent: string;
  onOffered: (offers: RoomOffer[]) => void; hasOffers: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<SellerProductLite[] | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [productId, setProductId] = useState('');
  const [price, setPrice] = useState('');
  const [terms, setTerms] = useState('');
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || products !== null) return;
    void (async () => {
      const res = await fetch(`/api/backroom/room/${roomId}/offer?ref=${encodeURIComponent(handle)}`);
      if (res.ok) {
        const j = await res.json() as { your_products?: SellerProductLite[]; catalogue_error?: string };
        setProducts(j.your_products ?? []);
        setCatalogueError(j.catalogue_error ?? null);
      } else setProducts([]);
    })();
  }, [open, products, roomId, handle]);

  const pick = (id: string) => {
    setProductId(id);
    const p = products?.find((x) => x.id === id);
    if (p && !price) setPrice(String(p.price_usdc));
  };

  const submit = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/backroom/room/${roomId}/offer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: handle,
        product_id: productId,
        price_usd: Number(price),
        terms: terms.trim() || undefined,
        qty_cap: cap.trim() ? Number(cap) : undefined,
      }),
    });
    const json = await res.json().catch(() => ({})) as { offers?: RoomOffer[]; error?: string };
    setBusy(false);
    if (res.ok && json.offers) {
      onOffered(json.offers);
      setOpen(false); setProductId(''); setPrice(''); setTerms(''); setCap('');
      setMsg(null);
    } else {
      setMsg(json.error ?? 'could not create the offer');
    }
  };

  const selected = products?.find((p) => p.id === productId) ?? null;

  return (
    <div style={{ marginTop: hasOffers ? 10 : 0 }}>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="br-sans"
          style={{ fontSize: 12, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
          Offer a product to this room
        </button>
      ) : (
        <div style={{ border: '1px solid var(--line-strong)', borderRadius: 6, padding: 14, background: 'var(--paper)' }}>
          <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 10px' }}>
            Offer a product to this room
          </p>
          {products === null ? (
            <p className="br-sans" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>Loading your products…</p>
          ) : catalogueError ? (
            <p className="br-sans" style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>{catalogueError}</p>
          ) : products.length === 0 ? (
            <p className="br-sans" style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
              Your catalogue has no offerable products yet. List the product with your concierge first; it needs a USDC price and stock.
            </p>
          ) : (
            <>
              <select className="br-sans" value={productId} onChange={(e) => pick(e.target.value)} style={{ ...input, marginBottom: 8 }}>
                <option value="">Choose a product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} · {p.price_usdc.toFixed(2)} USDC ({p.kind}{p.remaining != null ? `, ${p.remaining} in stock` : ''})
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <label className="br-sans" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  Room price USDC{' '}
                  <input className="br-sans" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} style={{ ...input, width: 90, display: 'inline-block' }} />
                </label>
                <label className="br-sans" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  Cap (optional){' '}
                  <input className="br-sans" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9]/g, ''))} style={{ ...input, width: 70, display: 'inline-block' }} placeholder="none" />
                </label>
                {selected && Number(price) > 0 && Number(price) < selected.price_usdc && (
                  <span className="br-sans" style={{ fontSize: 12, color: accent }}>
                    {Math.round((1 - Number(price) / selected.price_usdc) * 100)}% under the list price
                  </span>
                )}
              </div>
              <textarea className="br-sans" value={terms} onChange={(e) => setTerms(e.target.value)} rows={2}
                placeholder="Purchase terms for the room, e.g. Room members first, ships next week, before the public drop."
                style={{ ...input, resize: 'vertical', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" onClick={() => void submit()} disabled={busy || !productId || !(Number(price) > 0)} className="br-sans"
                  style={{ padding: '9px 18px', borderRadius: 999, border: `1px solid ${accent}`, background: accent, color: 'var(--bg)', fontSize: 13, cursor: 'pointer', opacity: busy || !productId || !(Number(price) > 0) ? 0.5 : 1 }}>
                  {busy ? 'Offering…' : 'Offer it to the room'}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="br-sans"
                  style={{ fontSize: 12, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                  Cancel
                </button>
              </div>
            </>
          )}
          {msg && <p className="br-sans" style={{ fontSize: 13, color: 'var(--danger)', margin: '8px 0 0' }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
