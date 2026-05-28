'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardSteps } from '../OnboardSteps';
import {
  readOnboardState,
  writeOnboardState,
  clearOnboardState,
  type SellerOnboardState,
} from '@/lib/app/onboarding-state';

export default function OnboardCatalog() {
  const router = useRouter();
  const [state,    setState]    = useState<SellerOnboardState | null>(null);
  const [source,   setSource]   = useState<'shopify' | 'csv' | 'services'>('services');
  const [shopify,  setShopify]  = useState('');
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');

  useEffect(() => {
    const s = readOnboardState();
    if (!s || s.role !== 'seller' || !s.email || !s.sellerName || !s.walletAddress) {
      router.replace('/onboard?role=seller');
      return;
    }
    setState(s);
    if (s.catalogSource) setSource(s.catalogSource);
    if (s.shopifyDomain) setShopify(s.shopifyDomain);
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!state) return;
    if (source === 'shopify' && !/^[a-zA-Z0-9.-]+\.myshopify\.com$/.test(shopify.trim())) {
      setErr('Shopify domain must look like your-store.myshopify.com');
      return;
    }

    writeOnboardState({
      role: 'seller',
      catalogSource: source,
      shopifyDomain: source === 'shopify' ? shopify.trim() : undefined,
    });

    setBusy(true);
    try {
      const res = await fetch('/api/seller/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:         state.email,
          password:      state.password,
          sellerName:    state.sellerName,
          slug:          state.slug,
          kind:          state.kind,
          description:   state.description,
          websiteUrl:    state.websiteUrl,
          walletAddress: state.walletAddress,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Could not create your seller account.'); setBusy(false); return; }

      // Clear local state (it held the password); session cookie is set server-side.
      clearOnboardState();
      router.push(`/onboard/agent?slug=${encodeURIComponent(data.seller.slug)}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'network error — please retry');
      setBusy(false);
    }
  }

  if (!state) return null;

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardSteps current={4} />
        <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Step 4 of 5</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          How does your catalog work?
        </h1>
        <p className="text-neutral-600 mb-10 max-w-lg">
          We pick this up so your Sales Agent has something concrete to pitch. You can change
          it later from the dashboard.
        </p>

        <form onSubmit={onSubmit} className="space-y-5 max-w-xl">
          <fieldset>
            <legend className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-3">Catalog source</legend>
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-4 border rounded-md cursor-pointer ${source === 'shopify' ? 'border-neutral-900 bg-white' : 'border-neutral-300 bg-white/50 hover:border-neutral-600'}`}>
                <input type="radio" name="src" value="shopify" checked={source === 'shopify'} onChange={() => setSource('shopify')} className="mt-1" />
                <div>
                  <div className="font-medium">Shopify store</div>
                  <div className="text-sm text-neutral-600">We poll your public catalog and surface live stock. Your storefront stays as-is.</div>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-4 border rounded-md cursor-pointer ${source === 'csv' ? 'border-neutral-900 bg-white' : 'border-neutral-300 bg-white/50 hover:border-neutral-600'}`}>
                <input type="radio" name="src" value="csv" checked={source === 'csv'} onChange={() => setSource('csv')} className="mt-1" />
                <div>
                  <div className="font-medium">Upload a CSV later</div>
                  <div className="text-sm text-neutral-600">Add products manually from the dashboard after onboarding.</div>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-4 border rounded-md cursor-pointer ${source === 'services' ? 'border-neutral-900 bg-white' : 'border-neutral-300 bg-white/50 hover:border-neutral-600'}`}>
                <input type="radio" name="src" value="services" checked={source === 'services'} onChange={() => setSource('services')} className="mt-1" />
                <div>
                  <div className="font-medium">I sell services</div>
                  <div className="text-sm text-neutral-600">Describe your offer to the Sales Agent in the next step. No catalog to sync.</div>
                </div>
              </label>
            </div>
          </fieldset>

          {source === 'shopify' && (
            <label className="block">
              <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-2">Shopify domain</span>
              <input
                type="text"
                value={shopify}
                onChange={(e) => setShopify(e.target.value)}
                placeholder="your-store.myshopify.com"
                className="w-full bg-white border border-neutral-300 px-4 py-3 text-base font-mono outline-none focus:border-neutral-900 transition-colors rounded-md"
              />
            </label>
          )}

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => router.push('/onboard/wallet')}
              className="text-xs font-mono tracking-widest uppercase text-neutral-500 hover:text-neutral-900 transition-colors disabled:opacity-40"
            >
              <span aria-hidden>←</span> Back
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-6 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md disabled:opacity-50"
            >
              {busy ? 'Creating account…' : 'Create Sales Agent →'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
