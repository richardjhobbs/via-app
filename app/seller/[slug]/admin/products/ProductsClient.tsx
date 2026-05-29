'use client';

import { useEffect, useState } from 'react';

interface Product {
  id: string;
  kind: 'physical' | 'digital' | 'service';
  title: string;
  description: string | null;
  price_minor: number;
  currency: string;
  stock: number | null;
  max_supply: number | null;
  url: string | null;
  active: boolean;
  token_id: number | null;
  on_chain_status: 'draft' | 'registered' | 'paused' | 'sold_out';
  on_chain_tx_hash: string | null;
  created_at: string;
  updated_at?: string;
}

interface Props {
  sellerId: string;
  sellerSlug: string;
  sellerKind: string;
  catalogSource: 'shopify' | 'squarespace' | 'csv' | 'services' | null;
  shopifyDomain: string | null;
  squarespaceShopUrl: string | null;
  sourceCurrency: string;
  listedCount: number;
  listedCap: number;
}

function statusBadge(status: Product['on_chain_status'], active: boolean) {
  if (!active) return <span className="inline-block px-2 py-0.5 bg-neutral-200 text-neutral-600 text-[10px] font-mono uppercase rounded">Inactive</span>;
  switch (status) {
    case 'registered': return <span className="inline-block px-2 py-0.5 bg-green-100 text-green-800 text-[10px] font-mono uppercase rounded">Registered</span>;
    case 'paused':     return <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-mono uppercase rounded">Paused</span>;
    case 'sold_out':   return <span className="inline-block px-2 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-mono uppercase rounded">Sold out</span>;
    case 'draft':
    default:           return <span className="inline-block px-2 py-0.5 bg-neutral-200 text-neutral-700 text-[10px] font-mono uppercase rounded">Draft</span>;
  }
}

