'use client';

import { useState } from 'react';
import type { ShippingConfig, ShippingMode } from '@/lib/app/shipping';

interface Props {
  sellerId:              string;
  sellerSlug:            string;
  initialConfig:         ShippingConfig | null;
  initialReady:          boolean;
  initialPurchasePolicy: string;
}

const COMMON_COUNTRIES = [
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'SG', name: 'Singapore' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'DE', name: 'Germany' },
  { code: 'ES', name: 'Spain' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'CN', name: 'China' },
  { code: 'AU', name: 'Australia' },
  { code: 'CA', name: 'Canada' },
  { code: 'IE', name: 'Ireland' },
];

export function ShippingForm({ sellerId, initialConfig, initialReady, initialPurchasePolicy }: Props) {
  const [mode,           setMode]           = useState<ShippingMode>(initialConfig?.mode ?? 'flat_rate');
  const [shipsFrom,      setShipsFrom]      = useState(initialConfig?.shipsFromCountry ?? '');
  const [domestic,       setDomestic]       = useState(initialConfig?.domesticFlatUsd != null ? String(initialConfig.domesticFlatUsd) : '');
  const [hasIntl,        setHasIntl]        = useState(initialConfig?.internationalFlatUsd != null);
  const [intl,           setIntl]           = useState(initialConfig?.internationalFlatUsd != null ? String(initialConfig.internationalFlatUsd) : '');
  const [excludedInput,  setExcludedInput]  = useState('');
  const [excluded,       setExcluded]       = useState<string[]>(initialConfig?.excludedCountries ?? []);
  const [notes,          setNotes]          = useState(initialConfig?.notes ?? '');
  const [purchasePolicy, setPurchasePolicy] = useState(initialPurchasePolicy);
  const [ready,          setReady]          = useState(initialReady);
  const [saving,         setSaving]         = useState(false);
  const [err,            setErr]            = useState('');
  const [info,           setInfo]           = useState('');

  function addExcluded(code: string) {
    const c = code.trim().toUpperCase().slice(0, 2);
    if (!/^[A-Z]{2}$/.test(c)) return;
    if (excluded.includes(c)) return;
    setExcluded((prev) => [...prev, c]);
  }

  function removeExcluded(code: string) {
    setExcluded((prev) => prev.filter((c) => c !== code));
  }

  // Identify exactly which fields are blocking ready=true so messaging
  // is specific. Returns a short list of human-readable hints; empty
  // when the policy is ready.
  function missingFields(): string[] {
    if (mode === 'quote_on_purchase') return [];
    const out: string[] = [];
    if (!/^[A-Z]{2}$/.test(shipsFrom.trim().toUpperCase().slice(0, 2))) {
      out.push('a 2-letter ships-from country code');
    }
    const d = Number(domestic);
    if (domestic === '' || !Number.isFinite(d) || d < 0) {
      out.push('a domestic rate (0 if you only do free collection)');
    }
    return out;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setInfo('');
    setSaving(true);
    try {
      const payload: Partial<ShippingConfig> = mode === 'quote_on_purchase'
        ? { mode, notes: notes.trim() || undefined }
        : {
            mode,
            shipsFromCountry: shipsFrom.trim().toUpperCase().slice(0, 2) || undefined,
            domesticFlatUsd: domestic === '' ? undefined : Number(domestic),
            internationalFlatUsd: hasIntl ? (intl === '' ? undefined : Number(intl)) : null,
            excludedCountries: excluded,
            notes: notes.trim() || undefined,
          };

      const trimmedPolicy = purchasePolicy.trim().slice(0, 2000);
      const [shipRes, policyRes] = await Promise.all([
        fetch(`/api/seller/${sellerId}/shipping`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        }),
        fetch(`/api/seller/${sellerId}/settings`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ purchase_policy: trimmedPolicy.length > 0 ? trimmedPolicy : null }),
        }),
      ]);
      const json = await shipRes.json();
      if (!shipRes.ok) {
        setErr(json.error || `Shipping save failed (${shipRes.status})`);
        return;
      }
      if (!policyRes.ok) {
        const pjson = await policyRes.json().catch(() => ({}));
        setErr(pjson.error || `Purchase policy save failed (${policyRes.status})`);
        return;
      }
      // Reset to the value the server stored so the textarea reflects the
      // server's trim / truncate.
      setPurchasePolicy(trimmedPolicy);
      const stored = json.shipping as ShippingConfig | null;
      if (stored) {
        setMode(stored.mode);
        setShipsFrom(stored.shipsFromCountry ?? '');
        setDomestic(stored.domesticFlatUsd != null ? String(stored.domesticFlatUsd) : '');
        setHasIntl(stored.internationalFlatUsd != null);
        setIntl(stored.internationalFlatUsd != null ? String(stored.internationalFlatUsd) : '');
        setExcluded(stored.excludedCountries ?? []);
        setNotes(stored.notes ?? '');
      }
      setReady(Boolean(json.ready));
      if (json.ready) {
        setInfo('Shipping policy saved. Live for the next get_shipping_quote / buy_product call.');
      } else {
        const missing = missingFields();
        setInfo(missing.length > 0
          ? `Saved, but still draft. Add ${missing.join(' and ')} to go live for buyers. Or switch to "Quote on purchase" if you confirm cost per order.`
          : 'Saved as draft.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status strip */}
      {(() => {
        const missing = ready ? [] : missingFields();
        return (
          <div className={`border rounded-md px-4 py-3 text-sm ${
            ready
              ? 'bg-[color:var(--live)]/10 border-[color:var(--live)] text-[color:var(--live)]'
              : 'bg-[color:var(--warning)]/10 border-[color:var(--warning)] text-[color:var(--warning)]'
          }`}>
            {ready
              ? <>Status: <strong>ready</strong>. Buying agents calling <code className="font-mono text-xs">get_shipping_quote</code> get a real answer.</>
              : missing.length > 0
                ? <>Status: <strong>draft</strong>. Still need {missing.join(' and ')} before buyers can quote shipping.</>
                : <>Status: <strong>draft</strong>. Buying agents see <code className="font-mono text-xs">not_configured</code> on quote calls until this is saved.</>}
          </div>
        );
      })()}

      {err  && <div className="bg-[color:var(--danger)]/10 border border-[color:var(--danger)] text-[color:var(--danger)] text-sm rounded-md px-4 py-3">{err}</div>}
      {info && <div className="bg-[color:var(--live)]/10 border border-[color:var(--live)] text-[color:var(--live)] text-sm rounded-md px-4 py-3">{info}</div>}

      <form onSubmit={save} className="bg-paper border border-line rounded-lg p-5 space-y-6">
        {/* Mode picker */}
        <fieldset>
          <legend className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-3">Mode</legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className={`flex items-start gap-3 p-4 border rounded-md cursor-pointer transition-colors ${mode === 'flat_rate' ? 'border-ink bg-paper' : 'border-line-strong hover:border-ink'}`}>
              <input type="radio" name="mode" value="flat_rate" checked={mode === 'flat_rate'} onChange={() => setMode('flat_rate')} className="mt-1" />
              <div>
                <div className="font-medium text-sm">Flat rate</div>
                <p className="text-xs text-ink-2 mt-1">Same domestic + international rate on every order. Buyers get an instant total.</p>
              </div>
            </label>
            <label className={`flex items-start gap-3 p-4 border rounded-md cursor-pointer transition-colors ${mode === 'quote_on_purchase' ? 'border-ink bg-paper' : 'border-line-strong hover:border-ink'}`}>
              <input type="radio" name="mode" value="quote_on_purchase" checked={mode === 'quote_on_purchase'} onChange={() => setMode('quote_on_purchase')} className="mt-1" />
              <div>
                <div className="font-medium text-sm">Quote on purchase</div>
                <p className="text-xs text-ink-2 mt-1">You confirm the shipping cost per order. Buying agent sees <code className="font-mono text-xs">pending_merchant_quote</code> and waits.</p>
              </div>
            </label>
          </div>
        </fieldset>

        {mode === 'flat_rate' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label>
                <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Ships from (ISO)</span>
                <input
                  list="ship-from-countries"
                  type="text" value={shipsFrom} onChange={(e) => setShipsFrom(e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="GB"
                  maxLength={2}
                  className="w-full border border-line-strong rounded-md px-3 py-2 text-sm font-mono uppercase outline-none focus:border-ink"
                />
                <datalist id="ship-from-countries">
                  {COMMON_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </datalist>
                <p className="text-[10px] font-mono text-ink-3 mt-1">2-letter ISO 3166-1.</p>
              </label>

              <label>
                <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Domestic rate (USD)</span>
                <input
                  type="number" step="0.01" min="0" value={domestic} onChange={(e) => setDomestic(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink"
                />
              </label>

              <div>
                <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">International rate (USD)</span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-ink-2">
                    <input type="checkbox" checked={hasIntl} onChange={(e) => setHasIntl(e.target.checked)} />
                    Offer international
                  </label>
                </div>
                {hasIntl && (
                  <input
                    type="number" step="0.01" min="0" value={intl} onChange={(e) => setIntl(e.target.value)}
                    placeholder="0.00"
                    className="mt-2 w-full border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink"
                  />
                )}
              </div>
            </div>

            <div>
              <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-2">Excluded countries</span>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {excluded.map((c) => (
                  <span key={c} className="inline-flex items-center gap-2 bg-paper border border-line rounded-full px-3 py-1 text-xs font-mono">
                    {c}
                    <button type="button" onClick={() => removeExcluded(c)} className="text-ink-3 hover:text-[color:var(--danger)]">×</button>
                  </span>
                ))}
                {excluded.length === 0 && <span className="text-xs text-ink-3">None.</span>}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={excludedInput}
                  onChange={(e) => setExcludedInput(e.target.value.toUpperCase().slice(0, 2))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExcluded(excludedInput); setExcludedInput(''); } }}
                  placeholder="XX"
                  maxLength={2}
                  className="w-20 border border-line-strong rounded-md px-3 py-2 text-sm font-mono uppercase outline-none focus:border-ink"
                />
                <button
                  type="button"
                  onClick={() => { addExcluded(excludedInput); setExcludedInput(''); }}
                  className="text-xs font-mono uppercase tracking-widest text-ink-2 hover:text-ink"
                >
                  Add
                </button>
              </div>
              <p className="text-[10px] font-mono text-ink-3 mt-1">
                Buying agents requesting these get a <code>country_excluded</code> response and cannot buy.
              </p>
            </div>
          </>
        )}

        <label className="block">
          <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Notes (optional)</span>
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 400))}
            rows={3} maxLength={400}
            placeholder="Anything buying agents should know. Example: free over $200, 3-5 business days domestic, 7-14 international."
            className="w-full border border-line-strong rounded-md px-3 py-2 text-sm outline-none focus:border-ink"
          />
        </label>

        <div className="border-t border-line pt-5">
          <label className="block">
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Purchase policy</span>
            <p className="text-xs text-ink-2 mb-2">
              Surfaced to buying agents via{' '}
              <code className="font-mono text-xs">get_seller_info</code>. Use it to tell them what
              you need before they call{' '}
              <code className="font-mono text-xs">buy_product</code> on a physical product (full
              name, address, postcode, phone, anything else).
            </p>
            <textarea
              value={purchasePolicy} onChange={(e) => setPurchasePolicy(e.target.value.slice(0, 2000))}
              rows={4} maxLength={2000}
              placeholder="Physical orders require name, full delivery address with postcode, and a contact phone number. Orders ship within 2 business days from the UK."
              className="w-full border border-line-strong rounded-md px-3 py-2 text-sm outline-none focus:border-ink"
            />
            <p className="text-[10px] font-mono text-ink-3 mt-1">
              {purchasePolicy.length}/2000 characters
            </p>
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="submit" disabled={saving}
            className="px-5 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 transition-colors rounded-md"
          >
            {saving ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </form>
    </div>
  );
}
