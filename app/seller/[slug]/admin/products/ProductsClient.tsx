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
  image_url: string | null;
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
  if (!active) return <span className="inline-block px-2 py-0.5 bg-paper text-ink-2 text-[10px] font-mono uppercase rounded">Inactive</span>;
  switch (status) {
    case 'registered': return <span className="inline-block px-2 py-0.5 bg-[color:var(--live)]/15 text-[color:var(--live)] text-[10px] font-mono uppercase rounded">Registered</span>;
    case 'paused':     return <span className="inline-block px-2 py-0.5 bg-[color:var(--warning)]/15 text-[color:var(--warning)] text-[10px] font-mono uppercase rounded">Paused</span>;
    case 'sold_out':   return <span className="inline-block px-2 py-0.5 bg-[color:var(--danger)]/15 text-[color:var(--danger)] text-[10px] font-mono uppercase rounded">Sold out</span>;
    case 'draft':
    default:           return <span className="inline-block px-2 py-0.5 bg-paper text-ink-2 text-[10px] font-mono uppercase rounded">Draft</span>;
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
  const [imageFile, setImageFile] = useState<File | null>(null);

  // Per-row + global action state
  const [publishingId, setPublishingId]   = useState<string | null>(null);
  const [deletingId,   setDeletingId]     = useState<string | null>(null);
  const [uploadingId,  setUploadingId]    = useState<string | null>(null);
  const [syncing,      setSyncing]        = useState(false);

  // CSV upload state
  const [csvFile,    setCsvFile]      = useState<File | null>(null);
  const [csvBusy,    setCsvBusy]      = useState(false);
  const [csvErrors,  setCsvErrors]    = useState<{ row: string; field?: string; message: string }[] | null>(null);

  // Bulk publish state
  const [bulkBusy,     setBulkBusy]     = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; succeeded: number; failed: number }>({ done: 0, total: 0, succeeded: 0, failed: 0 });

  // Live listed count - server-rendered initial value, kept in sync as
  // we publish/remove products without forcing a full page reload.
  const liveListedCount = products.length > 0
    ? products.filter((p) => p.active && p.on_chain_status === 'registered').length
    : initialListedCount;
  const remainingSlots = Math.max(0, listedCap - liveListedCount);
  const capReached = remainingSlots === 0;

  // ── Catalogue source connection - live editable so existing sellers
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
    setImageFile(null);
  }

  // Upload a product image to the public bucket and stamp image_url. Used both
  // at create time (for the just-created row) and per-row for existing products.
  async function uploadImage(productId: string, file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/seller/${sellerId}/products/${productId}/image`, {
      method: 'POST',
      body: fd,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(json.error || `Image upload failed (${res.status})`);
      return null;
    }
    return json.image_url as string;
  }

  async function onRowImage(productId: string, file: File) {
    setErr('');
    setInfo('');
    setUploadingId(productId);
    try {
      const url = await uploadImage(productId, file);
      if (url) {
        setInfo('Image updated.');
        await refresh();
      }
    } finally {
      setUploadingId(null);
    }
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
      // Attach the image to the freshly-created product, if one was chosen.
      const newId = json.product?.id as string | undefined;
      if (newId && imageFile) {
        const url = await uploadImage(newId, imageFile);
        if (!url) {
          // Product was created; only the image failed. Keep the form's error
          // visible and still refresh so the new row shows, sans image.
          await refresh();
          return;
        }
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
    // Only attempt up to the remaining slots - the server enforces this
    // too, but a client-side stop avoids N pointless 409 round-trips.
    const toPublish = drafts.slice(0, remainingSlots);
    const skipped = drafts.length - toPublish.length;
    const skipNote = skipped > 0
      ? ` You have ${drafts.length} drafts but only ${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} left on the free tier - ${skipped} will stay as draft.`
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
            // Stop sending requests - the cap won't change mid-run.
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
        <div className="bg-[color:var(--danger)]/10 border border-[color:var(--danger)] text-[color:var(--danger)] text-sm rounded-md px-4 py-3">
          {err}
        </div>
      )}
      {info && (
        <div className="bg-[color:var(--live)]/10 border border-[color:var(--live)] text-[color:var(--live)] text-sm rounded-md px-4 py-3">
          {info}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-mono tracking-widest text-ink-3 uppercase">
            {products.length} product{products.length === 1 ? '' : 's'}
          </p>
          <span
            className={`text-[10px] font-mono uppercase tracking-widest border rounded px-2 py-0.5 ${
              capReached
                ? 'border-[color:var(--danger)] text-[color:var(--danger)] bg-[color:var(--danger)]/10'
                : liveListedCount >= listedCap - 2
                  ? 'border-[color:var(--warning)] text-[color:var(--warning)] bg-[color:var(--warning)]/10'
                  : 'border-line text-ink-3'
            }`}
            title={capReached
              ? `Free-tier cap reached. Unpublish or deactivate something to publish more.`
              : `Free tier: up to ${listedCap} listed items.`}
          >
            listed {liveListedCount} / {listedCap} (free tier)
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3 border border-line rounded px-2 py-0.5">
            {cur} → USDC
          </span>
          {src && (
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3 border border-line rounded px-2 py-0.5">
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
              className="px-4 py-2 border border-ink text-ink text-xs font-mono tracking-widest uppercase hover:bg-ink hover:text-background disabled:opacity-40 transition-colors rounded-md"
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
              className="px-4 py-2 border border-ink text-ink text-xs font-mono tracking-widest uppercase hover:bg-ink hover:text-background disabled:opacity-40 transition-colors rounded-md"
              title={`Sync from ${sqs}`}
            >
              {syncing ? 'Syncing…' : 'Sync Squarespace'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="px-4 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 transition-colors rounded-md"
          >
            {adding ? 'Close' : '+ Add product'}
          </button>
        </div>
      </div>

      {/* ── Catalogue-source connection panel ───────────────────────── */}
      <div className="bg-paper border border-line rounded-lg p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-1">Storefront connection</p>
            {hasSource ? (
              <p className="text-sm text-ink-2">
                Connected to <strong className="text-ink">{src}</strong>
                {src === 'shopify'     && shop && <> · <code className="font-mono text-xs">{shop}</code></>}
                {src === 'squarespace' && sqs  && <> · <code className="font-mono text-xs">{sqs}</code></>}
                {' · '}prices in <span className="font-mono text-xs">{cur}</span> converted to USDC at sync time.
              </p>
            ) : (
              <p className="text-sm text-ink-2">
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
              className="text-[10px] font-mono uppercase tracking-widest text-ink hover:underline whitespace-nowrap"
            >
              {hasSource ? 'Change' : 'Connect a store →'}
            </button>
          )}
        </div>

        {editingSrc && (
          <form onSubmit={saveSourceSettings} className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="md:col-span-2">
              <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Source</span>
              <select
                value={src ?? ''}
                onChange={(e) => setSrc((e.target.value || null) as typeof src)}
                className="w-full border border-line-strong rounded-md px-3 py-2 text-sm bg-paper outline-none focus:border-ink"
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
                <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Shopify domain</span>
                <input
                  type="text" required value={shop} onChange={(e) => setShop(e.target.value)}
                  placeholder="your-store.myshopify.com or shop.your-brand.com"
                  spellCheck={false} autoComplete="off"
                  className="w-full border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink"
                />
                <p className="text-[10px] font-mono text-ink-3 mt-1">
                  Public /products.json is fetched. Works on any store that hasn&apos;t disabled the JSON view.
                </p>
              </label>
            )}

            {src === 'squarespace' && (
              <label className="md:col-span-2">
                <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Squarespace shop URL</span>
                <input
                  type="url" required value={sqs} onChange={(e) => setSqs(e.target.value)}
                  placeholder="https://www.your-site.com/shop"
                  spellCheck={false} autoComplete="off"
                  className="w-full border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink"
                />
                <p className="text-[10px] font-mono text-ink-3 mt-1">
                  Paste the full URL to the shop page (the one ending in /shop or /shop-1).
                </p>
              </label>
            )}

            <label>
              <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Storefront currency</span>
              <select
                value={cur} onChange={(e) => setCur(e.target.value)}
                className="w-full border border-line-strong rounded-md px-3 py-2 text-sm bg-paper outline-none focus:border-ink"
              >
                {['USD','GBP','EUR','HKD','SGD','AUD','CAD','JPY','CNY','INR','CHF','SEK','NOK','DKK','NZD','BRL','MXN','ZAR','AED'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <p className="text-[10px] font-mono text-ink-3 mt-1">
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
                className="px-4 py-2 text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit" disabled={savingSrc}
                className="px-5 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 transition-colors rounded-md"
              >
                {savingSrc ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── CSV upload panel (visible when catalog_source = 'csv') ───── */}
      {src === 'csv' && (
        <div className="bg-paper border border-line rounded-lg p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-mono tracking-widest uppercase text-ink-3 mb-1">Spreadsheet upload</p>
              <p className="text-sm text-ink-2">
                Upload your catalogue as CSV or XLSX. Download the template, fill it in, then come
                back and upload. Re-uploading a row with the same <code className="font-mono text-xs">external_id</code> updates it in place.
              </p>
            </div>
            <a
              href="/templates/via-products.csv"
              download
              className="text-[10px] font-mono uppercase tracking-widest text-ink hover:underline whitespace-nowrap"
            >
              Download template ↓
            </a>
          </div>

          <label className="block text-xs font-mono uppercase tracking-widest text-ink-3 mb-2">
            Choose a file (.csv, .xlsx, .xls - max 5 MB)
          </label>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => { setCsvFile(e.target.files?.[0] ?? null); setCsvErrors(null); }}
            disabled={csvBusy}
            className="block w-full text-sm border border-line-strong rounded-md p-2 bg-paper file:mr-3 file:border-0 file:bg-paper file:px-3 file:py-1.5 file:text-xs file:font-mono file:uppercase file:tracking-widest"
          />

          <div className="flex items-center justify-between mt-3">
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">
              {csvFile ? csvFile.name : 'No file selected'}
              {' · '}
              prices in <span className="text-ink-2">{cur}</span> &rarr; converted to USDC at upload
            </span>
            <button
              type="button"
              onClick={() => void uploadCsv()}
              disabled={!csvFile || csvBusy}
              className="px-4 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 transition-colors rounded-md"
            >
              {csvBusy ? 'Uploading…' : 'Upload'}
            </button>
          </div>

          {csvErrors && csvErrors.length > 0 && (
            <div className="mt-4 border border-[color:var(--danger)] bg-[color:var(--danger)]/10 text-[color:var(--danger)] rounded-md p-3 text-xs">
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
        <form onSubmit={onCreate} className="bg-paper border border-line rounded-lg p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="md:col-span-2">
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Title</span>
            <input
              required value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-line-strong rounded-md px-3 py-2 text-sm outline-none focus:border-ink"
              maxLength={200}
            />
          </label>

          <label>
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Kind</span>
            <select
              value={kind} onChange={(e) => setKind(e.target.value as Product['kind'])}
              className="w-full border border-line-strong rounded-md px-3 py-2 text-sm bg-paper outline-none focus:border-ink"
            >
              <option value="physical">Physical</option>
              <option value="digital">Digital</option>
              <option value="service">Service</option>
            </select>
          </label>

          <label>
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Price (USDC)</span>
            <input
              required type="number" step="0.01" min="0"
              value={priceUsdc} onChange={(e) => setPriceUsdc(e.target.value)}
              className="w-full border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink"
            />
          </label>

          <label className="md:col-span-2">
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Description</span>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full border border-line-strong rounded-md px-3 py-2 text-sm outline-none focus:border-ink"
            />
          </label>

          <label>
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Stock (optional)</span>
            <input
              type="number" min="0" placeholder="Leave blank for unlimited"
              value={stock} onChange={(e) => setStock(e.target.value)}
              className="w-full border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink"
            />
          </label>

          <label>
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Max supply (on-chain, optional)</span>
            <input
              type="number" min="1" placeholder="Blank = 1,000,000,000"
              value={maxSupply} onChange={(e) => setMaxSupply(e.target.value)}
              className="w-full border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink"
            />
          </label>

          <label>
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Product URL (optional)</span>
            <input
              type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              className="w-full border border-line-strong rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-ink"
            />
          </label>

          <label className="md:col-span-2">
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3 block mb-1">Product image (optional, JPEG/PNG/WebP, max 8 MB)</span>
            <input
              type="file" accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm border border-line-strong rounded-md p-2 bg-paper file:mr-3 file:border-0 file:bg-paper file:px-3 file:py-1.5 file:text-xs file:font-mono file:uppercase file:tracking-widest"
            />
            {imageFile && (
              <span className="text-[10px] font-mono text-ink-3 mt-1 block">{imageFile.name}</span>
            )}
          </label>


          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit" disabled={busy}
              className="px-5 py-2 bg-ink text-background text-xs font-mono tracking-widest uppercase hover:opacity-90 disabled:opacity-40 transition-colors rounded-md"
            >
              {busy ? 'Saving&hellip;' : 'Save as draft'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-ink-3">Loading&hellip;</p>
      ) : products.length === 0 ? (
        <p className="text-sm text-ink-3">
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
              ? 'bg-[color:var(--danger)]/10 border-[color:var(--danger)] text-[color:var(--danger)]'
              : 'bg-[color:var(--warning)]/10 border-[color:var(--warning)] text-[color:var(--warning)]';
            const btnTheme      = capReached
              ? 'bg-[color:var(--danger)] text-background hover:opacity-90'
              : 'bg-[color:var(--warning)] text-background hover:opacity-90';
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

        <div className="bg-paper border border-line rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs font-mono uppercase tracking-widest text-ink-3">
              <tr>
                <th className="text-left px-4 py-3">Image</th>
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3">Kind</th>
                <th className="text-right px-4 py-3">Price (USDC)</th>
                <th className="text-right px-4 py-3">Stock</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--line)]">
              {products.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3">
                    <label className="cursor-pointer block" title={p.image_url ? 'Replace image' : 'Add image'}>
                      <input
                        type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                        disabled={uploadingId === p.id}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void onRowImage(p.id, f);
                          e.target.value = '';
                        }}
                      />
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image_url}
                          alt={p.title}
                          className="h-12 w-12 object-cover rounded border border-line-strong bg-paper"
                        />
                      ) : (
                        <span className="inline-flex h-12 w-12 items-center justify-center rounded border border-dashed border-line-strong text-[8px] font-mono uppercase tracking-widest text-ink-3 text-center leading-tight">
                          {uploadingId === p.id ? '...' : 'Add image'}
                        </span>
                      )}
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{p.title}</div>
                    {p.token_id != null && (
                      <div className="text-[10px] font-mono text-ink-3 mt-0.5">
                        token #{p.token_id}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-2 capitalize">{p.kind}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {(Number(p.price_minor) / 1_000_000).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-ink-2">
                    {p.stock == null ? '∞' : p.stock}
                  </td>
                  <td className="px-4 py-3">{statusBadge(p.on_chain_status, p.active)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {p.active && p.on_chain_status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => void onPublish(p)}
                        disabled={publishingId === p.id}
                        className="mr-3 text-[10px] font-mono uppercase tracking-widest text-ink hover:underline disabled:opacity-40"
                      >
                        {publishingId === p.id ? 'Publishing…' : 'Publish'}
                      </button>
                    )}
                    {p.active && (
                      <button
                        type="button"
                        onClick={() => void onDelete(p)}
                        disabled={deletingId === p.id}
                        className="text-[10px] font-mono uppercase tracking-widest text-ink-3 hover:text-[color:var(--danger)] disabled:opacity-40"
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

      <p className="text-[10px] font-mono text-ink-3 leading-relaxed">
        Buying agents see registered + active products at <code>/sellers/{sellerSlug}/mcp</code>{' '}
        via the <code>list_products</code> tool. Drafts stay private until published.
      </p>
    </div>
  );
}
