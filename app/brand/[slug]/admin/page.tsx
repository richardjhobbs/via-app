'use client';

import { useState, useEffect, useCallback } from 'react';
import { useBrandContext } from './layout';
import BrandTermsModal from '@/components/rrg/BrandTermsModal';
import HelpTip from '@/components/rrg/HelpTip';
import { brandAdmin, briefFields, voucherFields } from '@/lib/rrg/help-content';
import { BRAND_TC_VERSION } from '@/lib/rrg/terms';

// ── Types ──────────────────────────────────────────────────────────
interface Submission {
  id: string;
  title: string;
  description?: string | null;
  creator_wallet: string;
  creator_email?: string | null;
  creator_bio?: string | null;
  status: string;
  created_at: string;
  previewUrl?: string | null;
  brief_id?: string | null;
  suggestedEdition?: string;
  suggestedPrice?: string;
}

interface Drop {
  id: string;
  title: string;
  token_id: number;
  price_usdc: string;
  edition_size: number;
  approved_at: string;
  additional_files_path?: string | null;
  additional_files_size_bytes?: number | null;
}

interface Distribution {
  id: string;
  created_at: string;
  total_usdc: string;
  creator_usdc: string;
  brand_usdc: string;
  platform_usdc: string;
  split_type: string;
  status: string;
}

interface SalesStats {
  totalSales: number;
  totalRevenue: number;
  brandRevenue: number;
}

interface BrandSettings {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  headline?: string | null;
  contact_email: string;
  wallet_address: string;
  website_url?: string | null;
  social_links?: Record<string, string>;
  logo_path?: string | null;
  banner_path?: string | null;
  max_self_listings: number;
  self_listings_used: number;
  tc_accepted_at?: string | null;
  tc_version?: string | null;
  accepts_card_payments?: boolean;
}