export function ProductsClient({
  sellerId,
  sellerSlug,
  sellerKind,
  catalogSource,
  shopifyDomain,
  squarespaceShopUrl,
  sourceCurrency,
  listedCount: initialListedCount,
  listedCap,
}: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState('');
  const [info, setInfo]         = useState('');

  // Add-form state
  const [adding, setAdding]     = useState(false);
  const [busy, setBusy]         = useState(false);
  const defaultKind = sellerKind === 'service' ? 'service' : 'physical';
  const [kind, setKind]         = useState<Product['kind']>(defaultKind);
  const [title, setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [priceUsdc, setPriceUsdc] = useState('');
  const [stock, setStock]       = useState('');
  const [maxSupply, setMaxSupply] = useState('');
  const [url, setUrl]           = useState('');

  // Per-row + global action state
  const [publishingId, setPublishingId]   = useState<string | null>(null);
  const [deletingId,   setDeletingId]     = useState<string | null>(null);
  const [syncing,      setSyncing]        = useState(false);

  // CSV upload state
  const [csvFile,    setCsvFile]      = useState<File | null>(null);
  const [csvBusy,    setCsvBusy]      = useState(false);
  const [csvErrors,  setCsvErrors]    = useState<{ row: string; field?: string; message: string }[] | null>(null);

  // Bulk publish state
  const [bulkBusy,     setBulkBusy]     = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; succeeded: number; failed: number }>({ done: 0, total: 0, succeeded: 0, failed: 0 });

  // Live listed count — server-rendered initial value, kept in sync as
  // we publish/remove products without forcing a full page reload.
  const liveListedCount = products.length > 0
    ? products.filter((p) => p.active && p.on_chain_status === 'registered').length
    : initialListedCount;
  const remainingSlots = Math.max(0, listedCap - liveListedCount);
  const capReached = remainingSlots === 0;

  // ── Catalogue source connection — live editable so existing sellers
  //    (incl. arc-lights) can connect or switch their store source after
  //    onboarding. Locally mirrors what the server passed in, then PATCHes
  //    /settings on save and updates state from the server response.
  const [src,  setSrc]                = useState<'shopify' | 'squarespace' | 'csv' | 'services' | null>(catalogSource);
  const [shop, setShop]               = useState(shopifyDomain ?? '');
  const [sqs,  setSqs]                = useState(squarespaceShopUrl ?? '');
  const [cur,  setCur]                = useState(sourceCurrency);
  const [editingSrc, setEditingSrc]   = useState(false);
  const [savingSrc,  setSavingSrc]    = useState(false);

  const hasSource = src === 'shopify' || src === 'squarespace';

  async function saveSourceSettings(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setInfo('');
    setSavingSrc(true);
    try {
      const payload: Record<string, unknown> = {
        catalog_source:  src,
        source_currency: cur,
      };
      if (src === 'shopify')     payload.shopify_domain       = shop.trim() || null;
      if (src === 'squarespace') payload.squarespace_shop_url = sqs.trim()  || null;
      const res = await fetch(`/api/seller/${sellerId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Settings save failed (${res.status})`);
        return;
      }
      // Mirror the server's authoritative values back into local state.
      const s = json.seller;
      setSrc(s.catalog_source as typeof src);
      setShop(s.shopify_domain ?? '');
      setSqs(s.squarespace_shop_url ?? '');
      setCur(s.source_currency ?? 'USD');
      setEditingSrc(false);
      setInfo('Catalogue source saved.');
    } finally {
      setSavingSrc(false);
    }
  }

  async function refresh() {
    setErr('');
    try {
      const res = await fetch(`/api/seller/${sellerId}/products`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Load failed (${res.status})`);
        return;
      }
      setProducts(json.products ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerId]);

  function resetForm() {
    setKind(defaultKind);
    setTitle('');
    setDescription('');
    setPriceUsdc('');
    setStock('');
    setMaxSupply('');
    setUrl('');
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setInfo('');
    const priceNum = Number(priceUsdc);
    if (!isFinite(priceNum) || priceNum < 0) {
      setErr('Price must be a non-negative number (USDC).');
      return;
    }
    setBusy(true);
    try {
      const body = {
        kind,
        title:       title.trim(),
        description: description.trim() || null,
        price_usdc:  priceNum,
        stock:       stock      === '' ? null : Number(stock),
        max_supply:  maxSupply  === '' ? null : Number(maxSupply),
        url:         url.trim()         || null,
      };
      const res = await fetch(`/api/seller/${sellerId}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Create failed (${res.status})`);
        return;
      }
      resetForm();
      setAdding(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function bulkPublish() {
    if (bulkBusy) return;
    const drafts = products.filter((p) => p.active && p.on_chain_status === 'draft');
    if (drafts.length === 0) return;
    if (capReached) {
      setErr(`Free-tier cap of ${listedCap} listed items reached (${liveListedCount}/${listedCap}). Unpublish or deactivate an existing product first.`);
      return;
    }
    // Only attempt up to the remaining slots — the server enforces this
    // too, but a client-side stop avoids N pointless 409 round-trips.
    const toPublish = drafts.slice(0, remainingSlots);
    const skipped = drafts.length - toPublish.length;
    const skipNote = skipped > 0
      ? ` You have ${drafts.length} drafts but only ${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} left on the free tier — ${skipped} will stay as draft.`
      : '';
    if (!confirm(`Publish ${toPublish.length} draft product${toPublish.length === 1 ? '' : 's'}? Each one is registered on-chain and immediately becomes visible to buying agents calling list_products on this seller's MCP.${skipNote}`)) return;
    setErr('');
    setInfo('');
    setBulkBusy(true);
    setBulkProgress({ done: 0, total: toPublish.length, succeeded: 0, failed: 0 });
    let succeeded = 0;
    let failed = 0;
    const failures: { title: string; reason: string }[] = [];
    let capHit = false;
    // Sequential to keep server pressure low and to give the
    // app_next_token_id RPC a clean monotonic order.
    for (let i = 0; i < toPublish.length; i++) {
      const p = toPublish[i];
      try {
        const res = await fetch(`/api/seller/${sellerId}/products/${p.id}/publish`, { method: 'POST' });
        const json = await res.json();
        if (res.ok) {
          succeeded++;
        } else {
          failed++;
          if (json.code === 'free_listed_cap_reached') {
            capHit = true;
            failures.push({ title: p.title, reason: json.error ?? 'free-tier cap reached' });
            // Stop sending requests — the cap won't change mid-run.
            setBulkProgress({ done: i + 1, total: toPublish.length, succeeded, failed });
            break;
          }
          failures.push({ title: p.title, reason: json.error ?? `HTTP ${res.status}` });
        }
      } catch (e) {
        failed++;
        failures.push({ title: p.title, reason: e instanceof Error ? e.message : 'network error' });
      }
      setBulkProgress({ done: i + 1, total: toPublish.length, succeeded, failed });
    }
    setBulkBusy(false);
    await refresh();
    const skippedTail = skipped > 0
      ? ` (${skipped} draft${skipped === 1 ? '' : 's'} left untouched because the free tier caps you at ${listedCap} listed items)`
      : '';
    if (capHit) {
      setErr(`Published ${succeeded}, then hit the free-tier cap of ${listedCap} listed items. Unpublish or deactivate something to make room for the remaining drafts.`);
    } else if (failed === 0) {
      setInfo(`Published ${succeeded} product${succeeded === 1 ? '' : 's'}. They are now live on the per-seller MCP.${skippedTail}`);
    } else {
      const top = failures.slice(0, 3).map((f) => `• ${f.title}: ${f.reason}`).join('\n');
      setErr(`Published ${succeeded}, ${failed} failed:\n${top}${failures.length > 3 ? `\n…and ${failures.length - 3} more.` : ''}`);
    }
  }

  async function uploadCsv() {
    if (csvBusy || !csvFile) return;
    setErr('');
    setInfo('');
    setCsvErrors(null);
    setCsvBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', csvFile);
      const res = await fetch(`/api/seller/${sellerId}/products/sync-csv`, {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (res.status === 422) {
        setCsvErrors(json.errors ?? []);
        setErr(`Upload rejected: ${json.errors?.length ?? 0} validation issue${json.errors?.length === 1 ? '' : 's'} (see below).`);
        return;
      }
      if (!res.ok) {
        setErr(json.error || `Upload failed (${res.status})`);
        return;
      }
      const errs = (json.errors as string[] | undefined) ?? [];
      const fxNote = json.fx?.note ? ` · FX: ${json.fx.note}` : '';
      setInfo(`CSV ${json.filename ?? ''}: parsed ${json.rowsParsed}, inserted ${json.synced}, updated ${json.updated}, skipped ${json.skipped}${errs.length ? `, errors ${errs.length}` : ''}${fxNote}`);
      setCsvFile(null);
      await refresh();
    } finally {
      setCsvBusy(false);
    }
  }

  async function runSync(kind: 'shopify' | 'squarespace', label: string) {
    if (syncing) return;
    if (!confirm(`Pull catalog from ${label}? Prices converted to USDC at the current FX rate (${cur} → USDC). Existing rows with matching IDs are updated.`)) return;
    setErr('');
    setInfo('');
    setSyncing(true);
    try {
      const res = await fetch(`/api/seller/${sellerId}/products/sync-${kind}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Sync failed (${res.status})`);
        return;
      }
      const errs = (json.errors as string[] | undefined) ?? [];
      const fxNote = json.fx?.note ? ` · FX: ${json.fx.note}` : '';
      setInfo(`${kind} sync: fetched ${json.fetched}, inserted ${json.synced}, updated ${json.updated}, skipped ${json.skipped}${errs.length ? `, errors ${errs.length}` : ''}${fxNote}`);
      await refresh();
    } finally {
      setSyncing(false);
    }
  }

  async function onPublish(p: Product) {
    if (publishingId) return;
    setErr('');
    setPublishingId(p.id);
    try {
      const res = await fetch(`/api/seller/${sellerId}/products/${p.id}/publish`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Publish failed (${res.status})`);
        return;
      }
      await refresh();
    } finally {
      setPublishingId(null);
    }
  }

  async function onDelete(p: Product) {
    if (deletingId) return;
    if (!confirm(`Deactivate "${p.title}"? It will stop appearing in MCP list_products.`)) return;
    setErr('');
    setDeletingId(p.id);
    try {
      const res = await fetch(`/api/seller/${sellerId}/products/${p.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `Delete failed (${res.status})`);
        return;
      }
      await refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-8">
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md px-4 py-3">
          {err}
        </div>
      )}
      {info && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm rounded-md px-4 py-3">
          {info}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-mono tracking-widest text-neutral-500 uppercase">
            {products.length} product{products.length === 1 ? '' : 's'}
          </p>
          <span
            className={`text-[10px] font-mono uppercase tracking-widest border rounded px-2 py-0.5 ${
              capReached
                ? 'border-rose-300 text-rose-800 bg-rose-50'
                : liveListedCount >= listedCap - 2
                  ? 'border-amber-300 text-amber-800 bg-amber-50'
                  : 'border-neutral-200 text-neutral-500'
            }`}
            title={capReached
              ? `Free-tier cap reached. Unpublish or deactivate something to publish more.`
              : `Free tier: up to ${listedCap} listed items.`}
          >
            listed {liveListedCount} / {listedCap} (free tier)
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 border border-neutral-200 rounded px-2 py-0.5">
            {cur} → USDC
          </span>
          {src && (
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 border border-neutral-200 rounded px-2 py-0.5">
              source: {src}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {src === 'shopify' && shop && (
            <button
              type="button"
              onClick={() => void runSync('shopify', shop)}
              disabled={syncing}
              className="px-4 py-2 border border-neutral-900 text-neutral-900 text-xs font-mono tracking-widest uppercase hover:bg-neutral-900 hover:text-neutral-50 disabled:opacity-40 transition-colors rounded-md"
              title={`Sync from ${shop}`}
            >
              {syncing ? 'Syncing…' : `Sync Shopify (${shop})`}
            </button>
          )}
          {src === 'squarespace' && sqs && (
            <button
              type="button"
              onClick={() => void runSync('squarespace', sqs)}
              disabled={syncing}
              className="px-4 py-2 border border-neutral-900 text-neutral-900 text-xs font-mono tracking-widest uppercase hover:bg-neutral-900 hover:text-neutral-50 disabled:opacity-40 transition-colors rounded-md"
              title={`Sync from ${sqs}`}
            >
              {syncing ? 'Syncing…' : 'Sync Squarespace'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="px-4 py-2 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
          >
            {adding ? 'Close' : '+ Add product'}
          </button>
        </div>
      </div>

      {/* ── Catalogue-source connection panel ───────────────────────── */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-mono tracking-widest uppercase text-neutral-500 mb-1">Storefront connection</p>
            {hasSource ? (
              <p className="text-sm text-neutral-700">
                Connected to <strong className="text-neutral-900">{src}</strong>
                {src === 'shopify'     && shop && <> · <code className="font-mono text-xs">{shop}</code></>}
                {src === 'squarespace' && sqs  && <> · <code className="font-mono text-xs">{sqs}</code></>}
                {' · '}prices in <span className="font-mono text-xs">{cur}</span> converted to USDC at sync time.
              </p>
            ) : (
              <p className="text-sm text-neutral-700">
                No store connected. Connect Shopify or Squarespace to pull your catalogue and resync any
                time. Sellers without a store or a different provider can upload their products and
                inventory at this stage and then add new products manually below.
              </p>
            )}
          </div>
          {!editingSrc && (
            <button
              type="button"
              onClick={() => setEditingSrc(true)}
              className="text-[10px] font-mono uppercase tracking-widest text-neutral-900 hover:underline whitespace-nowrap"
            >
              {hasSource ? 'Change' : 'Connect a store →'}
            </button>
          )}
        </div>

        {editingSrc && (
          <form onSubmit={saveSourceSettings} className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="md:col-span-2">
              <span className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Source</span>
              <select
                value={src ?? ''}
                onChange={(e) => setSrc((e.target.value || null) as typeof src)}
                className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm bg-white outline-none focus:border-neutral-900"
              >
                <option value="">None (manual products only)</option>
                <option value="shopify">Shopify</option>
                <option value="squarespace">Squarespace</option>
                <option value="csv">CSV (placeholder)</option>
                <option value="services">Services (no catalog import)</option>
              </select>
            </label>

            {src === 'shopify' && (
              <label className="md:col-span-2">
                <span className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Shopify domain</span>
                <input
                  type="text" required value={shop} onChange={(e) => setShop(e.target.value)}
                  placeholder="your-store.myshopify.com or shop.your-brand.com"
                  spellCheck={false} autoComplete="off"
                  className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-neutral-900"
                />
                <p className="text-[10px] font-mono text-neutral-400 mt-1">
                  Public /products.json is fetched. Works on any store that hasn&apos;t disabled the JSON view.
                </p>
              </label>
            )}

            {src === 'squarespace' && (
              <label className="md:col-span-2">
                <span className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Squarespace shop URL</span>
                <input
                  type="url" required value={sqs} onChange={(e) => setSqs(e.target.value)}
                  placeholder="https://www.your-site.com/shop"
                  spellCheck={false} autoComplete="off"
                  className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-neutral-900"
                />
                <p className="text-[10px] font-mono text-neutral-400 mt-1">
                  Paste the full URL to the shop page (the one ending in /shop or /shop-1).
                </p>
              </label>
            )}

            <label>
              <span className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Storefront currency</span>
              <select
                value={cur} onChange={(e) => setCur(e.target.value)}
                className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm bg-white outline-none focus:border-neutral-900"
              >
                {['USD','GBP','EUR','HKD','SGD','AUD','CAD','JPY','CNY','INR','CHF','SEK','NOK','DKK','NZD','BRL','MXN','ZAR','AED'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <p className="text-[10px] font-mono text-neutral-400 mt-1">
                Prices on your storefront. Converted to USDC via frankfurter.app + 3% spread at each sync.
              </p>
            </label>

            <div className="md:col-span-2 flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  // Reset back to server-state values
                  setSrc(catalogSource); setShop(shopifyDomain ?? ''); setSqs(squarespaceShopUrl ?? ''); setCur(sourceCurrency);
                  setEditingSrc(false);
                }}
                disabled={savingSrc}
                className="px-4 py-2 text-xs font-mono tracking-widest uppercase text-neutral-500 hover:text-neutral-900 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit" disabled={savingSrc}
                className="px-5 py-2 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 disabled:opacity-40 transition-colors rounded-md"
              >
                {savingSrc ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── CSV upload panel (visible when catalog_source = 'csv') ───── */}
      {src === 'csv' && (
        <div className="bg-white border border-neutral-200 rounded-lg p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-mono tracking-widest uppercase text-neutral-500 mb-1">Spreadsheet upload</p>
              <p className="text-sm text-neutral-700">
                Upload your catalogue as CSV or XLSX. Download the template, fill it in, then come
                back and upload. Re-uploading a row with the same <code className="font-mono text-xs">external_id</code> updates it in place.
              </p>
            </div>
            <a
              href="/templates/via-products.csv"
              download
              className="text-[10px] font-mono uppercase tracking-widest text-neutral-900 hover:underline whitespace-nowrap"
            >
              Download template ↓
            </a>
          </div>

          <label className="block text-xs font-mono uppercase tracking-widest text-neutral-500 mb-2">
            Choose a file (.csv, .xlsx, .xls — max 5 MB)
          </label>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => { setCsvFile(e.target.files?.[0] ?? null); setCsvErrors(null); }}
            disabled={csvBusy}
            className="block w-full text-sm border border-neutral-300 rounded-md p-2 bg-white file:mr-3 file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-xs file:font-mono file:uppercase file:tracking-widest"
          />

          <div className="flex items-center justify-between mt-3">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
              {csvFile ? csvFile.name : 'No file selected'}
              {' · '}
              prices in <span className="text-neutral-600">{cur}</span> &rarr; converted to USDC at upload
            </span>
            <button
              type="button"
              onClick={() => void uploadCsv()}
              disabled={!csvFile || csvBusy}
              className="px-4 py-2 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 disabled:opacity-40 transition-colors rounded-md"
            >
              {csvBusy ? 'Uploading…' : 'Upload'}
            </button>
          </div>

          {csvErrors && csvErrors.length > 0 && (
            <div className="mt-4 border border-rose-200 bg-rose-50 text-rose-900 rounded-md p-3 text-xs">
              <p className="font-medium mb-2">
                {csvErrors.length} issue{csvErrors.length === 1 ? '' : 's'} to fix before this CSV can be accepted:
              </p>
              <ul className="space-y-1 list-disc pl-4">
                {csvErrors.slice(0, 15).map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
                {csvErrors.length > 15 && (
                  <li className="italic opacity-70">…and {csvErrors.length - 15} more.</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {adding && (
        <form onSubmit={onCreate} className="bg-white border border-neutral-200 rounded-lg p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="md:col-span-2">
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Title</span>
            <input
              required value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm outline-none focus:border-neutral-900"
              maxLength={200}
            />
          </label>

          <label>
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Kind</span>
            <select
              value={kind} onChange={(e) => setKind(e.target.value as Product['kind'])}
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm bg-white outline-none focus:border-neutral-900"
            >
              <option value="physical">Physical</option>
              <option value="digital">Digital</option>
              <option value="service">Service</option>
            </select>
          </label>

          <label>
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Price (USDC)</span>
            <input
              required type="number" step="0.01" min="0"
              value={priceUsdc} onChange={(e) => setPriceUsdc(e.target.value)}
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-neutral-900"
            />
          </label>

          <label className="md:col-span-2">
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Description</span>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </label>

          <label>
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Stock (optional)</span>
            <input
              type="number" min="0" placeholder="Leave blank for unlimited"
              value={stock} onChange={(e) => setStock(e.target.value)}
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-neutral-900"
            />
          </label>

          <label>
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Max supply (on-chain, optional)</span>
            <input
              type="number" min="1" placeholder="Blank = 1,000,000,000"
              value={maxSupply} onChange={(e) => setMaxSupply(e.target.value)}
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-neutral-900"
            />
          </label>

          <label>
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-500 block mb-1">Product URL (optional)</span>
            <input
              type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-neutral-900"
            />
          </label>


          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit" disabled={busy}
              className="px-5 py-2 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 disabled:opacity-40 transition-colors rounded-md"
            >
              {busy ? 'Saving&hellip;' : 'Save as draft'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading&hellip;</p>
      ) : products.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No products yet. Click + Add product above, save a draft, then click Publish to mint it
          on-chain and make it discoverable.
        </p>
      ) : (
        <>
          {/* ── Publish explainer + bulk publish strip ──────────────── */}
          {(() => {
            const draftCount    = products.filter((p) => p.active && p.on_chain_status === 'draft').length;
            const willPublish   = Math.min(draftCount, remainingSlots);
            const capSkip       = Math.max(0, draftCount - remainingSlots);
            const stripTheme    = capReached
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-amber-50 border-amber-200 text-amber-900';
            const btnTheme      = capReached
              ? 'bg-rose-900 text-rose-50 hover:bg-rose-800'
              : 'bg-amber-900 text-amber-50 hover:bg-amber-800';
            return (
              <div className={`flex flex-wrap items-center justify-between gap-3 border rounded-md px-4 py-3 ${stripTheme}`}>
                <p className="text-sm">
                  <strong>Publish your products to make them visible to buying agents.</strong>{' '}
                  {capReached
                    ? `You are at the free-tier cap (${listedCap} listed). Unpublish or deactivate an existing product to make room.`
                    : draftCount === 0
                      ? `All active products are already published. Buying agents see them via list_products on your MCP.`
                      : capSkip > 0
                        ? `${draftCount} draft${draftCount === 1 ? '' : 's'} waiting; the free tier lets you publish ${willPublish} now (${capSkip} will stay as draft). Each publish writes an on-chain record.`
                        : `${draftCount} draft${draftCount === 1 ? '' : 's'} waiting. Each publish writes an on-chain record.`}
                </p>
                {draftCount > 0 && !capReached && (
                  <button
                    type="button"
                    onClick={() => void bulkPublish()}
                    disabled={bulkBusy}
                    className={`px-4 py-2 text-xs font-mono tracking-widest uppercase disabled:opacity-40 transition-colors rounded-md whitespace-nowrap ${btnTheme}`}
                    title={`Publish ${willPublish} draft${willPublish === 1 ? '' : 's'} on-chain`}
                  >
                    {bulkBusy
                      ? `Publishing ${bulkProgress.done}/${bulkProgress.total}…`
                      : `Bulk publish (${willPublish})`}
                  </button>
                )}
              </div>
            );
          })()}

        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs font-mono uppercase tracking-widest text-neutral-500">
              <tr>
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3">Kind</th>
                <th className="text-right px-4 py-3">Price (USDC)</th>
                <th className="text-right px-4 py-3">Stock</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {products.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-900">{p.title}</div>
                    {p.token_id != null && (
                      <div className="text-[10px] font-mono text-neutral-400 mt-0.5">
                        token #{p.token_id}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-600 capitalize">{p.kind}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {(Number(p.price_minor) / 1_000_000).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-neutral-600">
                    {p.stock == null ? '∞' : p.stock}
                  </td>
                  <td className="px-4 py-3">{statusBadge(p.on_chain_status, p.active)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {p.active && p.on_chain_status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => void onPublish(p)}
                        disabled={publishingId === p.id}
                        className="mr-3 text-[10px] font-mono uppercase tracking-widest text-neutral-900 hover:underline disabled:opacity-40"
                      >
                        {publishingId === p.id ? 'Publishing…' : 'Publish'}
                      </button>
                    )}
                    {p.active && (
                      <button
                        type="button"
                        onClick={() => void onDelete(p)}
                        disabled={deletingId === p.id}
                        className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-rose-700 disabled:opacity-40"
                      >
                        {deletingId === p.id ? 'Removing…' : 'Remove'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <p className="text-[10px] font-mono text-neutral-400 leading-relaxed">
        Buying agents see registered + active products at <code>/sellers/{sellerSlug}/mcp</code>{' '}
        via the <code>list_products</code> tool. Drafts stay private until published.
      </p>
    </div>
  );
}