const SOCIAL_PLATFORMS = [
  { key: 'twitter', label: 'X / Twitter', placeholder: 'https://x.com/...' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/...' },
  { key: 'bluesky', label: 'BlueSky', placeholder: 'https://bsky.app/profile/...' },
  { key: 'telegram', label: 'Telegram', placeholder: 'https://t.me/...' },
  { key: 'discord', label: 'Discord', placeholder: 'https://discord.gg/...' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/...' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@...' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/...' },
  { key: 'github', label: 'GitHub', placeholder: 'https://github.com/...' },
];

interface Brief {
  id: string;
  created_at: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  status: 'active' | 'closed' | 'archived';
  is_current: boolean;
  response_count: number;
}

type Tab = 'submissions' | 'products' | 'briefs' | 'vouchers' | 'sales' | 'settings';

export default function BrandAdminPage() {
  const ctx = useBrandContext();
  const [tab, setTab] = useState<Tab>('submissions');

  if (!ctx) return null;

  return (
    <>
      {/* Tabs */}
      <div className="border-b border-white/10 px-6 flex gap-6">
        {(['submissions', 'products', 'briefs', 'vouchers', 'sales', 'settings'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-3 text-sm font-mono uppercase tracking-widest transition-colors border-b-2 -mb-px
              ${tab === t
                ? 'text-white border-white'
                : 'text-white/50 border-transparent hover:text-white/80'
              }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-6 py-8 max-w-5xl">
        {tab === 'submissions' && <><div className="flex items-center gap-2 mb-4"><h2 className="text-xs font-mono text-white/40 uppercase tracking-widest">Submissions</h2><HelpTip {...brandAdmin.submissions} /></div><SubmissionsTab brandId={ctx.brandId} /></>}
        {tab === 'products'    && <><div className="flex items-center gap-2 mb-4"><h2 className="text-xs font-mono text-white/40 uppercase tracking-widest">Products</h2><HelpTip {...brandAdmin.drops} /></div><ProductsTab brandId={ctx.brandId} /></>}
        {tab === 'briefs'      && <><div className="flex items-center gap-2 mb-4"><h2 className="text-xs font-mono text-white/40 uppercase tracking-widest">Briefs</h2><HelpTip {...brandAdmin.briefs} /></div><BriefsTab brandId={ctx.brandId} /></>}
        {tab === 'vouchers'    && <VouchersTab brandId={ctx.brandId} />}
        {tab === 'sales'       && <SalesTab brandId={ctx.brandId} />}
        {tab === 'settings'    && <><div className="flex items-center gap-2 mb-4"><h2 className="text-xs font-mono text-white/40 uppercase tracking-widest">Settings</h2><HelpTip {...brandAdmin.settings} /></div><SettingsTab brandId={ctx.brandId} /></>}
      </div>
    </>
  );
}

// ── Submissions Tab ───────────────────────────────────────────────
function SubmissionsTab({ brandId }: { brandId: string }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [acting,      setActing]      = useState<string | null>(null);
  const [approveForm, setApproveForm] = useState<{ id: string; edition_size: string; price_usdc: string } | null>(null);
  const [rejectForm,  setRejectForm]  = useState<{ id: string; reason: string } | null>(null);
  const [msg,         setMsg]         = useState('');
  const [lightbox,    setLightbox]    = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/brand/${brandId}/submissions`);
    const data = await res.json();
    const parsed = (data.submissions || []).map((s: Submission) => {
      const match = (s.description || '').match(/\[Suggested: (\S+) ed · \$([0-9.]+) USDC\]/);
      return {
        ...s,
        suggestedEdition: match?.[1] ?? '',
        suggestedPrice:   match?.[2] ?? '',
        description:      s.description?.replace(/\n?\[Suggested:[^\]]+\]/, '').trim() || null,
      };
    });
    setSubmissions(parsed);
    setLoading(false);
  }, [brandId]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveForm) return;
    setActing(approveForm.id);
    setMsg('');
    const res = await fetch(`/api/brand/${brandId}/approve`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        submissionId: approveForm.id,
        edition_size: approveForm.edition_size,
        price_usdc:   approveForm.price_usdc,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg(`Approved ✓ Token #${data.tokenId} — tx: ${data.txHash?.slice(0, 10)}…`);
      setApproveForm(null);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
    setActing(null);
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectForm) return;
    setActing(rejectForm.id);
    setMsg('');
    const res = await fetch(`/api/brand/${brandId}/reject`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        submissionId: rejectForm.id,
        reason:       rejectForm.reason,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg('Rejected ✓');
      setRejectForm(null);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
    setActing(null);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-mono uppercase tracking-widest text-white/60">
          Pending Submissions
        </h2>
        <button
          onClick={load}
          className="text-sm text-white/50 hover:text-white transition-colors font-mono"
        >
          ↻ Refresh
        </button>
      </div>

      {msg && (
        <div className={`mb-4 p-3 border text-sm font-mono ${
          msg.startsWith('Error') ? 'border-red-400/30 text-red-400' : 'border-white/20 text-green-400'
        }`}>
          {msg}
        </div>
      )}

      {loading ? (
        <p className="text-white/40 text-sm font-mono">Loading…</p>
      ) : submissions.length === 0 ? (
        <p className="text-white/40 text-sm font-mono">No pending submissions.</p>
      ) : (
        <div className="space-y-6">
          {submissions.map((s) => (
            <div key={s.id} className="border border-white/10 overflow-hidden">
              {/* Header */}
              <div className="flex gap-4 p-5">
                {/* Preview image */}
                {s.previewUrl && (
                  <button
                    type="button"
                    onClick={() => setLightbox(s.previewUrl!)}
                    className="w-24 h-24 flex-shrink-0 bg-white/5 overflow-hidden cursor-zoom-in"
                  >
                    <img
                      src={s.previewUrl}
                      alt={s.title}
                      className="w-full h-full object-cover"
                    />
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="text-base font-medium truncate pr-2">{s.title}</h3>
                    <span className="text-sm font-mono text-white/50 flex-shrink-0">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {s.description && (
                    <p className="text-sm text-white/60 leading-relaxed mb-2 line-clamp-2">
                      {s.description}
                    </p>
                  )}
                  <div className="flex gap-4 text-sm text-white/40 font-mono flex-wrap">
                    <span title={s.creator_wallet}>
                      Wallet: {s.creator_wallet.slice(0, 6)}…{s.creator_wallet.slice(-4)}
                    </span>
                    {s.creator_email && <span>{s.creator_email}</span>}
                  </div>
                  {(s.suggestedEdition || s.suggestedPrice) && (
                    <div className="mt-2 text-sm font-mono text-amber-400/60">
                      Suggested: {s.suggestedEdition ? `${s.suggestedEdition} ed` : ''}
                      {s.suggestedEdition && s.suggestedPrice ? ' · ' : ''}
                      {s.suggestedPrice ? `$${s.suggestedPrice} USDC` : ''}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              {approveForm?.id === s.id ? (
                <form onSubmit={handleApprove} className="border-t border-white/10 p-4 flex gap-3 items-end flex-wrap">
                  <div>
                    <label className="text-sm font-mono text-white/60 block mb-1">Edition size (1–500)</label>
                    <input
                      type="number" required min={1} max={500}
                      value={approveForm.edition_size}
                      onChange={(e) => setApproveForm({ ...approveForm, edition_size: e.target.value })}
                      className="w-24 bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-mono text-white/60 block mb-1">Price USDC</label>
                    <input
                      type="number" required min={0.01} max={500} step={0.01}
                      value={approveForm.price_usdc}
                      onChange={(e) => setApproveForm({ ...approveForm, price_usdc: e.target.value })}
                      className="w-24 bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={acting === s.id}
                    className="px-5 py-1.5 bg-white text-black text-base font-medium
                               hover:bg-white/90 disabled:opacity-40 transition-all"
                  >
                    {acting === s.id ? 'Approving…' : 'Confirm Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setApproveForm(null)}
                    className="text-sm text-white/50 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </form>
              ) : rejectForm?.id === s.id ? (
                <form onSubmit={handleReject} className="border-t border-white/10 p-4 flex gap-3 items-end flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-sm font-mono text-white/60 block mb-1">Reason (optional)</label>
                    <input
                      type="text" maxLength={500}
                      placeholder="Reason for rejection…"
                      value={rejectForm.reason}
                      onChange={(e) => setRejectForm({ ...rejectForm, reason: e.target.value })}
                      className="w-full bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={acting === s.id}
                    className="px-5 py-1.5 border border-red-400/40 text-red-400 text-base font-medium
                               hover:bg-red-400/10 disabled:opacity-40 transition-all"
                  >
                    {acting === s.id ? 'Rejecting…' : 'Confirm Reject'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectForm(null)}
                    className="text-sm text-white/50 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="border-t border-white/10 p-4 flex gap-3">
                  <button
                    onClick={() => setApproveForm({
                      id: s.id,
                      edition_size: s.suggestedEdition || '10',
                      price_usdc:   s.suggestedPrice || '5',
                    })}
                    className="px-4 py-1.5 bg-white/10 text-white text-sm font-medium
                               hover:bg-white/20 transition-all"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => setRejectForm({ id: s.id, reason: '' })}
                    className="px-4 py-1.5 border border-white/15 text-white/70 text-sm font-medium
                               hover:border-white/30 hover:text-white/80 transition-all"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Full preview"
            className="max-w-[90vw] max-h-[90vh] object-contain"
          />
        </div>
      )}
    </div>
  );
}

// ── Products Tab ──────────────────────────────────────────────────
function ProductsTab({ brandId }: { brandId: string }) {
  const [drops,    setDrops]    = useState<Drop[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [msg,      setMsg]      = useState('');
  const [acting,   setActing]   = useState(false);
  const [brand,    setBrand]    = useState<BrandSettings | null>(null);
  const [voucherTemplates, setVoucherTemplates] = useState<{ id: string; title: string; voucher_type: string }[]>([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    price_usdc: '5',
    edition_size: '10',
    voucher_template_id: '',
    // Physical product fields
    is_physical_product: false,
    physical_description: '',
    price_includes_tax: false,
    price_includes_packing: false,
    ecommerce_url: '',
    shipping_type: 'included' as 'included' | 'quote_after_payment',
    shipping_included_regions: [] as string[],
    refund_commitment: false,
    collection_in_person: '',
    trust_behavior_accepted: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [additionalFiles, setAdditionalFiles] = useState<File[]>([]);
  const [physicalImages, setPhysicalImages] = useState<File[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [dropsRes, settingsRes, vouchersRes] = await Promise.all([
      fetch(`/api/brand/${brandId}/products`),
      fetch(`/api/brand/${brandId}/settings`),
      fetch(`/api/brand/${brandId}/vouchers`),
    ]);
    const dropsData    = await dropsRes.json();
    const settingsData = await settingsRes.json();
    setDrops(dropsData.drops || []);
    setBrand(settingsData.brand || null);
    if (vouchersRes.ok) {
      const vData = await vouchersRes.json();
      setVoucherTemplates(
        (vData.templates || []).filter((t: { status: string }) => t.status === 'active')
      );
    }
    setLoading(false);
  }, [brandId]);

  useEffect(() => { load(); }, [load]);

  const canSelfList = brand
    ? brand.self_listings_used < brand.max_self_listings
    : false;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setMsg('Image required'); return; }
    setActing(true);
    setMsg('');

    const fd = new FormData();
    fd.append('title', form.title);
    fd.append('description', form.description);
    fd.append('price_usdc', form.price_usdc);
    fd.append('edition_size', form.edition_size);
    fd.append('jpeg', file);
    for (const af of additionalFiles) {
      fd.append('additional_files', af);
    }
    // Voucher template
    if (form.voucher_template_id) {
      fd.append('voucher_template_id', form.voucher_template_id);
    }
    // Physical product fields
    if (form.is_physical_product) {
      fd.append('is_physical_product', '1');
      fd.append('physical_description', form.physical_description);
      fd.append('price_includes_tax', form.price_includes_tax ? '1' : '0');
      fd.append('price_includes_packing', form.price_includes_packing ? '1' : '0');
      if (form.ecommerce_url) fd.append('ecommerce_url', form.ecommerce_url);
      fd.append('shipping_type', form.shipping_type);
      if (form.shipping_type === 'included' && form.shipping_included_regions.length > 0) {
        fd.append('shipping_included_regions', form.shipping_included_regions.join(','));
      }
      fd.append('refund_commitment', form.refund_commitment ? '1' : '0');
      if (form.collection_in_person) fd.append('collection_in_person', form.collection_in_person);
      fd.append('trust_behavior_accepted', form.trust_behavior_accepted ? '1' : '0');
      for (const pImg of physicalImages) {
        fd.append('physical_images', pImg);
      }
    }

    const res  = await fetch(`/api/brand/${brandId}/products/create`, { method: 'POST', body: fd });
    const data = await res.json();
    setActing(false);

    if (res.ok) {
      setMsg(`Listed ✓ Token #${data.tokenId} — ${data.dropUrl}`);
      setForm({
        title: '', description: '', price_usdc: '5', edition_size: '10',
        voucher_template_id: '',
        is_physical_product: false, physical_description: '', price_includes_tax: false,
        price_includes_packing: false, ecommerce_url: '', shipping_type: 'included',
        shipping_included_regions: [], refund_commitment: false, collection_in_person: '',
        trust_behavior_accepted: false,
      });
      setFile(null);
      setAdditionalFiles([]);
      setPhysicalImages([]);
      setCreating(false);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-mono uppercase tracking-widest text-white/60">Products</h2>
        {canSelfList ? (
          <button
            onClick={() => setCreating(!creating)}
            className="text-sm border border-white/30 px-4 py-1.5 hover:border-white transition-all"
          >
            {creating ? 'Cancel' : '+ Add Product'}
          </button>
        ) : (
          <span className="text-sm font-mono text-amber-400/60">
            Self-listing cap reached ({brand?.max_self_listings})
          </span>
        )}
      </div>

      {brand && (
        <p className="text-sm text-white/40 font-mono mb-4">
          Self-listings: {brand.self_listings_used} / {brand.max_self_listings}
        </p>
      )}

      {msg && (
        <div className="mb-4 p-3 border border-white/20 bg-white/5 text-sm font-mono text-white/80">
          {msg}
        </div>
      )}

      {creating && (
        <form onSubmit={handleCreate} className="mb-8 p-6 border border-white/20 space-y-4">
          <h3 className="text-base font-medium mb-2">New Product</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Title *</label>
              <input
                type="text" required maxLength={60}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Image (JPEG/PNG) *</label>
              <input
                type="file" required
                accept="image/jpeg,image/jpg,image/png"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-white/60 file:bg-white/10 file:border-0 file:px-3 file:py-2
                           file:text-white file:text-sm file:mr-3 file:cursor-pointer"
              />
            </div>
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Price (USDC) *</label>
              <input
                type="number" required min={0.01} max={500} step={0.01}
                value={form.price_usdc}
                onChange={(e) => setForm({ ...form, price_usdc: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Edition Size *</label>
              <input
                type="number" required min={1} max={500}
                value={form.edition_size}
                onChange={(e) => setForm({ ...form, edition_size: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Description</label>
            <textarea
              rows={7} maxLength={1500}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none resize-none"
            />
            <p className="text-sm text-white/40 mt-0.5 text-right">{form.description.length}/1500</p>
          </div>
          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">
              Additional Files <span className="text-white/40">(optional — delivered to buyers post-purchase, max 5 MB total)</span>
            </label>
            <input
              type="file"
              multiple
              onChange={(e) => setAdditionalFiles(Array.from(e.target.files || []))}
              className="w-full text-sm text-white/60 file:bg-white/10 file:border-0 file:px-3 file:py-2
                         file:text-white file:text-sm file:mr-3 file:cursor-pointer"
            />
            {additionalFiles.length > 0 && (
              <p className="text-sm text-white/40 mt-1 font-mono">
                {additionalFiles.length} file{additionalFiles.length !== 1 ? 's' : ''} selected
                ({(additionalFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB)
              </p>
            )}
            <p className="text-sm text-white/40 mt-1">
              ZIP, PDF, SVG, AI, PSD, etc. — these are perks delivered to the buyer.
            </p>
          </div>
          {/* ── Voucher Template ───────────────────────────────── */}
          {voucherTemplates.length > 0 && (
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">
                Attach Voucher <span className="text-white/40">(optional — buyers receive this voucher on purchase)</span>
              </label>
              <select
                value={form.voucher_template_id}
                onChange={(e) => setForm({ ...form, voucher_template_id: e.target.value })}
                className="w-full bg-black border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              >
                <option value="">None</option>
                {voucherTemplates.map((vt) => (
                  <option key={vt.id} value={vt.id}>
                    {vt.title} ({vt.voucher_type.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ── Physical Product Toggle ────────────────────────── */}
          <div className="pt-2 border-t border-white/10">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_physical_product}
                onChange={(e) => setForm({ ...form, is_physical_product: e.target.checked })}
                className="accent-lime-400 w-4 h-4"
              />
              <span className="text-base">This product includes a physical item</span>
            </label>
          </div>

          {form.is_physical_product && (
            <div className="space-y-4 p-5 border border-lime-400/20 bg-lime-400/5">
              <p className="text-sm font-mono uppercase tracking-widest text-lime-400/60 mb-2">
                Physical Product Details
              </p>

              {/* Physical description */}
              <div>
                <label className="text-sm font-mono text-white/60 block mb-1">Product Description</label>
                <textarea
                  rows={3} maxLength={1000}
                  value={form.physical_description}
                  onChange={(e) => setForm({ ...form, physical_description: e.target.value })}
                  placeholder="Describe the physical product — materials, dimensions, condition, etc."
                  className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none resize-none placeholder:text-white/60"
                />
                <p className="text-sm text-white/40 mt-0.5 text-right">{form.physical_description.length}/1000</p>
              </div>

              {/* Physical images (up to 4) */}
              <div>
                <label className="text-sm font-mono text-white/60 block mb-1">
                  Product Photos <span className="text-white/40">(up to 4, JPEG/PNG, 5 MB each)</span>
                </label>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/jpg,image/png"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []).slice(0, 4);
                    setPhysicalImages(files);
                  }}
                  className="w-full text-sm text-white/60 file:bg-white/10 file:border-0 file:px-3 file:py-2
                             file:text-white file:text-sm file:mr-3 file:cursor-pointer"
                />
                {physicalImages.length > 0 && (
                  <p className="text-sm text-white/40 mt-1 font-mono">
                    {physicalImages.length} photo{physicalImages.length !== 1 ? 's' : ''} selected
                  </p>
                )}
              </div>

              {/* Tax + Packing checkboxes */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.price_includes_tax}
                    onChange={(e) => setForm({ ...form, price_includes_tax: e.target.checked })}
                    className="accent-lime-400 w-3.5 h-3.5"
                  />
                  <span className="text-sm text-white/80">Price includes all applicable taxes</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.price_includes_packing}
                    onChange={(e) => setForm({ ...form, price_includes_packing: e.target.checked })}
                    className="accent-lime-400 w-3.5 h-3.5"
                  />
                  <span className="text-sm text-white/80">Price includes packing for shipment</span>
                </label>
              </div>

              {/* E-commerce URL */}
              <div>
                <label className="text-sm font-mono text-white/60 block mb-1">
                  Existing E-commerce URL <span className="text-white/40">(optional)</span>
                </label>
                <input
                  type="url"
                  value={form.ecommerce_url}
                  onChange={(e) => setForm({ ...form, ecommerce_url: e.target.value })}
                  placeholder="https://your-store.com/product"
                  className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none placeholder:text-white/60"
                />
              </div>

              {/* Shipping type */}
              <div>
                <label className="text-sm font-mono text-white/60 block mb-2">Shipping *</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio" name="shipping_type" value="included"
                      checked={form.shipping_type === 'included'}
                      onChange={() => setForm({ ...form, shipping_type: 'included' })}
                      className="accent-lime-400"
                    />
                    <span className="text-sm text-white/80">Price includes shipping to selected regions</span>
                  </label>
                  {form.shipping_type === 'included' && (
                    <div className="ml-7 flex flex-wrap gap-2 mt-1">
                      {['US', 'UK', 'EU', 'Asia-Pacific', 'Middle East', 'Africa', 'South America', 'Oceania', 'Other'].map((region) => (
                        <label key={region} className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={form.shipping_included_regions.includes(region)}
                            onChange={(e) => {
                              const newRegions = e.target.checked
                                ? [...form.shipping_included_regions, region]
                                : form.shipping_included_regions.filter(r => r !== region);
                              setForm({ ...form, shipping_included_regions: newRegions });
                            }}
                            className="accent-lime-400 w-3 h-3"
                          />
                          <span className="text-sm text-white/70">{region}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio" name="shipping_type" value="quote_after_payment"
                      checked={form.shipping_type === 'quote_after_payment'}
                      onChange={() => setForm({ ...form, shipping_type: 'quote_after_payment', shipping_included_regions: [] })}
                      className="accent-lime-400"
                    />
                    <span className="text-sm text-white/80">Brand will quote shipping after payment</span>
                  </label>
                </div>
              </div>

              {/* Collection in person */}
              <div>
                <label className="text-sm font-mono text-white/60 block mb-1">
                  Collection in Person Location <span className="text-white/40">(optional)</span>
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={form.collection_in_person}
                  onChange={(e) => setForm({ ...form, collection_in_person: e.target.value })}
                  placeholder="e.g. Studio 5, Shoreditch, London"
                  className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none placeholder:text-white/60"
                />
              </div>

              {/* Required checkboxes */}
              <div className="space-y-2 pt-2 border-t border-lime-400/10">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.refund_commitment}
                    onChange={(e) => setForm({ ...form, refund_commitment: e.target.checked })}
                    className="accent-lime-400 w-3.5 h-3.5 mt-0.5"
                  />
                  <span className="text-sm text-white/80 leading-relaxed">
                    I commit to refunding the buyer (in USDC) if the physical product cannot be shipped or delivered as described *
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.trust_behavior_accepted}
                    onChange={(e) => setForm({ ...form, trust_behavior_accepted: e.target.checked })}
                    className="accent-lime-400 w-3.5 h-3.5 mt-0.5"
                  />
                  <span className="text-sm text-white/80 leading-relaxed">
                    I confirm that physical product fulfilment is subject to the Brand Partner Terms &amp; Conditions (see Settings tab) *
                  </span>
                </label>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={acting || (form.is_physical_product && (!form.refund_commitment || !form.trust_behavior_accepted))}
            className="px-6 py-2 bg-white text-black text-base font-medium hover:bg-white/90
                       disabled:opacity-40 transition-all"
          >
            {acting ? 'Listing on-chain…' : 'List Product →'}
          </button>
          <p className="text-sm text-white/40">
            This will register the drop on-chain and make it immediately purchasable.
          </p>
          {form.is_physical_product && (!form.refund_commitment || !form.trust_behavior_accepted) && (
            <p className="text-sm text-amber-400/60 -mt-2">
              Accept the refund commitment and Brand Partner Terms above to enable listing.
            </p>
          )}
        </form>
      )}

      {loading ? (
        <p className="text-white/40 text-sm font-mono">Loading…</p>
      ) : drops.length === 0 ? (
        <p className="text-white/40 text-sm font-mono">No products listed yet.</p>
      ) : (
        <div className="space-y-3">
          {drops.map((d) => (
            <div key={d.id} className="p-4 border border-white/10">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-base font-medium">{d.title}</p>
                  <div className="flex gap-4 mt-1 text-sm text-white/50 font-mono">
                    <span>Token #{d.token_id}</span>
                    <span>${parseFloat(d.price_usdc).toFixed(2)} USDC</span>
                    <span>{d.edition_size} ed.</span>
                    <span>{new Date(d.approved_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <a
                  href={`/rrg/drop/${d.token_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-white/50 hover:text-white transition-colors"
                >
                  View ↗
                </a>
              </div>
              {d.additional_files_path && (
                <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                  <span className="text-sm font-mono text-white/50">
                    Additional files attached
                    {d.additional_files_size_bytes
                      ? ` (${(d.additional_files_size_bytes / 1024 / 1024).toFixed(1)} MB)`
                      : ''}
                  </span>
                  <button
                    onClick={async () => {
                      if (!confirm('Remove additional files from this product? This cannot be undone.')) return;
                      setMsg('');
                      const res = await fetch(`/api/brand/${brandId}/products/${d.id}/files`, { method: 'DELETE' });
                      if (res.ok) {
                        setMsg('Additional files removed ✓');
                        load();
                      } else {
                        const data = await res.json();
                        setMsg(`Error: ${data.error}`);
                      }
                    }}
                    className="text-sm text-red-400/60 hover:text-red-400 transition-colors font-mono"
                  >
                    Remove files ×
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Briefs Tab ────────────────────────────────────────────────────
function BriefsTab({ brandId }: { brandId: string }) {
  const [briefs,   setBriefs]   = useState<Brief[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [acting,   setActing]   = useState(false);
  const [msg,      setMsg]      = useState('');

  const [form, setForm] = useState({
    title: '',
    description: '',
    ends_at: '',
    is_current: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    ends_at: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/brand/${brandId}/briefs`);
    const data = await res.json();
    setBriefs(data.briefs || []);
    setLoading(false);
  }, [brandId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setActing(true);
    setMsg('');

    const res = await fetch(`/api/brand/${brandId}/briefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setActing(false);

    if (res.ok) {
      setMsg('Brief created ✓');
      setForm({ title: '', description: '', ends_at: '', is_current: true });
      setCreating(false);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  const handleAction = async (briefId: string, action: string) => {
    setActing(true);
    setMsg('');

    const res = await fetch(`/api/brand/${brandId}/briefs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ briefId, action }),
    });
    const data = await res.json();
    setActing(false);

    if (res.ok) {
      setMsg(action === 'set_current' ? 'Set as current ✓' :
             action === 'close'       ? 'Brief closed ✓' :
             action === 'archive'     ? 'Brief archived ✓' :
             action === 'activate'    ? 'Brief activated ✓' : 'Updated ✓');
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  const startEdit = (b: Brief) => {
    setEditingId(b.id);
    setEditForm({
      title: b.title,
      description: b.description,
      ends_at: b.ends_at ? b.ends_at.split('T')[0] : '',
    });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setActing(true);
    setMsg('');

    const res = await fetch(`/api/brand/${brandId}/briefs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        briefId: editingId,
        action: 'update',
        title: editForm.title,
        description: editForm.description,
        ends_at: editForm.ends_at || null,
      }),
    });
    const data = await res.json();
    setActing(false);

    if (res.ok) {
      setMsg('Brief updated ✓');
      setEditingId(null);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  const statusColor = (s: string) => {
    if (s === 'active')   return 'bg-green-400/20 text-green-400';
    if (s === 'closed')   return 'bg-amber-400/20 text-amber-400';
    return 'bg-white/10 text-white/60';
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-mono uppercase tracking-widest text-white/60">Briefs</h2>
        <button
          onClick={() => setCreating(!creating)}
          className="text-sm border border-white/30 px-4 py-1.5 hover:border-white transition-all"
        >
          {creating ? 'Cancel' : '+ New Brief'}
        </button>
      </div>

      {msg && (
        <div className={`mb-4 p-3 border text-sm font-mono ${
          msg.startsWith('Error') ? 'border-red-400/30 text-red-400' : 'border-white/20 text-green-400'
        }`}>
          {msg}
        </div>
      )}

      {creating && (
        <form onSubmit={handleCreate} className="mb-8 p-6 border border-white/20 space-y-4">
          <h3 className="text-base font-medium mb-2">New Brief</h3>
          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Title * <HelpTip {...briefFields.title} /></label>
            <input
              type="text" required maxLength={120}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              placeholder="e.g. Neon Nights Challenge"
            />
          </div>
          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Description * <HelpTip {...briefFields.description} /></label>
            <textarea
              rows={4} required maxLength={2000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none resize-none"
              placeholder="Describe the theme, requirements, and any guidelines for submissions…"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">
                Deadline <span className="text-white/40">(optional)</span> <HelpTip {...briefFields.deadline} />
              </label>
              <input
                type="date"
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm font-mono text-white/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_current}
                  onChange={(e) => setForm({ ...form, is_current: e.target.checked })}
                  className="accent-white"
                />
                Set as current brief
              </label>
            </div>
          </div>
          <button
            type="submit"
            disabled={acting}
            className="px-6 py-2 bg-white text-black text-base font-medium hover:bg-white/90
                       disabled:opacity-40 transition-all"
          >
            {acting ? 'Creating…' : 'Create Brief →'}
          </button>
          <p className="text-sm text-white/40">
            The current brief is shown on your brand page and used as the default for new submissions.
          </p>
        </form>
      )}

      {loading ? (
        <p className="text-white/40 text-sm font-mono">Loading…</p>
      ) : briefs.length === 0 ? (
        <p className="text-white/40 text-sm font-mono">No briefs yet. Create one to start receiving submissions.</p>
      ) : (
        <div className="space-y-3">
          {briefs.map((b) => (
            <div key={b.id} className="p-4 border border-white/10">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 min-w-0 mr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-base font-medium truncate">{b.title}</p>
                    {b.is_current && (
                      <span className="shrink-0 text-sm font-mono px-1.5 py-0.5 bg-white/20 text-white uppercase tracking-wider">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white/60 line-clamp-2">{b.description}</p>
                </div>
                <span className={`shrink-0 text-sm font-mono px-2 py-0.5 uppercase ${statusColor(b.status)}`}>
                  {b.status}
                </span>
              </div>

              {editingId === b.id && (
                <form onSubmit={handleEdit} className="mt-3 p-4 border border-white/15 space-y-3">
                  <div>
                    <label className="text-sm font-mono text-white/60 block mb-1">Title * <HelpTip {...briefFields.title} /></label>
                    <input
                      type="text" required maxLength={120}
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-mono text-white/60 block mb-1">Description * <HelpTip {...briefFields.description} /></label>
                    <textarea
                      rows={4} required maxLength={2000}
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-mono text-white/60 block mb-1">Deadline <HelpTip {...briefFields.deadline} /></label>
                    <input
                      type="date"
                      value={editForm.ends_at}
                      onChange={(e) => setEditForm({ ...editForm, ends_at: e.target.value })}
                      className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit" disabled={acting}
                      className="px-4 py-1.5 bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-40 transition-all"
                    >
                      {acting ? 'Saving…' : 'Save Changes'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-sm text-white/40 hover:text-white/70 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <div className="flex items-center justify-between mt-3">
                <div className="flex gap-4 text-sm text-white/50 font-mono">
                  <span>{new Date(b.created_at).toLocaleDateString()}</span>
                  {b.ends_at && (
                    <span>Ends: {new Date(b.ends_at).toLocaleDateString()}</span>
                  )}
                  <span>{b.response_count} submissions</span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => editingId === b.id ? setEditingId(null) : startEdit(b)}
                    className="text-sm font-mono text-white/60 hover:text-white border border-white/15 px-2 py-0.5 hover:border-white/40 transition-all"
                  >
                    {editingId === b.id ? 'Close' : 'Edit'}
                  </button>
                  {b.status === 'active' && !b.is_current && (
                    <button
                      onClick={() => handleAction(b.id, 'set_current')}
                      disabled={acting}
                      className="text-sm font-mono text-white/60 hover:text-white border border-white/15 px-2 py-0.5 hover:border-white/40 transition-all disabled:opacity-40"
                    >
                      Set Current
                    </button>
                  )}
                  {b.status === 'active' && (
                    <button
                      onClick={() => handleAction(b.id, 'close')}
                      disabled={acting}
                      className="text-sm font-mono text-amber-400/60 hover:text-amber-400 border border-amber-400/20 px-2 py-0.5 hover:border-amber-400/40 transition-all disabled:opacity-40"
                    >
                      Close
                    </button>
                  )}
                  {b.status === 'closed' && (
                    <>
                      <button
                        onClick={() => handleAction(b.id, 'activate')}
                        disabled={acting}
                        className="text-sm font-mono text-green-400/60 hover:text-green-400 border border-green-400/20 px-2 py-0.5 hover:border-green-400/40 transition-all disabled:opacity-40"
                      >
                        Reactivate
                      </button>
                      <button
                        onClick={() => handleAction(b.id, 'archive')}
                        disabled={acting}
                        className="text-sm font-mono text-white/50 hover:text-white/80 border border-white/10 px-2 py-0.5 hover:border-white/20 transition-all disabled:opacity-40"
                      >
                        Archive
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Vouchers Tab ──────────────────────────────────────────────────

interface VTemplate {
  id: string;
  title: string;
  description: string | null;
  voucher_type: string;
  voucher_value: Record<string, unknown> | null;
  terms: string | null;
  brand_url: string | null;
  valid_days: number;
  max_uses: number;
  status: string;
  created_at: string;
}

interface VStats {
  total: number;
  active: number;
  redeemed: number;
  expired: number;
}

function VouchersTab({ brandId }: { brandId: string }) {
  const [templates, setTemplates] = useState<VTemplate[]>([]);
  const [stats,     setStats]     = useState<VStats | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [creating,  setCreating]  = useState(false);
  const [acting,    setActing]    = useState(false);
  const [msg,       setMsg]       = useState('');

  const [form, setForm] = useState({
    title: '',
    description: '',
    voucher_type: 'percentage_discount' as string,
    voucher_value_amount: '',
    terms: '',
    brand_url: '',
    valid_days: '30',
    max_uses: '1',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/brand/${brandId}/vouchers`);
      const data = await res.json();
      setTemplates(data.templates || []);
      setStats(data.stats || null);
    } catch { /* */ }
    setLoading(false);
  }, [brandId]);

  useEffect(() => { load(); }, [load]);

  const buildVoucherValue = () => {
    const amt = parseFloat(form.voucher_value_amount);
    if (isNaN(amt)) return null;
    if (form.voucher_type === 'percentage_discount') return { percent: amt };
    if (form.voucher_type === 'fixed_discount') return { amount: amt, currency: 'USD' };
    return null;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setActing(true);
    setMsg('');

    const res = await fetch(`/api/brand/${brandId}/vouchers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        description: form.description || null,
        voucher_type: form.voucher_type,
        voucher_value: buildVoucherValue(),
        terms: form.terms || null,
        brand_url: form.brand_url || null,
        valid_days: form.valid_days,
        max_uses: form.max_uses,
      }),
    });
    const data = await res.json();
    setActing(false);

    if (res.ok) {
      setMsg('Voucher template created');
      setForm({ title: '', description: '', voucher_type: 'percentage_discount', voucher_value_amount: '', terms: '', brand_url: '', valid_days: '30', max_uses: '1' });
      setCreating(false);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  const handleAction = async (templateId: string, action: string) => {
    setActing(true);
    setMsg('');
    const res = await fetch(`/api/brand/${brandId}/vouchers`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, action }),
    });
    const data = await res.json();
    setActing(false);
    if (res.ok) {
      setMsg(action === 'pause' ? 'Template paused' : action === 'activate' ? 'Template activated' : action === 'archive' ? 'Template archived' : 'Updated');
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  const typeLabel = (t: string) => {
    const map: Record<string, string> = {
      percentage_discount: '% Off',
      fixed_discount: '$ Off',
      free_item: 'Free Item',
      experience: 'Experience',
      custom: 'Custom',
    };
    return map[t] || t;
  };

  const offerSummary = (t: VTemplate) => {
    if (t.voucher_type === 'percentage_discount' && t.voucher_value) {
      const pct = (t.voucher_value as { percent?: number }).percent;
      if (pct) return `${pct}% off`;
    }
    if (t.voucher_type === 'fixed_discount' && t.voucher_value) {
      const v = t.voucher_value as { amount?: number; currency?: string };
      if (v.amount) return `${v.currency ?? 'USD'} ${v.amount} off`;
    }
    return t.title;
  };

  const statusColor = (s: string) => {
    if (s === 'active') return 'bg-emerald-400/20 text-emerald-400';
    if (s === 'paused') return 'bg-amber-400/20 text-amber-400';
    return 'bg-white/10 text-white/60';
  };

  return (
    <div>
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Issued', value: stats.total },
            { label: 'Active', value: stats.active },
            { label: 'Redeemed', value: stats.redeemed },
            { label: 'Expired', value: stats.expired },
          ].map((s) => (
            <div key={s.label} className="border border-white/10 p-3 text-center">
              <p className="text-2xl font-mono">{s.value}</p>
              <p className="text-xs font-mono text-white/50 uppercase tracking-wider mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-mono uppercase tracking-widest text-white/60">Voucher Templates</h2>
        <button
          onClick={() => setCreating(!creating)}
          className="text-sm border border-white/30 px-4 py-1.5 hover:border-white transition-all"
        >
          {creating ? 'Cancel' : '+ New Template'}
        </button>
      </div>

      {msg && (
        <div className={`mb-4 p-3 border text-sm font-mono ${
          msg.startsWith('Error') ? 'border-red-400/30 text-red-400' : 'border-white/20 text-emerald-400'
        }`}>
          {msg}
        </div>
      )}

      {creating && (
        <form onSubmit={handleCreate} className="mb-8 p-6 border border-white/20 space-y-4">
          <h3 className="text-base font-medium mb-2">New Voucher Template</h3>

          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Title * <HelpTip {...voucherFields.title} /></label>
            <input
              type="text" required maxLength={120}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              placeholder="e.g. 20% off next order"
            />
          </div>

          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Description</label>
            <textarea
              rows={2} maxLength={500}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none resize-none"
              placeholder="Optional details about this voucher offer"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Type * <HelpTip {...voucherFields.type} /></label>
              <select
                value={form.voucher_type}
                onChange={(e) => setForm({ ...form, voucher_type: e.target.value })}
                className="w-full bg-black border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              >
                <option value="percentage_discount">Percentage Discount</option>
                <option value="fixed_discount">Fixed Discount</option>
                <option value="free_item">Free Item</option>
                <option value="experience">Experience</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">
                {form.voucher_type === 'percentage_discount' ? 'Percentage' :
                 form.voucher_type === 'fixed_discount' ? 'Amount (USD)' : 'Value'}
              </label>
              <input
                type="number" step="any" min="0"
                value={form.voucher_value_amount}
                onChange={(e) => setForm({ ...form, voucher_value_amount: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
                placeholder={form.voucher_type === 'percentage_discount' ? 'e.g. 20' : 'e.g. 10.00'}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Redemption URL <HelpTip {...voucherFields.brandUrl} /></label>
            <input
              type="url"
              value={form.brand_url}
              onChange={(e) => setForm({ ...form, brand_url: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              placeholder="https://yourbrand.com/redeem"
            />
          </div>

          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Terms &amp; Conditions <HelpTip {...voucherFields.terms} /></label>
            <textarea
              rows={2} maxLength={1000}
              value={form.terms}
              onChange={(e) => setForm({ ...form, terms: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none resize-none"
              placeholder="e.g. One per customer, not valid with other offers"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Valid for (days) <HelpTip {...voucherFields.validDays} /></label>
              <input
                type="number" min="1" max="365"
                value={form.valid_days}
                onChange={(e) => setForm({ ...form, valid_days: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Max uses per voucher <HelpTip {...voucherFields.maxUses} /></label>
              <input
                type="number" min="1" max="100"
                value={form.max_uses}
                onChange={(e) => setForm({ ...form, max_uses: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              />
            </div>
          </div>

          <button
            type="submit" disabled={acting}
            className="px-6 py-2 bg-white text-black text-base font-medium hover:bg-white/90 disabled:opacity-40 transition-all"
          >
            {acting ? 'Creating…' : 'Create Template →'}
          </button>
          <p className="text-sm text-white/40">
            Attach this template to a drop to auto-generate vouchers for every purchase.
          </p>
        </form>
      )}

      {loading ? (
        <p className="text-white/40 text-sm font-mono">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="text-white/40 text-sm font-mono">No voucher templates yet. Create one to start offering vouchers with your drops.</p>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="p-4 border border-white/10">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 min-w-0 mr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-base font-medium truncate">{t.title}</p>
                    <span className="shrink-0 text-xs font-mono px-1.5 py-0.5 bg-white/10 text-white/60 uppercase">
                      {typeLabel(t.voucher_type)}
                    </span>
                  </div>
                  <p className="text-sm text-emerald-400 font-medium">{offerSummary(t)}</p>
                  {t.description && <p className="text-sm text-white/50 mt-1 line-clamp-2">{t.description}</p>}
                </div>
                <span className={`shrink-0 text-sm font-mono px-2 py-0.5 uppercase ${statusColor(t.status)}`}>
                  {t.status}
                </span>
              </div>

              <div className="flex items-center justify-between mt-3">
                <div className="flex gap-4 text-sm text-white/50 font-mono">
                  <span>Valid {t.valid_days}d</span>
                  <span>{t.max_uses} use{t.max_uses > 1 ? 's' : ''}</span>
                  {t.brand_url && <span className="truncate max-w-[200px]">{t.brand_url}</span>}
                  <span>{new Date(t.created_at).toLocaleDateString()}</span>
                </div>

                <div className="flex gap-2">
                  {t.status === 'active' && (
                    <button
                      onClick={() => handleAction(t.id, 'pause')}
                      disabled={acting}
                      className="text-sm font-mono text-amber-400/60 hover:text-amber-400 border border-amber-400/20 px-2 py-0.5 hover:border-amber-400/40 transition-all disabled:opacity-40"
                    >
                      Pause
                    </button>
                  )}
                  {t.status === 'paused' && (
                    <>
                      <button
                        onClick={() => handleAction(t.id, 'activate')}
                        disabled={acting}
                        className="text-sm font-mono text-emerald-400/60 hover:text-emerald-400 border border-emerald-400/20 px-2 py-0.5 hover:border-emerald-400/40 transition-all disabled:opacity-40"
                      >
                        Activate
                      </button>
                      <button
                        onClick={() => handleAction(t.id, 'archive')}
                        disabled={acting}
                        className="text-sm font-mono text-white/50 hover:text-white/80 border border-white/10 px-2 py-0.5 hover:border-white/20 transition-all disabled:opacity-40"
                      >
                        Archive
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sales Tab ─────────────────────────────────────────────────────
function SalesTab({ brandId }: { brandId: string }) {
  const [stats,         setStats]         = useState<SalesStats | null>(null);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [loading,       setLoading]       = useState(true);

  useEffect(() => {
    fetch(`/api/brand/${brandId}/sales`)
      .then((r) => r.json())
      .then((d) => {
        setStats(d.stats || null);
        setDistributions(d.distributions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [brandId]);

  const splitLabel = (s: string) => {
    const labels: Record<string, string> = {
      'challenge_35_35_30':  'Challenge',
      'brand_product_tiered': 'Product (Tiered)',
      'brand_product_70_30': 'Product',
      'rrg_challenge_35_65': 'RRG Challenge',
      'legacy_70_30':        'Legacy',
    };
    return labels[s] || s;
  };

  return (
    <div>
      <h2 className="text-sm font-mono uppercase tracking-widest text-white/60 mb-6">Sales</h2>

      {loading ? (
        <p className="text-white/40 text-sm font-mono">Loading…</p>
      ) : (
        <>
          {/* Summary */}
          {stats && (
            <div className="mb-6 p-4 border border-white/10 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-sm font-mono text-white/50 mb-1">Total Sales</p>
                <p className="text-xl font-medium">{stats.totalSales}</p>
              </div>
              <div>
                <p className="text-sm font-mono text-white/50 mb-1">Total Revenue</p>
                <p className="text-xl font-medium">${stats.totalRevenue.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm font-mono text-white/50 mb-1">Your Share</p>
                <p className="text-xl font-medium text-green-400">${stats.brandRevenue.toFixed(2)}</p>
              </div>
            </div>
          )}

          {/* Distribution list */}
          {distributions.length === 0 ? (
            <p className="text-white/40 text-sm font-mono">No sales yet.</p>
          ) : (
            <div className="space-y-3">
              {distributions.map((d) => (
                <div key={d.id} className="p-4 border border-white/10">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-mono text-white/70">
                      {splitLabel(d.split_type)}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-mono px-2 py-0.5 ${
                        d.status === 'completed' ? 'bg-green-400/20 text-green-400' :
                        d.status === 'pending'   ? 'bg-amber-400/20 text-amber-400' :
                                                   'bg-red-400/20 text-red-400'
                      }`}>
                        {d.status.toUpperCase()}
                      </span>
                      <span className="text-sm text-white/40 font-mono">
                        {new Date(d.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm font-mono">
                    <span className="text-white/60">
                      Total: <span className="text-white">${parseFloat(d.total_usdc).toFixed(2)}</span>
                    </span>
                    <span className="text-white/60">
                      Your share: <span className="text-green-400">${parseFloat(d.brand_usdc).toFixed(2)}</span>
                    </span>
                    <span className="text-white/60">
                      Platform: <span className="text-amber-400">${parseFloat(d.platform_usdc).toFixed(2)}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────
function SettingsTab({ brandId }: { brandId: string }) {
  const [brand,   setBrand]   = useState<BrandSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState('');
  const [form,    setForm]    = useState({
    name: '', headline: '', description: '', website_url: '', contact_email: '',
  });
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [logoFile, setLogoFile]     = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview]     = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [tcModalOpen, setTcModalOpen]     = useState(false);
  const [tcSaving, setTcSaving]           = useState(false);

  useEffect(() => {
    fetch(`/api/brand/${brandId}/settings`)
      .then((r) => r.json())
      .then((d) => {
        if (d.brand) {
          setBrand(d.brand);
          setForm({
            name:          d.brand.name || '',
            headline:      d.brand.headline || '',
            description:   d.brand.description || '',
            website_url:   d.brand.website_url || '',
            contact_email: d.brand.contact_email || '',
          });
          setSocials(d.brand.social_links || {});
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [brandId]);

  // Generate client-side previews for selected files
  const handleLogoSelect = (file: File | null) => {
    setLogoFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setLogoPreview(url);
    } else {
      setLogoPreview(null);
    }
  };
  const handleBannerSelect = (file: File | null) => {
    setBannerFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setBannerPreview(url);
    } else {
      setBannerPreview(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');

    // Use FormData when images are included, JSON otherwise
    const hasFiles = logoFile || bannerFile;

    let res: Response;

    if (hasFiles) {
      const fd = new FormData();
      fd.append('name', form.name);
      fd.append('headline', form.headline);
      fd.append('description', form.description);
      fd.append('website_url', form.website_url);
      fd.append('contact_email', form.contact_email);
      fd.append('social_links', JSON.stringify(socials));
      fd.append('accepts_card_payments', brand?.accepts_card_payments ? 'true' : 'false');
      if (logoFile)   fd.append('logo', logoFile);
      if (bannerFile) fd.append('banner', bannerFile);
      res = await fetch(`/api/brand/${brandId}/settings`, { method: 'PATCH', body: fd });
    } else {
      res = await fetch(`/api/brand/${brandId}/settings`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...form, social_links: socials, accepts_card_payments: brand?.accepts_card_payments ?? false }),
      });
    }

    const data = await res.json();
    setSaving(false);

    if (res.ok) {
      setMsg('Settings saved ✓');
      setBrand(data.brand);
      setLogoFile(null);
      setBannerFile(null);
      setLogoPreview(null);
      setBannerPreview(null);
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  if (loading) return <p className="text-white/40 text-sm font-mono">Loading…</p>;
  if (!brand) return <p className="text-white/40 text-sm font-mono">Brand not found.</p>;

  return (
    <div>
      <h2 className="text-sm font-mono uppercase tracking-widest text-white/60 mb-6">Settings</h2>

      {/* Read-only info */}
      <div className="mb-6 p-4 border border-white/10 space-y-2">
        <div className="flex gap-4 text-sm font-mono">
          <span className="text-white/60">Slug:</span>
          <span className="text-white/80">/{brand.slug}</span>
        </div>
        <div className="flex gap-4 text-sm font-mono">
          <span className="text-white/60">Wallet:</span>
          <span className="text-white/80">{brand.wallet_address}</span>
        </div>
        <div className="flex gap-4 text-sm font-mono">
          <span className="text-white/60">Self-listings:</span>
          <span className="text-white/80">{brand.self_listings_used} / {brand.max_self_listings}</span>
        </div>
      </div>

      {/* Editable fields */}
      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">

        {/* ── Brand Images ─────────────────────────────────── */}
        <div className="p-5 border border-white/10 space-y-5">
          <p className="text-sm font-mono uppercase tracking-widest text-white/50">Brand Images</p>

          {/* Logo */}
          <div>
            <label className="text-sm font-mono text-white/60 block mb-2">
              Logo <span className="text-white/40">(Square, JPEG/PNG, max 2 MB)</span> <HelpTip {...brandAdmin.logo} />
            </label>
            <div className="flex items-center gap-4">
              {(logoPreview || brand.logo_path) && (
                <div className="shrink-0 w-16 h-16 border border-white/15 overflow-hidden bg-white/5">
                  <img
                    src={logoPreview || `/api/brand/${brandId}/image?type=logo&t=${Date.now()}`}
                    alt="Logo preview"
                    className="w-full h-full object-contain"
                  />
                </div>
              )}
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png"
                onChange={(e) => handleLogoSelect(e.target.files?.[0] || null)}
                className="text-sm text-white/60 file:bg-white/10 file:border-0 file:px-3 file:py-2
                           file:text-white file:text-sm file:mr-3 file:cursor-pointer"
              />
            </div>
          </div>

          {/* Banner */}
          <div>
            <label className="text-sm font-mono text-white/60 block mb-2">
              Banner <span className="text-white/40">(Wide, JPEG/PNG, max 5 MB)</span> <HelpTip {...brandAdmin.banner} />
            </label>
            {(bannerPreview || brand.banner_path) && (
              <div className="w-full h-32 mb-3 border border-white/15 overflow-hidden bg-white/5">
                <img
                  src={bannerPreview || `/api/brand/${brandId}/image?type=banner&t=${Date.now()}`}
                  alt="Banner preview"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png"
              onChange={(e) => handleBannerSelect(e.target.files?.[0] || null)}
              className="text-sm text-white/60 file:bg-white/10 file:border-0 file:px-3 file:py-2
                         file:text-white file:text-sm file:mr-3 file:cursor-pointer"
            />
          </div>
        </div>

        {/* ── Basic Info ───────────────────────────────────── */}
        <div>
          <label className="text-sm font-mono text-white/60 block mb-1">Name <HelpTip {...brandAdmin.name} /></label>
          <input
            type="text" required maxLength={100}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
          />
        </div>
        <div>
          <label className="text-sm font-mono text-white/60 block mb-1">Headline <HelpTip {...brandAdmin.headline} /></label>
          <input
            type="text" maxLength={200}
            value={form.headline}
            onChange={(e) => setForm({ ...form, headline: e.target.value })}
            className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
          />
        </div>
        <div>
          <label className="text-sm font-mono text-white/60 block mb-1">Description <HelpTip {...brandAdmin.description} /></label>
          <textarea
            rows={4} maxLength={1000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none resize-none"
          />
        </div>
        <div>
          <label className="text-sm font-mono text-white/60 block mb-1">Contact Email <HelpTip {...brandAdmin.contactEmail} /></label>
          <input
            type="email" required
            value={form.contact_email}
            onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
          />
        </div>
        <div>
          <label className="text-sm font-mono text-white/60 block mb-1">Website <HelpTip {...brandAdmin.website} /></label>
          <input
            type="url"
            value={form.website_url}
            onChange={(e) => setForm({ ...form, website_url: e.target.value })}
            className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
          />
        </div>

        {/* ── Social Links ─────────────────────────────────── */}
        <div className="p-5 border border-white/10 space-y-3">
          <p className="text-sm font-mono uppercase tracking-widest text-white/50">Social Links <HelpTip {...brandAdmin.socialLinks} /></p>
          {SOCIAL_PLATFORMS.map((p) => (
            <div key={p.key}>
              <label className="text-sm font-mono text-white/60 block mb-1">{p.label}</label>
              <input
                type="url"
                placeholder={p.placeholder}
                value={socials[p.key] || ''}
                onChange={(e) => setSocials({ ...socials, [p.key]: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base
                           focus:border-white outline-none placeholder:text-white/60"
              />
            </div>
          ))}
        </div>

        {/* ── Terms & Conditions ─────────────────────────── */}
        {brand.tc_accepted_at ? (
          <div className="p-5 border border-green-400/20 bg-green-400/5 space-y-2">
            <p className="text-sm font-mono uppercase tracking-widest text-green-400/60">
              Terms & Conditions Accepted
            </p>
            <p className="text-sm text-white/70">
              Accepted on{' '}
              {new Date(brand.tc_accepted_at).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}{' '}
              (v{brand.tc_version})
            </p>
            <button
              type="button"
              onClick={() => setTcModalOpen(true)}
              className="text-sm text-white/50 hover:text-white/80 transition-colors underline"
            >
              Review Terms
            </button>
          </div>
        ) : (
          <div className="p-5 border border-amber-400/40 bg-amber-400/5 space-y-3">
            <p className="text-sm font-mono uppercase tracking-widest text-amber-400">
              Action Required
            </p>
            <p className="text-base text-white/80">
              You must accept the Brand Partner Terms & Conditions before using this platform.
            </p>
            <button
              type="button"
              onClick={() => setTcModalOpen(true)}
              className="px-5 py-2 border border-amber-400/60 text-amber-400 text-base font-medium
                         hover:bg-amber-400/10 transition-all"
            >
              Review & Accept Terms
            </button>
          </div>
        )}

        {/* ── Card Payment Acceptance ────────────────────── */}
        <div className={`p-5 border space-y-3 ${brand.accepts_card_payments ? 'border-green-400/20 bg-green-400/5' : 'border-white/10 bg-white/5'}`}>
          <p className="text-sm font-mono uppercase tracking-widest text-white/50">
            Credit / Debit Card Payments <HelpTip {...brandAdmin.cardPayments} />
          </p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!brand.accepts_card_payments}
              onChange={(e) => setBrand({ ...brand, accepts_card_payments: e.target.checked })}
              className="mt-1 w-4 h-4 accent-green-400"
            />
            <div>
              <p className="text-base text-white/80">
                Accept credit/debit card payments from buyers
              </p>
              <p className="text-sm text-white/50 mt-1">
                Card processing fees (~3%) will be deducted from your revenue split.
                Buyers pay with Visa, Mastercard, or other supported cards via our payment partner.
                This applies to items priced at $10 USDC or above.
              </p>
            </div>
          </label>
          {brand.accepts_card_payments && (
            <p className="text-xs text-green-400/60 font-mono">
              ✓ Card payments enabled — buyers will see a &quot;Buy with Card&quot; option on your products.
            </p>
          )}
        </div>

        {msg && (
          <p className={`text-sm font-mono ${msg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {msg}
          </p>
        )}
        <button
          type="submit"
          disabled={saving || !brand.tc_accepted_at}
          className="px-6 py-2 bg-white text-black text-base font-medium hover:bg-white/90
                     disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {saving ? 'Saving…' : 'Save Settings →'}
        </button>
        {!brand.tc_accepted_at && (
          <p className="text-sm text-amber-400/60 -mt-3">
            Accept the Terms & Conditions above to enable saving.
          </p>
        )}
      </form>

      {/* Brand Terms Modal */}
      <BrandTermsModal
        open={tcModalOpen}
        saving={tcSaving}
        onClose={() => setTcModalOpen(false)}
        onAccept={async () => {
          setTcSaving(true);
          const res = await fetch(`/api/brand/${brandId}/settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tc_version: BRAND_TC_VERSION }),
          });
          const data = await res.json();
          setTcSaving(false);
          if (res.ok) {
            setBrand(data.brand);
            setTcModalOpen(false);
            setMsg('Terms accepted ✓');
          } else {
            setMsg(`Error: ${data.error}`);
          }
        }}
      />
    </div>
  );
}
