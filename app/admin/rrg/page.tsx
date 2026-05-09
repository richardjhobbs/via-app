'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';

// ── Copy-to-clipboard wallet button ────────────────────────────────────
function CopyWallet({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      title={address}
      className="flex items-center gap-1 font-mono text-white/40 hover:text-white/80 transition-colors cursor-pointer"
    >
      <span>{address.slice(0, 6)}…{address.slice(-4)}</span>
      <span className="text-xs">{copied ? '✓' : '⧉'}</span>
    </button>
  );
}

// ── Types ──────────────────────────────────────────────────────────────
interface Brief {
  id: string;
  title: string;
  description: string;
  ends_at?: string | null;
  status: string;
  is_current: boolean;
  created_at: string;
  social_caption?: string | null;
  brand_id?: string | null;
  brand?: { name: string; slug: string } | null;
}

interface Submission {
  id: string;
  title: string;
  description?: string | null;
  creator_wallet: string;
  creator_email?: string | null;
  status: string;
  created_at: string;
  previewUrl?: string | null;
  // AI vision fields
  ai_screen_reason?: string | null;
  ai_screen_confidence?: string | null;
  image_review_flags?: string[] | null;
  // Parsed from description tag:
  suggestedEdition?: string;
  suggestedPrice?: string;
}

interface Drop {
  id: string;
  title: string;
  description?: string | null;
  token_id: number;
  price_usdc: string;
  edition_size: number;
  creator_wallet: string;
  creator_email?: string | null;
  creator_handle?: string | null;
  creator_bio?: string | null;
  creator_type?: string | null;
  approved_at: string;
  hidden?: boolean;
  ui_visible?: boolean;
  previewUrl?: string | null;
  jpeg_storage_path?: string | null;
  submission_channel?: string | null;
  brief_id?: string | null;
  brand_id?: string | null;
  is_physical_product?: boolean;
  has_voucher?: boolean;
}

interface Brand {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  headline?: string | null;
  contact_email: string;
  wallet_address: string;
  website_url?: string | null;
  logo_path?: string | null;
  banner_path?: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  social_links?: Record<string, string> | null;
  status: string;
  max_self_listings: number;
  self_listings_used: number;
  created_at: string;
}

interface Distribution {
  id: string;
  created_at: string;
  purchase_id: string;
  brand_id?: string | null;
  total_usdc: string;
  creator_usdc: string;
  brand_usdc: string;
  platform_usdc: string;
  creator_wallet?: string | null;
  brand_wallet?: string | null;
  split_type: string;
  status: string;
  notes?: string | null;
  purchase_tx_hash?: string | null;
  token_id?: number | null;
  submission_title?: string | null;
  brand_name?: string | null;
}

interface Contributor {
  wallet_address: string;
  creator_type: string;
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  registered_at: string;
  last_active_at?: string | null;
  total_submissions: number;
  total_approved: number;
  total_rejected: number;
  total_revenue_usdc: number;
  brands_contributed: string[];
}

type Tab = 'briefs' | 'submissions' | 'drops' | 'brands' | 'concierge' | 'distributions' | 'contributors' | 'referrals' | 'purchases';

// ── Main component ─────────────────────────────────────────────────────
export default function AdminPage() {
  const [authed,    setAuthed]    = useState<boolean | null>(null);
  const [password,  setPassword]  = useState('');
  const [loginErr,  setLoginErr]  = useState('');
  const [tab,       setTab]       = useState<Tab>('submissions');

  // Check auth on mount
  useEffect(() => {
    fetch('/api/rrg/admin/check')
      .then((r) => r.json())
      .then((d) => setAuthed(d.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr('');
    const res = await fetch('/api/rrg/admin/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password }),
    });
    if (res.ok) setAuthed(true);
    else        setLoginErr('Invalid password');
  };

  const handleLogout = async () => {
    await fetch('/api/rrg/admin/logout', { method: 'POST' });
    setAuthed(false);
    setPassword('');
  };

  // Loading
  if (authed === null) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="font-mono text-white/50 text-base">Loading…</p>
      </div>
    );
  }

  // Login form
  if (!authed) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4 px-6">
          <h1 className="text-sm font-mono uppercase tracking-[0.3em] text-white/60 mb-6">
            RRG Admin
          </h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-transparent border border-white/20 px-4 py-3 text-base
                       focus:border-white outline-none transition-colors placeholder:text-white/60"
            autoFocus
          />
          {loginErr && <p className="text-red-400 text-sm font-mono">{loginErr}</p>}
          <button
            type="submit"
            className="w-full py-3 bg-white text-black text-base font-medium hover:bg-white/90 transition-all"
          >
            Login →
          </button>
        </form>
      </div>
    );
  }

  // Dashboard
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex justify-between items-center">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-white/80">
          RRG Admin
        </span>
        <div className="flex items-center gap-4">
          <a
            href="/admin/rrg/marketing"
            className="text-xs text-white/50 hover:text-white transition-colors font-mono"
          >
            Agent Marketing →
          </a>
          <button
            onClick={handleLogout}
            className="text-xs text-white/50 hover:text-white transition-colors font-mono"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-white/10 px-6 flex gap-6">
        {(['submissions', 'briefs', 'drops', 'brands', 'concierge', 'distributions', 'contributors', 'referrals', 'purchases'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-3 text-xs font-mono uppercase tracking-wider transition-colors border-b-2 -mb-px
              ${tab === t
                ? 'text-white border-white'
                : 'text-white/50 border-transparent hover:text-white/80'
              }`}
          >
            {t === 'drops' ? 'Listings' : t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-6 py-8 max-w-7xl">
        {tab === 'briefs'        && <BriefTab />}
        {tab === 'submissions'   && <SubmissionsTab />}
        {tab === 'drops'         && <DropsTab />}
        {tab === 'brands'        && <BrandsTab />}
        {tab === 'concierge'     && <ConciergeTab />}
        {tab === 'distributions' && <DistributionsTab />}
        {tab === 'contributors' && <ContributorsTab />}
        {tab === 'referrals'    && <ReferralsTab />}
        {tab === 'purchases'    && <PurchasesTab />}
      </div>
    </div>
  );
}

// ── Brief Tab ──────────────────────────────────────────────────────────
function BriefTab() {
  const [briefs,   setBriefs]   = useState<Brief[]>([]);
  const [brands,   setBrands]   = useState<Brand[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing,  setEditing]  = useState<string | null>(null);
  const [acting,   setActing]   = useState(false);
  const [form,     setForm]     = useState({ title: '', description: '', starts_at: new Date().toISOString().split('T')[0], ends_at: '', brand_id: '00000000-0000-4000-8000-000000000001' });
  const [editForm, setEditForm] = useState({ title: '', description: '', ends_at: '' });
  const [msg,      setMsg]      = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [briefsRes, brandsRes] = await Promise.all([
      fetch('/api/rrg/briefs?admin=1'),
      fetch('/api/rrg/admin/brands'),
    ]);
    const briefsData = await briefsRes.json();
    const brandsData = await brandsRes.json();
    setBriefs(briefsData.briefs || []);
    setBrands((brandsData.brands || []).filter((b: Brand) => b.status === 'active'));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    const res = await fetch('/api/rrg/brief/create', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...form, is_current: true }),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg('Brief created ✓');
      setForm({ title: '', description: '', starts_at: new Date().toISOString().split('T')[0], ends_at: '', brand_id: '00000000-0000-4000-8000-000000000001' });
      setCreating(false);
      load();
    } else {
      setMsg(data.error || 'Failed');
    }
  };

  const handleUpdate = async (briefId: string) => {
    setActing(true);
    setMsg('');
    const res = await fetch(`/api/rrg/brief/${briefId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    const data = await res.json();
    setActing(false);
    if (res.ok) {
      setMsg('Brief updated ✓');
      setEditing(null);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  const handleAction = async (briefId: string, action: Record<string, unknown>) => {
    setActing(true);
    setMsg('');
    const res = await fetch(`/api/rrg/brief/${briefId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    setActing(false);
    if (res.ok) {
      setMsg('Updated ✓');
      load();
    } else {
      const data = await res.json();
      setMsg(`Error: ${data.error}`);
    }
  };

  const handleDelete = async (briefId: string, title: string) => {
    if (!confirm(`Delete brief "${title}"? This cannot be undone.`)) return;
    setActing(true);
    setMsg('');
    const res = await fetch(`/api/rrg/brief/${briefId}`, { method: 'DELETE' });
    setActing(false);
    if (res.ok) {
      setMsg('Brief deleted ✓');
      load();
    } else {
      const data = await res.json();
      setMsg(`Error: ${data.error}`);
    }
  };

  const startEdit = (b: Brief) => {
    setEditing(b.id);
    setEditForm({
      title: b.title,
      description: b.description,
      ends_at: b.ends_at?.split('T')[0] || '',
    });
  };

  const statusColor = (s: string) => {
    if (s === 'active')   return 'bg-green-400/20 text-green-400';
    if (s === 'closed')   return 'bg-amber-400/20 text-amber-400';
    return 'bg-white/10 text-white/60';
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-mono uppercase tracking-widest text-white/60">
          Briefs ({briefs.length})
        </h2>
        <button
          onClick={() => { setCreating(!creating); setEditing(null); }}
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
            <label className="text-sm font-mono text-white/60 block mb-1">Brand *</label>
            <select
              value={form.brand_id}
              onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
              className="w-full bg-black border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Title *</label>
            <input
              type="text" required maxLength={200}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
            />
          </div>
          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Description *</label>
            <textarea
              required rows={4} maxLength={2000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none resize-none"
            />
          </div>
          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Ends (optional)</label>
            <input
              type="date"
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
              className="bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
            />
          </div>
          <button
            type="submit"
            className="px-6 py-2 bg-white text-black text-base font-medium hover:bg-white/90 transition-all"
          >
            Create &amp; Set as Current &rarr;
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-white/40 text-sm font-mono">Loading…</p>
      ) : (
        <div className="space-y-4">
          {briefs.map((b) => (
            <div key={b.id} className="border border-white/10 overflow-hidden">
              {editing === b.id ? (
                /* ── Edit form ────────────────────────────────── */
                <div className="p-5 space-y-3">
                  <div>
                    <label className="text-sm font-mono text-white/60 block mb-1">Title</label>
                    <input
                      type="text" maxLength={200}
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-mono text-white/60 block mb-1">Description</label>
                    <textarea
                      rows={4} maxLength={2000}
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-mono text-white/60 block mb-1">Ends</label>
                    <input
                      type="date"
                      value={editForm.ends_at}
                      onChange={(e) => setEditForm({ ...editForm, ends_at: e.target.value })}
                      className="bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleUpdate(b.id)}
                      disabled={acting}
                      className="px-5 py-1.5 bg-white text-black text-base font-medium hover:bg-white/90 disabled:opacity-40 transition-all"
                    >
                      {acting ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="text-sm text-white/50 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Brief display ────────────────────────────── */
                <div className="p-5">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 min-w-0 mr-4">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base font-medium truncate">{b.title}</h3>
                        {b.is_current && (
                          <span className="shrink-0 text-sm font-mono bg-white text-black px-2 py-0.5 uppercase">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-white/60 leading-relaxed mb-2 line-clamp-2">{b.description}</p>
                    </div>
                    <span className={`shrink-0 text-sm font-mono px-2 py-0.5 uppercase ${statusColor(b.status || 'active')}`}>
                      {b.status || 'active'}
                    </span>
                  </div>
                  <div className="flex gap-4 text-sm text-white/40 font-mono">
                    {b.brand && (
                      <span className="text-white/60">Brand: {b.brand.name}</span>
                    )}
                    <span>{new Date(b.created_at).toLocaleDateString()}</span>
                    {b.ends_at && <span>Ends: {new Date(b.ends_at).toLocaleDateString()}</span>}
                  </div>
                </div>
              )}

              {/* Actions bar */}
              {editing !== b.id && (
                <div className="border-t border-white/10 p-4 flex gap-3 flex-wrap">
                  <button
                    onClick={() => startEdit(b)}
                    className="px-4 py-1.5 text-sm border border-white/20 hover:border-white/50 transition-all"
                  >
                    Edit
                  </button>
                  {!b.is_current && b.status === 'active' && (
                    <button
                      onClick={() => handleAction(b.id, { is_current: true })}
                      disabled={acting}
                      className="px-4 py-1.5 text-sm border border-white/20 text-white/80 hover:border-white/50 disabled:opacity-40 transition-all"
                    >
                      Set Current
                    </button>
                  )}
                  {b.status === 'active' && (
                    <button
                      onClick={() => handleAction(b.id, { status: 'closed', is_current: false })}
                      disabled={acting}
                      className="px-4 py-1.5 text-sm border border-amber-400/30 text-amber-400 hover:border-amber-400 disabled:opacity-40 transition-all"
                    >
                      Close
                    </button>
                  )}
                  {b.status === 'closed' && (
                    <button
                      onClick={() => handleAction(b.id, { status: 'active' })}
                      disabled={acting}
                      className="px-4 py-1.5 text-sm border border-green-400/30 text-green-400 hover:border-green-400 disabled:opacity-40 transition-all"
                    >
                      Reactivate
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(b.id, b.title)}
                    disabled={acting}
                    className="px-4 py-1.5 text-sm border border-red-400/30 text-red-400 hover:border-red-400 disabled:opacity-40 transition-all"
                  >
                    Delete
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

// ── Submissions Tab ────────────────────────────────────────────────────
// ── Submissions Tab (Superadmin) ──────────────────────────────────────
function SubmissionsTab() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [acting,      setActing]      = useState<string | null>(null);
  const [approveForm, setApproveForm] = useState<{ id: string; edition_size: string; price_usdc: string; title: string; description: string } | null>(null);
  const [rejectForm,  setRejectForm]  = useState<{ id: string; reason: string } | null>(null);
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [editForm,    setEditForm]    = useState({ title: '', description: '' });
  const [imageFile,   setImageFile]   = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [msg,         setMsg]         = useState('');
  const [lightbox,    setLightbox]    = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch('/api/rrg/submissions');
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
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleEditSave = async () => {
    if (!editingId) return;
    setActing(editingId);
    setMsg('');

    const formData = new FormData();
    formData.append('submissionId', editingId);
    formData.append('title', editForm.title);
    formData.append('description', editForm.description);
    if (imageFile) formData.append('image', imageFile);

    const res = await fetch('/api/rrg/admin/submissions', { method: 'PATCH', body: formData });
    const data = await res.json();
    setActing(null);
    if (res.ok) {
      setMsg(`Updated ✓`);
      setEditingId(null);
      setImageFile(null);
      setImagePreview(null);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveForm) return;
    setActing(approveForm.id);
    setMsg('');

    // Save any title/description edits first
    if (approveForm.title || approveForm.description) {
      const editBody: Record<string, string> = { submissionId: approveForm.id };
      if (approveForm.title) editBody.title = approveForm.title;
      if (approveForm.description) editBody.description = approveForm.description;
      await fetch('/api/rrg/admin/submissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editBody),
      });
    }

    const res = await fetch('/api/rrg/approve', {
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
    const res = await fetch('/api/rrg/reject', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ submissionId: rejectForm.id, reason: rejectForm.reason }),
    });
    const data = await res.json();
    if (res.ok) { setMsg('Rejected ✓'); setRejectForm(null); load(); }
    else { setMsg(`Error: ${data.error}`); }
    setActing(null);
  };

  const inputClass = 'w-full bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none';

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-mono uppercase tracking-widest text-white/60">
          Pending Submissions — Superadmin
        </h2>
        <button onClick={load} className="text-sm text-white/50 hover:text-white transition-colors font-mono">↻ Refresh</button>
      </div>

      {msg && (
        <div className="mb-4 p-3 border border-white/20 bg-white/5 text-sm font-mono text-white/80">{msg}</div>
      )}

      {loading ? (
        <p className="text-white/40 text-sm font-mono">Loading…</p>
      ) : submissions.length === 0 ? (
        <p className="text-white/40 text-sm font-mono">No pending submissions.</p>
      ) : (
        <div className="space-y-6">
          {submissions.map((s) => (
            <div key={s.id} className="border border-white/10 overflow-hidden">
              {/* Header with large image */}
              <div className="flex gap-4 p-5">
                {s.previewUrl && (
                  <button type="button" onClick={() => setLightbox(s.previewUrl!)} className="w-32 h-32 flex-shrink-0 bg-white/5 overflow-hidden cursor-zoom-in">
                    <img src={s.previewUrl} alt={s.title} className="w-full h-full object-cover" />
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  {editingId === s.id ? (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-xs font-mono text-white/50 block mb-0.5">Title</label>
                          <input type="text" maxLength={120} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className={inputClass} />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-mono text-white/50 block mb-0.5">Description</label>
                        <textarea rows={2} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className={inputClass + ' resize-y'} />
                      </div>
                      <div className="flex gap-2 items-center">
                        <label className="text-xs font-mono text-white/50 border border-white/20 px-3 py-1 cursor-pointer hover:border-white/50 transition-colors">
                          Replace Image
                          <input type="file" accept="image/jpeg,image/png" onChange={handleImageChange} className="hidden" />
                        </label>
                        {imageFile && <span className="text-xs text-green-400 font-mono">{imageFile.name}</span>}
                        <button type="button" onClick={handleEditSave} disabled={acting === s.id} className="px-3 py-1 bg-white text-black text-xs font-medium hover:bg-white/90 disabled:opacity-40 transition-all">
                          {acting === s.id ? 'Saving…' : 'Save Edits'}
                        </button>
                        <button type="button" onClick={() => { setEditingId(null); setImageFile(null); setImagePreview(null); }} className="text-xs text-white/50 hover:text-white transition-colors">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-start mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-medium truncate pr-2">{s.title}</h3>
                          {s.status === 'ai_rejected' && (
                            <span className="px-2 py-0.5 text-xs font-mono bg-red-900/40 text-red-400 border border-red-400/30 flex-shrink-0">
                              AUTO-REJECTED
                            </span>
                          )}
                          {s.status === 'needs_review' && (
                            <span className="px-2 py-0.5 text-xs font-mono bg-amber-900/40 text-amber-400 border border-amber-400/30 flex-shrink-0">
                              VERIFY
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <button onClick={() => { setEditingId(s.id); setEditForm({ title: s.title, description: s.description || '' }); }} className="text-xs text-white/40 hover:text-white transition-colors font-mono">Edit</button>
                          <span className="text-sm font-mono text-white/50">
                            {new Date(s.created_at).toLocaleDateString()} {new Date(s.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                          </span>
                        </div>
                      </div>
                      {/* AI screening reason */}
                      {s.ai_screen_reason && (
                        <div className={`mb-2 px-3 py-2 text-xs font-mono border ${
                          s.status === 'ai_rejected'
                            ? 'bg-red-900/20 border-red-400/20 text-red-400/80'
                            : 'bg-amber-900/20 border-amber-400/20 text-amber-400/80'
                        }`}>
                          AI: {s.ai_screen_reason}
                          {s.image_review_flags && s.image_review_flags.length > 0 && (
                            <span className="ml-2 opacity-60">— flags: {s.image_review_flags.join(', ')}</span>
                          )}
                        </div>
                      )}
                      {s.description && <p className="text-sm text-white/60 leading-relaxed mb-2 line-clamp-3">{s.description}</p>}
                      <div className="flex gap-4 text-sm text-white/40 font-mono flex-wrap">
                        <span className="flex items-center gap-1">Wallet: <CopyWallet address={s.creator_wallet} /></span>
                        {s.creator_email && <span>{s.creator_email}</span>}
                      </div>
                      {(s.suggestedEdition || s.suggestedPrice) && (
                        <div className="mt-2 text-sm font-mono text-amber-400/60">
                          Suggested: {s.suggestedEdition ? `${s.suggestedEdition} ed` : ''}{s.suggestedEdition && s.suggestedPrice ? ' · ' : ''}{s.suggestedPrice ? `$${s.suggestedPrice} USDC` : ''}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Approve / Reject actions */}
              {approveForm?.id === s.id ? (
                <form onSubmit={handleApprove} className="border-t border-white/10 p-4 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Edition size</label>
                      <input type="number" required min={1} max={10000} value={approveForm.edition_size} onChange={(e) => setApproveForm({ ...approveForm, edition_size: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Price USDC</label>
                      <input type="number" required min={0.1} max={10000} step={0.01} value={approveForm.price_usdc} onChange={(e) => setApproveForm({ ...approveForm, price_usdc: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Override Title</label>
                      <input type="text" maxLength={120} placeholder={s.title} value={approveForm.title} onChange={(e) => setApproveForm({ ...approveForm, title: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Override Description</label>
                      <input type="text" placeholder="Keep original" value={approveForm.description} onChange={(e) => setApproveForm({ ...approveForm, description: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none" />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button type="submit" disabled={acting === s.id} className="px-5 py-1.5 bg-white text-black text-base font-medium hover:bg-white/90 disabled:opacity-40 transition-all">
                      {acting === s.id ? 'Approving…' : 'Confirm Approve'}
                    </button>
                    <button type="button" onClick={() => setApproveForm(null)} className="text-sm text-white/50 hover:text-white transition-colors">Cancel</button>
                  </div>
                </form>
              ) : rejectForm?.id === s.id ? (
                <form onSubmit={handleReject} className="border-t border-white/10 p-4 flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="text-sm font-mono text-white/60 block mb-1">Reason (optional)</label>
                    <input type="text" maxLength={500} placeholder="Reason for rejection…" value={rejectForm.reason} onChange={(e) => setRejectForm({ ...rejectForm, reason: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none" />
                  </div>
                  <button type="submit" disabled={acting === s.id} className="px-5 py-1.5 border border-red-400/50 text-red-400 text-base hover:border-red-400 disabled:opacity-40 transition-all">
                    {acting === s.id ? 'Rejecting…' : 'Confirm Reject'}
                  </button>
                  <button type="button" onClick={() => setRejectForm(null)} className="text-sm text-white/50 hover:text-white transition-colors">Cancel</button>
                </form>
              ) : (
                <div className="border-t border-white/10 p-4 flex gap-3 flex-wrap">
                  <button
                    onClick={() => { setApproveForm({ id: s.id, edition_size: s.suggestedEdition || '10', price_usdc: s.suggestedPrice || '5', title: '', description: '' }); setRejectForm(null); }}
                    className={`px-5 py-1.5 text-sm font-medium transition-all ${
                      s.status === 'ai_rejected'
                        ? 'bg-amber-400 text-black hover:bg-amber-300'
                        : s.status === 'needs_review'
                        ? 'bg-amber-400 text-black hover:bg-amber-300'
                        : 'bg-white text-black hover:bg-white/90'
                    }`}
                  >
                    {s.status === 'ai_rejected' ? 'Override — Approve' : s.status === 'needs_review' ? 'Approve Listing' : 'Approve'}
                  </button>
                  <button onClick={() => { setRejectForm({ id: s.id, reason: '' }); setApproveForm(null); }} className="px-5 py-1.5 border border-red-400/30 text-red-400 text-sm hover:border-red-400 transition-all">Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox overlay */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out" onClick={() => setLightbox(null)} onKeyDown={(e) => { if (e.key === 'Escape') setLightbox(null); }} tabIndex={0} ref={(el) => el?.focus()}>
          <img src={lightbox} alt="Full-size preview" className="max-w-[90vw] max-h-[90vh] object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

// ── Drops Tab (Superadmin) ─────────────────────────────────────────────
function DropsTab() {
  const [drops,   setDrops]   = useState<Drop[]>([]);
  const [brands,  setBrands]  = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    title: '', description: '', price_usdc: '', edition_size: '',
    creator_email: '', creator_handle: '', creator_bio: '',
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [acting,  setActing]  = useState(false);
  const [msg,     setMsg]     = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter]   = useState<'all' | 'digital' | 'physical' | 'voucher'>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'storefront' | 'agent_only'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const [dropsRes, brandsRes] = await Promise.all([
      fetch('/api/rrg/admin/drops'),
      fetch('/api/rrg/admin/brands'),
    ]);
    const d = await dropsRes.json();
    const b = await brandsRes.json();
    setDrops(d.drops || []);
    setBrands(b.brands || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (d: Drop) => {
    setEditing(d.id);
    setEditForm({
      title: d.title,
      description: d.description || '',
      price_usdc: parseFloat(d.price_usdc).toString(),
      edition_size: d.edition_size.toString(),
      creator_email: d.creator_email || '',
      creator_handle: d.creator_handle || '',
      creator_bio: d.creator_bio || '',
    });
    setImageFile(null);
    setImagePreview(null);
    setMsg('');
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setActing(true);
    setMsg('');

    const formData = new FormData();
    formData.append('submissionId', editing);
    formData.append('title', editForm.title);
    formData.append('description', editForm.description);
    formData.append('price_usdc', editForm.price_usdc);
    formData.append('edition_size', editForm.edition_size);
    formData.append('creator_email', editForm.creator_email);
    formData.append('creator_handle', editForm.creator_handle);
    formData.append('creator_bio', editForm.creator_bio);
    if (imageFile) formData.append('image', imageFile);

    const res = await fetch('/api/rrg/admin/drops', { method: 'PATCH', body: formData });
    const data = await res.json();
    setActing(false);
    if (res.ok) {
      setMsg(`Updated ✓ (${data.updated?.join(', ')})`);
      setEditing(null);
      setImageFile(null);
      setImagePreview(null);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  const toggleHidden = async (d: Drop) => {
    setActing(true);
    const res = await fetch('/api/rrg/admin/drops', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: d.id, hidden: !d.hidden }),
    });
    setActing(false);
    if (res.ok) load();
    else setMsg('Error toggling visibility');
  };

  const toggleUiVisible = async (d: Drop) => {
    setActing(true);
    const res = await fetch('/api/rrg/admin/drops', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: d.id, ui_visible: !(d.ui_visible ?? true) }),
    });
    setActing(false);
    if (res.ok) load();
    else setMsg('Error toggling storefront visibility');
  };

  const scanBase = 'https://basescan.org';
  const inputClass = 'w-full bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none';
  const labelClass = 'text-sm font-mono text-white/60 block mb-1';

  // Apply filters
  const filteredDrops = drops.filter((d) => {
    if (brandFilter !== 'all' && (d.brand_id || '') !== brandFilter) return false;
    if (typeFilter === 'physical' && !d.is_physical_product) return false;
    if (typeFilter === 'voucher' && !d.has_voucher) return false;
    if (typeFilter === 'digital' && (d.is_physical_product || d.has_voucher)) return false;
    const uiVis = d.ui_visible ?? true;
    if (visibilityFilter === 'storefront' && !uiVis) return false;
    if (visibilityFilter === 'agent_only' && uiVis) return false;
    return true;
  });

  const storefrontCount = drops.filter(d => (d.ui_visible ?? true) && !d.hidden).length;
  const mcpCount        = drops.filter(d => !d.hidden).length;

  const filterSelectClass = 'bg-black border border-white/20 px-2 py-1.5 text-xs font-mono uppercase tracking-wider focus:border-white outline-none';

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xs font-mono uppercase tracking-widest text-white/60">
          Approved Listings — Superadmin
        </h2>
        <button onClick={load} className="text-xs text-white/50 hover:text-white transition-colors font-mono">
          ↻ Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center mb-6">
        <span className="text-xs font-mono uppercase tracking-wider text-white/40">Filter:</span>
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className={filterSelectClass}
        >
          <option value="all">All Brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | 'digital' | 'physical' | 'voucher')}
          className={filterSelectClass}
        >
          <option value="all">All Types</option>
          <option value="digital">Digital Only (Co-Creation)</option>
          <option value="physical">Physical Product</option>
          <option value="voucher">Vouchers</option>
        </select>
        <select
          value={visibilityFilter}
          onChange={(e) => setVisibilityFilter(e.target.value as 'all' | 'storefront' | 'agent_only')}
          className={filterSelectClass}
          title="Storefront = visible in human UI grid. Agent-only = hidden from UI but listed via MCP."
        >
          <option value="all">All Visibility</option>
          <option value="storefront">Storefront (UI)</option>
          <option value="agent_only">Agent-only (MCP)</option>
        </select>
        <span className="text-xs font-mono text-white/40 ml-auto">
          {filteredDrops.length} of {drops.length} • {storefrontCount} on storefront / {mcpCount} on MCP
        </span>
      </div>

      {msg && (
        <div className={`mb-4 p-3 border text-sm font-mono ${
          msg.startsWith('Error') ? 'border-red-400/30 text-red-400' : 'border-white/20 text-green-400'
        }`}>{msg}</div>
      )}

      {loading ? (
        <p className="text-white/40 text-sm font-mono">Loading…</p>
      ) : filteredDrops.length === 0 ? (
        <p className="text-white/40 text-sm font-mono">
          {drops.length === 0 ? 'No approved listings yet.' : 'No listings match the current filters.'}
        </p>
      ) : (
        <div className="space-y-4">
          {filteredDrops.map((d) => (
            <div key={d.id} className={`border border-white/10 ${d.hidden ? 'opacity-40' : ''}`}>
              <div className="p-4 flex gap-4">
                {/* Image thumbnail */}
                {d.previewUrl && (
                  <button
                    type="button"
                    onClick={() => setLightbox(d.previewUrl!)}
                    className="w-20 h-20 flex-shrink-0 bg-white/5 overflow-hidden cursor-zoom-in"
                  >
                    <img src={d.previewUrl} alt={d.title} className="w-full h-full object-cover" />
                  </button>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-base font-medium">{d.title}</p>
                      {d.description && (
                        <p className="text-sm text-white/50 mt-0.5 line-clamp-1">{d.description}</p>
                      )}
                    </div>
                    <div className="flex gap-3 text-sm flex-shrink-0 ml-4">
                      <label className="flex items-center gap-1.5 cursor-pointer" title={d.hidden ? 'Hidden from every surface (UI + MCP + deep links)' : 'Listed across UI + MCP'}>
                        <input type="checkbox" checked={!d.hidden} onChange={() => toggleHidden(d)} disabled={acting} className="w-4 h-4 accent-white cursor-pointer" />
                        <span className="text-white/50 font-mono text-xs">{d.hidden ? 'Hidden' : 'Vis'}</span>
                      </label>
                      <label
                        className={`flex items-center gap-1.5 cursor-pointer ${d.hidden ? 'opacity-30' : ''}`}
                        title={d.hidden
                          ? 'Hidden globally — storefront flag has no effect'
                          : (d.ui_visible ?? true)
                            ? 'Shown in storefront grid'
                            : 'MCP-only: agents can find it, humans cannot browse to it from /brand'}
                      >
                        <input
                          type="checkbox"
                          checked={d.ui_visible ?? true}
                          disabled={acting || d.hidden}
                          onChange={() => toggleUiVisible(d)}
                          className="w-4 h-4 accent-white cursor-pointer"
                        />
                        <span className="text-white/50 font-mono text-xs">{(d.ui_visible ?? true) ? 'UI' : 'MCP'}</span>
                      </label>
                      <button onClick={() => editing === d.id ? setEditing(null) : startEdit(d)} className="text-white/50 hover:text-white transition-colors">
                        {editing === d.id ? 'Cancel' : 'Edit'}
                      </button>
                      <a href={`/rrg/drop/${d.token_id}`} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white transition-colors">View ↗</a>
                      <a href={`${scanBase}/address/${process.env.NEXT_PUBLIC_RRG_CONTRACT_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white transition-colors font-mono">Scan ↗</a>
                    </div>
                  </div>

                  <div className="flex gap-4 mt-1.5 text-sm text-white/50 font-mono flex-wrap">
                    <span>Token #{d.token_id}</span>
                    <span>${parseFloat(d.price_usdc).toFixed(2)}</span>
                    <span>{d.edition_size} ed.</span>
                    <span>{new Date(d.approved_at).toLocaleDateString()}</span>
                    {d.submission_channel && <span className="text-white/30">via {d.submission_channel}</span>}
                    {d.creator_type && <span className="text-white/30">{d.creator_type}</span>}
                    <span className="flex items-center gap-1">
                      <CopyWallet address={d.creator_wallet} />
                    </span>
                    {d.creator_email && <span className="text-white/30">{d.creator_email}</span>}
                  </div>
                </div>
              </div>

              {/* ── Full edit form ── */}
              {editing === d.id && (
                <form onSubmit={handleSave} className="border-t border-white/10 p-4 space-y-4">
                  {/* Row 1: Image + Title + Description */}
                  <div className="flex gap-4">
                    {/* Image replacement */}
                    <div className="flex-shrink-0">
                      <label className={labelClass}>Image</label>
                      <div className="w-32 h-32 bg-white/5 border border-white/20 overflow-hidden relative group">
                        <img
                          src={imagePreview || d.previewUrl || ''}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                        <label className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                          <span className="text-xs font-mono text-white/80">Replace</span>
                          <input type="file" accept="image/jpeg,image/png" onChange={handleImageChange} className="hidden" />
                        </label>
                      </div>
                      {imageFile && <p className="text-xs text-green-400 mt-1 font-mono">New: {imageFile.name}</p>}
                    </div>

                    <div className="flex-1 space-y-3">
                      <div>
                        <label className={labelClass}>Title</label>
                        <input type="text" required maxLength={120} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className={inputClass} />
                      </div>
                      <div>
                        <label className={labelClass}>Description</label>
                        <textarea rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className={inputClass + ' resize-y'} />
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Price / Edition / Creator fields */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div>
                      <label className={labelClass}>Price USDC</label>
                      <input type="number" required min={0.1} max={10000} step={0.01} value={editForm.price_usdc} onChange={(e) => setEditForm({ ...editForm, price_usdc: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Edition Size</label>
                      <input type="number" required min={1} max={10000} value={editForm.edition_size} onChange={(e) => setEditForm({ ...editForm, edition_size: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Creator Email</label>
                      <input type="email" value={editForm.creator_email} onChange={(e) => setEditForm({ ...editForm, creator_email: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Creator Handle</label>
                      <input type="text" value={editForm.creator_handle} onChange={(e) => setEditForm({ ...editForm, creator_handle: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Creator Bio</label>
                      <input type="text" value={editForm.creator_bio} onChange={(e) => setEditForm({ ...editForm, creator_bio: e.target.value })} className={inputClass} />
                    </div>
                  </div>

                  {/* Save */}
                  <div className="flex gap-3 items-center">
                    <button type="submit" disabled={acting} className="px-5 py-1.5 bg-white text-black text-base font-medium hover:bg-white/90 disabled:opacity-40 transition-all">
                      {acting ? 'Saving…' : 'Save All Changes'}
                    </button>
                    <button type="button" onClick={() => { setEditing(null); setImageFile(null); setImagePreview(null); }} className="text-sm text-white/50 hover:text-white transition-colors">
                      Cancel
                    </button>
                    {imageFile && (
                      <span className="text-xs text-amber-400 font-mono">Image will be replaced on save</span>
                    )}
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox overlay */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out"
          onClick={() => setLightbox(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setLightbox(null); }}
          tabIndex={0}
          ref={(el) => el?.focus()}
        >
          <img src={lightbox} alt="Full-size preview" className="max-w-[90vw] max-h-[90vh] object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

// ── Brands Tab ────────────────────────────────────────────────────────
function BrandsTab() {
  const [brands,    setBrands]    = useState<Brand[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [creating,  setCreating]  = useState(false);
  const [inviting,  setInviting]  = useState<string | null>(null); // brandId being invited
  const [msg,       setMsg]       = useState('');
  const [form,      setForm]      = useState({
    name: '', slug: '', contact_email: '', wallet_address: '', description: '', headline: '', website_url: '',
  });
  const [inviteForm, setInviteForm] = useState({ email: '', temp_password: '' });
  const [editing,    setEditing]   = useState<string | null>(null);
  const [editForm,   setEditForm]  = useState({
    name: '', slug: '', headline: '', description: '', website_url: '',
    contact_email: '', wallet_address: '', max_self_listings: '',
    logo_path: '', banner_path: '', social_instagram: '', social_twitter: '', social_website: '',
  });
  const [logoFile,     setLogoFile]     = useState<File | null>(null);
  const [logoPreview,  setLogoPreview]  = useState<string | null>(null);
  const [bannerFile,   setBannerFile]   = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch('/api/rrg/admin/brands');
    const data = await res.json();
    setBrands(data.brands || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    const res = await fetch('/api/rrg/admin/brands/create', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg(`Brand "${data.brand.name}" created ✓`);
      setForm({ name: '', slug: '', contact_email: '', wallet_address: '', description: '', headline: '', website_url: '' });
      setCreating(false);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviting) return;
    setMsg('');
    const res = await fetch('/api/rrg/admin/brands/invite', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ brand_id: inviting, email: inviteForm.email, temp_password: inviteForm.temp_password }),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg(`Invited ${inviteForm.email} ✓`);
      setInviteForm({ email: '', temp_password: '' });
      setInviting(null);
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  const handleStatusToggle = async (brand: Brand) => {
    const newStatus = brand.status === 'active' ? 'suspended' : 'active';
    setMsg('');
    const res = await fetch(`/api/rrg/admin/brands/${brand.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      setMsg(`Brand ${newStatus === 'active' ? 'activated' : 'suspended'} ✓`);
      load();
    } else {
      const data = await res.json();
      setMsg(`Error: ${data.error}`);
    }
  };

  const startEdit = (b: Brand) => {
    setEditing(b.id);
    setInviting(null);
    setLogoFile(null);
    setLogoPreview(null);
    setBannerFile(null);
    setBannerPreview(null);
    const sl = b.social_links || {};
    setEditForm({
      name: b.name || '',
      slug: b.slug || '',
      headline: b.headline || '',
      description: b.description || '',
      website_url: b.website_url || '',
      contact_email: b.contact_email || '',
      wallet_address: b.wallet_address || '',
      max_self_listings: b.max_self_listings?.toString() || '5',
      logo_path: b.logo_path || '',
      banner_path: b.banner_path || '',
      social_instagram: sl.instagram || '',
      social_twitter: sl.twitter || '',
      social_website: sl.website || '',
    });
  };

  const handleFileSelect = (type: 'logo' | 'banner', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (type === 'logo') {
      setLogoFile(file);
      if (file) { const r = new FileReader(); r.onload = (ev) => setLogoPreview(ev.target?.result as string); r.readAsDataURL(file); }
      else setLogoPreview(null);
    } else {
      setBannerFile(file);
      if (file) { const r = new FileReader(); r.onload = (ev) => setBannerPreview(ev.target?.result as string); r.readAsDataURL(file); }
      else setBannerPreview(null);
    }
  };

  const handleEditSave = async (brandId: string) => {
    setEditSaving(true);
    setMsg('');
    const social_links: Record<string, string> = {};
    if (editForm.social_instagram) social_links.instagram = editForm.social_instagram;
    if (editForm.social_twitter) social_links.twitter = editForm.social_twitter;
    if (editForm.social_website) social_links.website = editForm.social_website;

    // Use FormData to support image uploads
    const formData = new FormData();
    formData.append('name', editForm.name);
    formData.append('slug', editForm.slug);
    formData.append('headline', editForm.headline);
    formData.append('description', editForm.description);
    formData.append('website_url', editForm.website_url);
    formData.append('contact_email', editForm.contact_email);
    formData.append('wallet_address', editForm.wallet_address);
    formData.append('social_links', JSON.stringify(social_links));
    if (editForm.max_self_listings) formData.append('max_self_listings', editForm.max_self_listings);
    if (logoFile) formData.append('logo_file', logoFile);
    if (bannerFile) formData.append('banner_file', bannerFile);

    const res = await fetch(`/api/rrg/admin/brands/${brandId}`, {
      method: 'PATCH',
      body: formData,
    });
    const data = await res.json();
    setEditSaving(false);
    if (res.ok) {
      setMsg(`Brand updated ✓${data.updated ? ' (' + data.updated.join(', ') + ')' : ''}`);
      setEditing(null);
      setLogoFile(null); setLogoPreview(null);
      setBannerFile(null); setBannerPreview(null);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-mono uppercase tracking-widest text-white/60">Brands</h2>
        <button
          onClick={() => setCreating(!creating)}
          className="text-sm border border-white/30 px-4 py-1.5 hover:border-white transition-all"
        >
          {creating ? 'Cancel' : '+ Register Brand'}
        </button>
      </div>

      {msg && (
        <div className="mb-4 p-3 border border-white/20 bg-white/5 text-sm font-mono text-white/80">
          {msg}
        </div>
      )}

      {creating && (
        <form onSubmit={handleCreate} className="mb-8 p-6 border border-white/20 space-y-4">
          <h3 className="text-base font-medium mb-2">Register New Brand</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Name *</label>
              <input
                type="text" required maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Slug *</label>
              <input
                type="text" required maxLength={50}
                placeholder="my-brand"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Contact Email *</label>
              <input
                type="email" required
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Wallet Address *</label>
              <input
                type="text" required
                placeholder="0x…"
                value={form.wallet_address}
                onChange={(e) => setForm({ ...form, wallet_address: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Headline</label>
              <input
                type="text" maxLength={200}
                value={form.headline}
                onChange={(e) => setForm({ ...form, headline: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-mono text-white/60 block mb-1">Website</label>
              <input
                type="url"
                value={form.website_url}
                onChange={(e) => setForm({ ...form, website_url: e.target.value })}
                className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-mono text-white/60 block mb-1">Description</label>
            <textarea
              rows={3} maxLength={1000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none resize-none"
            />
          </div>
          <button
            type="submit"
            className="px-6 py-2 bg-white text-black text-base font-medium hover:bg-white/90 transition-all"
          >
            Create Brand →
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-white/40 text-sm font-mono">Loading…</p>
      ) : brands.length === 0 ? (
        <p className="text-white/40 text-sm font-mono">No brands registered.</p>
      ) : (
        <div className="space-y-4">
          {brands.map((b) => (
            <div key={b.id} className="border border-white/10 overflow-hidden">
              {editing === b.id ? (
                /* ── Full Edit form (Superadmin) ────────── */
                <div className="p-5 space-y-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-mono text-white/60">Editing: /{b.slug}</span>
                    <span className={`text-sm font-mono px-2 py-0.5 ${
                      b.status === 'active' ? 'bg-green-400/20 text-green-400' :
                      b.status === 'suspended' ? 'bg-red-400/20 text-red-400' :
                      'bg-white/10 text-white/60'
                    }`}>{b.status.toUpperCase()}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Name</label>
                      <input type="text" maxLength={100} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Slug</label>
                      <input type="text" maxLength={50} value={editForm.slug} onChange={(e) => setEditForm({ ...editForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none font-mono" />
                    </div>
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Headline</label>
                      <input type="text" maxLength={200} value={editForm.headline} onChange={(e) => setEditForm({ ...editForm, headline: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Contact Email</label>
                      <input type="email" value={editForm.contact_email} onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Website</label>
                      <input type="url" value={editForm.website_url} onChange={(e) => setEditForm({ ...editForm, website_url: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Max Self-Listings</label>
                      <input type="number" min={0} max={1000} value={editForm.max_self_listings} onChange={(e) => setEditForm({ ...editForm, max_self_listings: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-mono text-white/60 block mb-1">Wallet Address</label>
                    <input type="text" value={editForm.wallet_address} onChange={(e) => setEditForm({ ...editForm, wallet_address: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none font-mono" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Logo</label>
                      <div className="flex gap-3 items-start">
                        <div className="w-20 h-20 bg-white/5 border border-white/20 overflow-hidden flex-shrink-0 relative group">
                          {(logoPreview || b.logoUrl) ? (
                            <img src={logoPreview || b.logoUrl!} alt="Logo" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white/20 text-xs font-mono">No logo</div>
                          )}
                          <label className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                            <span className="text-xs font-mono text-white/80">Replace</span>
                            <input type="file" accept="image/jpeg,image/png" onChange={(e) => handleFileSelect('logo', e)} className="hidden" />
                          </label>
                        </div>
                        <div className="flex-1 min-w-0">
                          {logoFile && <p className="text-xs text-green-400 font-mono truncate">New: {logoFile.name}</p>}
                          {b.logo_path && <p className="text-xs text-white/30 font-mono truncate mt-1">{b.logo_path}</p>}
                          {!logoFile && !b.logo_path && (
                            <label className="text-xs font-mono text-white/50 border border-white/20 px-2 py-1 cursor-pointer hover:border-white/50 transition-colors inline-block">
                              Upload Logo
                              <input type="file" accept="image/jpeg,image/png" onChange={(e) => handleFileSelect('logo', e)} className="hidden" />
                            </label>
                          )}
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Banner</label>
                      <div className="flex gap-3 items-start">
                        <div className="w-32 h-20 bg-white/5 border border-white/20 overflow-hidden flex-shrink-0 relative group">
                          {(bannerPreview || b.bannerUrl) ? (
                            <img src={bannerPreview || b.bannerUrl!} alt="Banner" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white/20 text-xs font-mono">No banner</div>
                          )}
                          <label className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                            <span className="text-xs font-mono text-white/80">Replace</span>
                            <input type="file" accept="image/jpeg,image/png" onChange={(e) => handleFileSelect('banner', e)} className="hidden" />
                          </label>
                        </div>
                        <div className="flex-1 min-w-0">
                          {bannerFile && <p className="text-xs text-green-400 font-mono truncate">New: {bannerFile.name}</p>}
                          {b.banner_path && <p className="text-xs text-white/30 font-mono truncate mt-1">{b.banner_path}</p>}
                          {!bannerFile && !b.banner_path && (
                            <label className="text-xs font-mono text-white/50 border border-white/20 px-2 py-1 cursor-pointer hover:border-white/50 transition-colors inline-block">
                              Upload Banner
                              <input type="file" accept="image/jpeg,image/png" onChange={(e) => handleFileSelect('banner', e)} className="hidden" />
                            </label>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Instagram</label>
                      <input type="text" placeholder="@handle" value={editForm.social_instagram} onChange={(e) => setEditForm({ ...editForm, social_instagram: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Twitter / X</label>
                      <input type="text" placeholder="@handle" value={editForm.social_twitter} onChange={(e) => setEditForm({ ...editForm, social_twitter: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="text-sm font-mono text-white/60 block mb-1">Social Website</label>
                      <input type="url" placeholder="https://..." value={editForm.social_website} onChange={(e) => setEditForm({ ...editForm, social_website: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-mono text-white/60 block mb-1">Description</label>
                    <textarea rows={3} maxLength={1000} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="w-full bg-transparent border border-white/20 px-3 py-2 text-base focus:border-white outline-none resize-y" />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => handleEditSave(b.id)} disabled={editSaving} className="px-5 py-1.5 bg-white text-black text-base font-medium hover:bg-white/90 disabled:opacity-40 transition-all">
                      {editSaving ? 'Saving…' : 'Save All Changes'}
                    </button>
                    <button onClick={() => setEditing(null)} className="text-sm text-white/50 hover:text-white transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                /* ── Brand display ────────────────────────── */
                <>
                  <div className="p-5">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex gap-3 items-center">
                        {b.logoUrl && (
                          <img src={b.logoUrl} alt={b.name} className="w-10 h-10 object-cover rounded" />
                        )}
                        <div>
                          <h3 className="text-base font-medium">{b.name}</h3>
                          <span className="text-sm font-mono text-white/50">/{b.slug}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-mono px-2 py-0.5 ${
                          b.status === 'active'    ? 'bg-green-400/20 text-green-400' :
                          b.status === 'pending'   ? 'bg-amber-400/20 text-amber-400' :
                          b.status === 'suspended' ? 'bg-red-400/20 text-red-400' :
                                                     'bg-white/10 text-white/60'
                        }`}>
                          {b.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    {b.headline && <p className="text-sm text-white/70 mb-2">{b.headline}</p>}
                    <div className="flex gap-4 text-sm text-white/40 font-mono flex-wrap">
                      <CopyWallet address={b.wallet_address} />
                      <span>{b.contact_email}</span>
                      <span>Listings: {b.self_listings_used}/{b.max_self_listings}</span>
                      <span>{new Date(b.created_at).toLocaleDateString()} {new Date(b.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
                      {b.website_url && <a href={b.website_url} target="_blank" rel="noopener noreferrer" className="hover:text-white/80">{b.website_url}</a>}
                    </div>
                  </div>

                  {/* Invite form */}
                  {inviting === b.id ? (
                    <form onSubmit={handleInvite} className="border-t border-white/10 p-4 flex gap-3 items-end flex-wrap">
                      <div>
                        <label className="text-sm font-mono text-white/60 block mb-1">Admin email</label>
                        <input
                          type="email" required
                          value={inviteForm.email}
                          onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                          className="w-56 bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-mono text-white/60 block mb-1">Temp password</label>
                        <input
                          type="text" required minLength={8}
                          value={inviteForm.temp_password}
                          onChange={(e) => setInviteForm({ ...inviteForm, temp_password: e.target.value })}
                          className="w-40 bg-transparent border border-white/20 px-3 py-1.5 text-base focus:border-white outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        className="px-5 py-1.5 bg-white text-black text-base font-medium hover:bg-white/90 transition-all"
                      >
                        Send Invite
                      </button>
                      <button
                        type="button"
                        onClick={() => setInviting(null)}
                        className="text-sm text-white/50 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="border-t border-white/10 p-4 flex gap-3 flex-wrap">
                      <button
                        onClick={() => startEdit(b)}
                        className="px-4 py-1.5 text-sm border border-white/20 hover:border-white/50 transition-all"
                      >
                        Edit
                      </button>
                      <a
                        href={`/admin/rrg/brands/${b.slug}/concierge`}
                        className="px-4 py-1.5 text-sm border border-white/20 hover:border-white/50 transition-all"
                      >
                        Concierge Chat →
                      </a>
                      <button
                        onClick={() => { setInviting(b.id); setEditing(null); setInviteForm({ email: '', temp_password: '' }); }}
                        className="px-4 py-1.5 text-sm border border-white/20 hover:border-white/50 transition-all"
                      >
                        Invite Admin
                      </button>
                      <button
                        onClick={() => handleStatusToggle(b)}
                        className={`px-4 py-1.5 text-sm border transition-all ${
                          b.status === 'active'
                            ? 'border-red-400/30 text-red-400 hover:border-red-400'
                            : 'border-green-400/30 text-green-400 hover:border-green-400'
                        }`}
                      >
                        {b.status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Concierge Tab ─────────────────────────────────────────────────────
function ConciergeTab() {
  const [brands,  setBrands]  = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res  = await fetch('/api/rrg/admin/brands');
        const data = await res.json();
        if (alive) setBrands((data.brands || []).filter((b: Brand) => b.status === 'active'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <p className="font-mono text-white/50 text-sm">Loading brands…</p>;
  }

  if (brands.length === 0) {
    return <p className="font-mono text-white/50 text-sm">No active brands.</p>;
  }

  return (
    <div>
      <p className="text-sm text-white/60 mb-6 max-w-2xl">
        Pick a brand to open its Concierge chat. Whatever you lock in there is shared with the brand&apos;s
        Telegram concierge on the next message. Use this to brief the concierge on events, promotions,
        stock notes, brand updates, or policies without touching code.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {brands.map((b) => (
          <a
            key={b.id}
            href={`/admin/rrg/brands/${b.slug}/concierge`}
            className="group border border-white/10 hover:border-white/40 transition-all p-5 flex flex-col gap-2 bg-white/[0.02] hover:bg-white/[0.05]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-white/50">
                {b.slug}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-green-400/80">
                Active
              </span>
            </div>
            <h3 className="text-lg font-serif text-white">{b.name}</h3>
            {b.headline && (
              <p className="text-xs text-white/60 line-clamp-2">{b.headline}</p>
            )}
            <div className="mt-auto pt-2 text-xs font-mono text-white/40 group-hover:text-white/80 transition-colors">
              Open chat →
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Distributions Tab ─────────────────────────────────────────────────
function DistributionsTab() {
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [statusFilter,  setStatusFilter]  = useState<string>('');
  const [acting,        setActing]        = useState<string | null>(null);
  const [msg,           setMsg]           = useState('');
  const [payoutConfirm, setPayoutConfirm] = useState(false);
  const [payoutRunning, setPayoutRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    const res  = await fetch(`/api/rrg/admin/distributions${qs}`);
    const data = await res.json();
    setDistributions(data.distributions || []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleMarkCompleted = async (id: string) => {
    setActing(id);
    setMsg('');
    const res = await fetch(`/api/rrg/admin/distributions/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: 'completed', notes: `Marked completed by admin on ${new Date().toISOString().split('T')[0]}` }),
    });
    if (res.ok) {
      setMsg('Distribution marked completed ✓');
      load();
    } else {
      const data = await res.json();
      setMsg(`Error: ${data.error}`);
    }
    setActing(null);
  };

  const handleProcessPayouts = async () => {
    setPayoutRunning(true);
    setMsg('');
    try {
      const res = await fetch('/api/rrg/admin/distributions/payout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(`Payout complete: ${data.succeeded} succeeded, ${data.failed} failed. $${data.totalDistributed?.toFixed(2) ?? '0.00'} distributed.`);
        load();
      } else {
        setMsg(`Payout error: ${data.error}`);
      }
    } catch (err) {
      setMsg(`Payout error: ${String(err)}`);
    }
    setPayoutRunning(false);
    setPayoutConfirm(false);
  };

  // Pending count for payout button
  const pendingCount = distributions.filter(
    (d) => d.status === 'pending' && d.split_type !== 'legacy_70_30'
  ).length;
  const pendingOwed = distributions
    .filter((d) => d.status === 'pending' && d.split_type !== 'legacy_70_30')
    .reduce((sum, d) => sum + parseFloat(d.creator_usdc) + parseFloat(d.brand_usdc), 0);

  // Summary totals
  const totals = distributions.reduce(
    (acc, d) => ({
      total:    acc.total    + parseFloat(d.total_usdc),
      creator:  acc.creator  + parseFloat(d.creator_usdc),
      brand:    acc.brand    + parseFloat(d.brand_usdc),
      platform: acc.platform + parseFloat(d.platform_usdc),
    }),
    { total: 0, creator: 0, brand: 0, platform: 0 }
  );

  const splitLabel = (s: string) => {
    const labels: Record<string, string> = {
      'challenge_35_35_30':  'Challenge 35/35/30',
      'brand_product_tiered': 'Brand Product (Tiered)',
      'brand_product_70_30': 'Brand Product 70/30',
      'rrg_challenge_35_65': 'RRG Challenge 35/65',
      'legacy_70_30':        'Legacy 70/30',
    };
    return labels[s] || s;
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-mono uppercase tracking-widest text-white/60">Distributions</h2>
        <div className="flex gap-2">
          {['', 'pending', 'completed', 'failed'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-sm font-mono px-3 py-1 border transition-all ${
                statusFilter === s
                  ? 'border-white text-white'
                  : 'border-white/20 text-white/50 hover:border-white/50'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div className="mb-4 p-3 border border-white/20 bg-white/5 text-sm font-mono text-white/80">
          {msg}
        </div>
      )}

      {/* Payout action */}
      {pendingCount > 0 && (statusFilter === '' || statusFilter === 'pending') && (
        <div className="mb-4 p-4 border border-amber-400/30 bg-amber-400/5">
          {payoutConfirm ? (
            <div className="flex items-center gap-4">
              <p className="text-sm font-mono text-amber-400 flex-1">
                Process {pendingCount} pending distribution{pendingCount !== 1 ? 's' : ''}?
                Total: ${pendingOwed.toFixed(2)} USDC to creators/brands.
              </p>
              <button
                onClick={handleProcessPayouts}
                disabled={payoutRunning}
                className="px-5 py-1.5 bg-amber-400 text-black text-sm font-medium
                           hover:bg-amber-300 disabled:opacity-40 transition-all"
              >
                {payoutRunning ? 'Processing…' : 'Confirm Payout'}
              </button>
              <button
                onClick={() => setPayoutConfirm(false)}
                disabled={payoutRunning}
                className="text-sm text-white/50 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm font-mono text-white/60">
                {pendingCount} pending payout{pendingCount !== 1 ? 's' : ''} — ${pendingOwed.toFixed(2)} USDC owed
              </p>
              <button
                onClick={() => setPayoutConfirm(true)}
                className="px-4 py-1.5 text-sm border border-amber-400/40 text-amber-400
                           hover:border-amber-400 transition-all"
              >
                Process Payouts
              </button>
            </div>
          )}
        </div>
      )}

      {/* Summary */}
      {distributions.length > 0 && (
        <div className="mb-6 p-4 border border-white/10 grid grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-sm font-mono text-white/50 mb-1">Total</p>
            <p className="text-base font-medium">${totals.total.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm font-mono text-white/50 mb-1">Creators</p>
            <p className="text-base font-medium text-green-400">${totals.creator.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm font-mono text-white/50 mb-1">Brands</p>
            <p className="text-base font-medium text-blue-400">${totals.brand.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm font-mono text-white/50 mb-1">Platform</p>
            <p className="text-base font-medium text-amber-400">${totals.platform.toFixed(2)}</p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-white/40 text-sm font-mono">Loading…</p>
      ) : distributions.length === 0 ? (
        <p className="text-white/40 text-sm font-mono">No distributions found.</p>
      ) : (
        <div className="space-y-3">
          {distributions.map((d) => (
            <div key={d.id} className="p-4 border border-white/10">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <span className="text-sm font-mono text-white/70">{splitLabel(d.split_type)}</span>
                  <span className="text-sm font-mono text-white/40 ml-3">
                    {new Date(d.created_at).toLocaleString()}
                  </span>
                  {(d.brand_name || d.submission_title || d.token_id) && (
                    <p className="text-xs font-mono text-white/50 mt-1">
                      {d.brand_name && <span className="text-white/70">{d.brand_name}</span>}
                      {d.submission_title && <span className="text-white/40"> — {d.submission_title}</span>}
                      {d.token_id != null && <span className="text-white/30 ml-2">#{d.token_id}</span>}
                    </p>
                  )}
                </div>
                <span className={`text-sm font-mono px-2 py-0.5 ${
                  d.status === 'completed' ? 'bg-green-400/20 text-green-400' :
                  d.status === 'pending'   ? 'bg-amber-400/20 text-amber-400' :
                                             'bg-red-400/20 text-red-400'
                }`}>
                  {d.status.toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-sm font-mono mb-2">
                <span className="text-white/60">Total: <span className="text-white">${parseFloat(d.total_usdc).toFixed(2)}</span></span>
                <span className="text-white/60">Creator: <span className="text-green-400">${parseFloat(d.creator_usdc).toFixed(2)}</span></span>
                <span className="text-white/60">Brand: <span className="text-blue-400">${parseFloat(d.brand_usdc).toFixed(2)}</span></span>
                <span className="text-white/60">Platform: <span className="text-amber-400">${parseFloat(d.platform_usdc).toFixed(2)}</span></span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
                {d.creator_wallet && (
                  <span className="flex items-center gap-1 text-white/40">
                    Creator wallet: <CopyWallet address={d.creator_wallet} />
                  </span>
                )}
                {d.brand_wallet && (
                  <span className="flex items-center gap-1 text-white/40">
                    Brand wallet: <CopyWallet address={d.brand_wallet} />
                  </span>
                )}
                {d.purchase_tx_hash && (
                  <span className="text-white/40 col-span-2">
                    Buyer tx:{' '}
                    <a
                      href={`https://basescan.org/tx/${d.purchase_tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      {d.purchase_tx_hash.slice(0, 10)}…{d.purchase_tx_hash.slice(-6)}
                    </a>
                  </span>
                )}
                {d.notes && (() => {
                  const parts = d.notes.split(' | ');
                  const payoutTxs = parts.filter((p) => p.startsWith('brand:') || p.startsWith('creator:'));
                  return payoutTxs.map((entry) => {
                    const [label, hash] = entry.split(':');
                    return hash ? (
                      <span key={entry} className="text-white/40 col-span-2">
                        {label === 'brand' ? 'Seller' : 'Creator'} payout tx:{' '}
                        <a
                          href={`https://basescan.org/tx/${hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 hover:underline"
                        >
                          {hash.slice(0, 10)}…{hash.slice(-6)}
                        </a>
                      </span>
                    ) : null;
                  });
                })()}
              </div>

              {d.status === 'pending' && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  <button
                    onClick={() => handleMarkCompleted(d.id)}
                    disabled={acting === d.id}
                    className="px-4 py-1.5 text-sm bg-green-400/20 text-green-400 border border-green-400/30
                               hover:border-green-400 disabled:opacity-40 transition-all"
                  >
                    {acting === d.id ? 'Marking…' : 'Mark Completed'}
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

// ── Contributors Tab ────────────────────────────────────────────────────
function ContributorsTab() {
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [stats, setStats] = useState<{ total: number; humans: number; agents: number; totalRevenue: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'human' | 'agent'>('all');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/rrg/admin/contributors');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setContributors(data.contributors ?? []);
        setStats(data.stats ?? null);
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    })();
  }, []);

  const filtered = filter === 'all'
    ? contributors
    : contributors.filter((c) => c.creator_type === filter);

  if (loading) {
    return <p className="text-white/50 font-mono text-base py-8">Loading contributors…</p>;
  }

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-white/10 p-4">
            <p className="text-xs text-white/60 font-mono uppercase tracking-wider">Total</p>
            <p className="text-base font-mono mt-1">{stats.total}</p>
          </div>
          <div className="border border-white/10 p-4">
            <p className="text-xs text-white/60 font-mono uppercase tracking-wider">Human</p>
            <p className="text-base font-mono mt-1">{stats.humans}</p>
          </div>
          <div className="border border-white/10 p-4">
            <p className="text-xs text-white/60 font-mono uppercase tracking-wider">AI Agent</p>
            <p className="text-base font-mono mt-1">{stats.agents}</p>
          </div>
          <div className="border border-white/10 p-4">
            <p className="text-xs text-white/60 font-mono uppercase tracking-wider">Revenue Dist.</p>
            <p className="text-base font-mono mt-1">${stats.totalRevenue.toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-3">
        {(['all', 'human', 'agent'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider border transition-all
              ${filter === f
                ? 'text-white border-white'
                : 'text-white/50 border-white/10 hover:text-white/80'
              }`}
          >
            {f === 'all' ? `All (${contributors.length})` : f}
          </button>
        ))}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="text-white/50 text-sm font-mono py-4">No contributors found.</p>
      ) : (
        <div className="border border-white/10">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-white/10 text-white/60 uppercase tracking-wider text-xs">
                <th className="text-left p-3 w-10"></th>
                <th className="text-left p-3">Wallet</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Email</th>
                <th className="text-right p-3">Subs</th>
                <th className="text-right p-3">OK</th>
                <th className="text-right p-3">Rej</th>
                <th className="text-right p-3">Rate</th>
                <th className="text-right p-3">Revenue</th>
                <th className="text-left p-3">Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const rate = c.total_submissions > 0
                  ? ((c.total_approved / c.total_submissions) * 100).toFixed(0)
                  : '—';
                return (
                  <tr key={c.wallet_address} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="p-3">
                      {c.avatar_url ? (
                        <img src={c.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 text-white/60 text-xs font-medium">
                          {(c.display_name || c.wallet_address.slice(2, 4)).slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-white/80">
                      <CopyWallet address={c.wallet_address} />
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 text-[10px] uppercase
                        ${c.creator_type === 'agent'
                          ? 'bg-purple-400/20 text-purple-300 border border-purple-400/30'
                          : 'bg-blue-400/20 text-blue-300 border border-blue-400/30'
                        }`}
                      >
                        {c.creator_type}
                      </span>
                    </td>
                    <td className="p-3 text-white/80 truncate">{c.display_name || '—'}</td>
                    <td className="p-3 text-white/60 truncate">{c.email || '—'}</td>
                    <td className="p-3 text-right">{c.total_submissions}</td>
                    <td className="p-3 text-right text-green-400">{c.total_approved}</td>
                    <td className="p-3 text-right text-red-400">{c.total_rejected}</td>
                    <td className="p-3 text-right text-white/60">{rate}%</td>
                    <td className="p-3 text-right">${Number(c.total_revenue_usdc).toFixed(2)}</td>
                    <td className="p-3 text-white/60">
                      {c.last_active_at
                        ? new Date(c.last_active_at).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Referrals Tab (RRG Marketing Programme partners) ─────────────────────
interface ReferralCommissionRow {
  id: string;
  date: string;
  candidate_id: string | null;
  conversion_id: string | null;
  revenue_usdc: number;
  commission_usdc: number;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  paid_at: string | null;
  tx_hash: string | null;
  notes: string | null;
}

interface RecentReferral {
  id: string;
  name: string | null;
  wallet: string | null;
  tier: string | null;
  status: string | null;
  date: string;
}

interface ReferralPartnerRow {
  id: string;
  name: string;
  wallet_address: string;
  erc8004_id: number | null;
  status: string;
  commission_bps: number;
  total_candidates: number;
  converted_candidates: number;
  total_outreach: number;
  total_conversions: number;
  total_commission_usdc: number;
  pending_usdc: number;
  approved_usdc: number;
  paid_usdc: number;
  rejected_usdc: number;
  commission_count: number;
  created_at: string;
  updated_at: string;
  commissions: ReferralCommissionRow[];
  recent_referrals: RecentReferral[];
}

interface ReferralTotals {
  partner_count: number;
  total_referrals: number;
  converted_referrals: number;
  pending_usdc: number;
  approved_usdc: number;
  paid_usdc: number;
}

function ReferralsTab() {
  const [partners, setPartners] = useState<ReferralPartnerRow[]>([]);
  const [totals,   setTotals]   = useState<ReferralTotals | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [openId,   setOpenId]   = useState<string | null>(null);
  const [acting,   setActing]   = useState<string | null>(null);
  const [msg,      setMsg]      = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/rrg/admin/referrals');
    const data = await res.json();
    setPartners(data.partners || []);
    setTotals(data.totals || null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateCommission = async (commissionId: string, action: 'approve' | 'mark_paid' | 'reject' | 'reset', txHash?: string) => {
    setActing(commissionId);
    setMsg('');
    const res = await fetch('/api/rrg/admin/referrals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commission_id: commissionId, action, tx_hash: txHash || null }),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg(`Commission ${action.replace('_', ' ')} ✓`);
      load();
    } else {
      setMsg(`Error: ${data.error}`);
    }
    setActing(null);
  };

  const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-mono uppercase tracking-widest text-white/60">Referral / Marketing Partners</h2>
        <a
          href="/admin/rrg/marketing"
          className="text-xs font-mono text-white/50 hover:text-white"
        >
          Full pipeline view &rarr;
        </a>
      </div>

      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="border border-white/10 rounded p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-white/40 mb-1">Partners</div>
            <div className="text-xl">{totals.partner_count}</div>
            <div className="text-xs font-mono text-white/40 mt-1">{totals.total_referrals} referrals · {totals.converted_referrals} converted</div>
          </div>
          <div className="border border-yellow-500/20 rounded p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-yellow-400/60 mb-1">Pending</div>
            <div className="text-xl text-yellow-400">{fmtUsd(totals.pending_usdc)}</div>
          </div>
          <div className="border border-blue-500/20 rounded p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-blue-400/60 mb-1">Approved</div>
            <div className="text-xl text-blue-400">{fmtUsd(totals.approved_usdc)}</div>
          </div>
          <div className="border border-green-500/20 rounded p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-green-400/60 mb-1">Paid</div>
            <div className="text-xl text-green-400">{fmtUsd(totals.paid_usdc)}</div>
          </div>
        </div>
      )}

      {msg && <div className="mb-4 text-xs font-mono text-white/70">{msg}</div>}

      {loading ? (
        <div className="text-white/50 font-mono text-sm">Loading…</div>
      ) : partners.length === 0 ? (
        <div className="text-white/50 font-mono text-sm py-12 text-center">
          No referral partners yet. Any wallet holder (human or AI agent) can join via <code>join_marketing_program</code> on the MCP.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs font-mono uppercase tracking-wider text-white/40 border-b border-white/10">
              <tr>
                <th className="text-left py-2 pr-4">Partner</th>
                <th className="text-left py-2 pr-4">Wallet</th>
                <th className="text-left py-2 pr-4">VIA ID</th>
                <th className="text-right py-2 pr-4">Refs</th>
                <th className="text-right py-2 pr-4">Conv.</th>
                <th className="text-right py-2 pr-4">Pending</th>
                <th className="text-right py-2 pr-4">Paid</th>
                <th className="text-left py-2 pr-2">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {partners.map(p => (
                <Fragment key={p.id}>
                  <tr className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 pr-4">{p.name}</td>
                    <td className="py-2 pr-4"><CopyWallet address={p.wallet_address} /></td>
                    <td className="py-2 pr-4 font-mono text-xs text-white/50">{p.erc8004_id ? `#${p.erc8004_id}` : '—'}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.total_candidates}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.converted_candidates}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-yellow-400">{fmtUsd(p.pending_usdc)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-green-400">{fmtUsd(p.paid_usdc)}</td>
                    <td className="py-2 pr-2 font-mono text-xs">
                      <span className={p.status === 'active' ? 'text-green-400' : p.status === 'paused' ? 'text-yellow-400' : 'text-red-400'}>{p.status}</span>
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <button
                        onClick={() => setOpenId(openId === p.id ? null : p.id)}
                        className="text-xs font-mono text-white/50 hover:text-white"
                      >
                        {openId === p.id ? '▾' : '▸'} {p.commission_count}
                      </button>
                    </td>
                  </tr>
                  {openId === p.id && (
                    <tr>
                      <td colSpan={9} className="bg-white/5 py-3 px-4">
                        {p.recent_referrals.length > 0 && (
                          <div className="mb-4">
                            <div className="text-xs font-mono uppercase tracking-wider text-white/40 mb-2">Recent Referrals</div>
                            <div className="flex flex-wrap gap-2">
                              {p.recent_referrals.map(r => (
                                <div key={r.id} className="text-xs font-mono border border-white/10 rounded px-2 py-1">
                                  <span className="text-white/80">{r.name ?? '—'}</span>
                                  {r.wallet && <span className="text-white/40 ml-2">{r.wallet.slice(0, 6)}…{r.wallet.slice(-4)}</span>}
                                  <span className={`ml-2 ${r.status === 'converted' ? 'text-green-400' : 'text-white/50'}`}>{r.status}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {p.commissions.length === 0 ? (
                          <div className="text-xs font-mono text-white/40">No commissions yet.</div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead className="text-white/40 font-mono uppercase">
                              <tr>
                                <th className="text-left py-1 pr-3">Date</th>
                                <th className="text-left py-1 pr-3">Candidate</th>
                                <th className="text-right py-1 pr-3">Platform $</th>
                                <th className="text-right py-1 pr-3">Commission $</th>
                                <th className="text-left py-1 pr-3">Status</th>
                                <th className="text-left py-1 pr-3">Tx</th>
                                <th className="text-right py-1">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.commissions.map(c => (
                                <tr key={c.id} className="border-t border-white/10">
                                  <td className="py-1 pr-3 font-mono text-white/70">{fmtDate(c.date)}</td>
                                  <td className="py-1 pr-3 font-mono text-white/50">{c.candidate_id ? c.candidate_id.slice(0, 8) + '…' : '—'}</td>
                                  <td className="py-1 pr-3 text-right tabular-nums">{fmtUsd(c.revenue_usdc)}</td>
                                  <td className="py-1 pr-3 text-right tabular-nums">{fmtUsd(c.commission_usdc)}</td>
                                  <td className="py-1 pr-3 font-mono">
                                    <span className={
                                      c.status === 'paid'     ? 'text-green-400' :
                                      c.status === 'approved' ? 'text-blue-400'  :
                                      c.status === 'rejected' ? 'text-red-400'   :
                                                                'text-yellow-400'
                                    }>{c.status}</span>
                                  </td>
                                  <td className="py-1 pr-3">
                                    {c.tx_hash ? (
                                      <a href={`https://basescan.org/tx/${c.tx_hash}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline font-mono">
                                        {c.tx_hash.slice(0, 8)}…
                                      </a>
                                    ) : '—'}
                                  </td>
                                  <td className="py-1 text-right">
                                    <div className="flex gap-1 justify-end">
                                      {c.status === 'pending' && (
                                        <>
                                          <button
                                            disabled={acting === c.id}
                                            onClick={() => updateCommission(c.id, 'approve')}
                                            className="px-2 py-0.5 text-xs border border-blue-500/40 text-blue-400 rounded hover:bg-blue-500/10 disabled:opacity-50"
                                          >Approve</button>
                                          <button
                                            disabled={acting === c.id}
                                            onClick={() => updateCommission(c.id, 'reject')}
                                            className="px-2 py-0.5 text-xs border border-red-500/40 text-red-400 rounded hover:bg-red-500/10 disabled:opacity-50"
                                          >Reject</button>
                                        </>
                                      )}
                                      {c.status === 'approved' && (
                                        <button
                                          disabled={acting === c.id}
                                          onClick={() => {
                                            const tx = window.prompt('Optional tx hash (leave blank if not yet on-chain):') || '';
                                            updateCommission(c.id, 'mark_paid', tx || undefined);
                                          }}
                                          className="px-2 py-0.5 text-xs border border-green-500/40 text-green-400 rounded hover:bg-green-500/10 disabled:opacity-50"
                                        >Mark Paid</button>
                                      )}
                                      {(c.status === 'paid' || c.status === 'rejected') && (
                                        <button
                                          disabled={acting === c.id}
                                          onClick={() => updateCommission(c.id, 'reset')}
                                          className="px-2 py-0.5 text-xs border border-white/30 text-white/60 rounded hover:bg-white/10 disabled:opacity-50"
                                        >Reset</button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Purchases Tab ──────────────────────────────────────────────────────
function PurchasesTab() {
  const [purchases, setPurchases] = useState<Record<string, unknown>[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [physical,  setPhysical]  = useState(true);
  const [acting,    setActing]    = useState<string | null>(null);
  const [msg,       setMsg]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const qs = physical ? '?physical=1' : '';
    const res = await fetch(`/api/rrg/admin/purchases${qs}`);
    const data = await res.json();
    setPurchases(data.purchases ?? []);
    setLoading(false);
  }, [physical]);

  useEffect(() => { load(); }, [load]);

  const resend = async (purchaseId: string, to: 'brand' | 'buyer' | 'both') => {
    setActing(`${purchaseId}-${to}`);
    setMsg('');
    const res = await fetch('/api/rrg/admin/purchases/resend-email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ purchaseId, to }),
    });
    const data = await res.json();
    if (res.ok) {
      const note = data.note ? ` (${data.note})` : '';
      setMsg(`Sent to: ${data.sent.join(', ')}${note} ✓`);
    } else {
      setMsg(`Error: ${data.error}`);
    }
    setActing(null);
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-mono uppercase tracking-wider">Purchases</h2>
        <div className="flex gap-4 items-center">
          <label className="flex items-center gap-2 text-xs font-mono text-white/70 cursor-pointer">
            <input type="checkbox" checked={physical} onChange={e => setPhysical(e.target.checked)} />
            Physical only
          </label>
          <button onClick={load} className="text-xs border border-white/30 px-3 py-1.5 hover:border-white transition-all">
            Refresh
          </button>
        </div>
      </div>

      {msg && (
        <div className={`mb-4 p-3 border text-sm font-mono ${msg.startsWith('Error') ? 'border-red-400/30 text-red-400' : 'border-green-400/30 text-green-400'}`}>
          {msg}
        </div>
      )}

      {loading ? (
        <div className="text-white/40 font-mono text-sm">Loading…</div>
      ) : purchases.length === 0 ? (
        <div className="text-white/40 font-mono text-sm">No purchases found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 font-mono text-xs uppercase border-b border-white/10">
                <th className="text-left py-2 pr-3">Date</th>
                <th className="text-left py-2 pr-3">Token</th>
                <th className="text-left py-2 pr-3">Title</th>
                <th className="text-left py-2 pr-3">Ship to</th>
                <th className="text-left py-2 pr-3">Buyer email</th>
                <th className="text-right py-2 pr-3">USDC</th>
                <th className="text-right py-2">Resend</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const sub = p.rrg_submissions as Record<string, unknown> | null;
                const title = (sub?.title as string) ?? '—';
                const isPhysical = Boolean(sub?.is_physical_product);
                const id = p.id as string;
                const buyerEmail = p.buyer_email as string | null;
                const shipName = p.shipping_name as string | null;
                return (
                  <tr key={id} className="border-b border-white/10 hover:bg-white/5">
                    <td className="py-2 pr-3 font-mono text-xs text-white/60">
                      {new Date(p.created_at as string).toLocaleDateString('en-GB')}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      <a href={`/rrg/drop/${p.token_id}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                        #{p.token_id as number}
                      </a>
                    </td>
                    <td className="py-2 pr-3 text-xs max-w-[160px] truncate">{title}</td>
                    <td className="py-2 pr-3 text-xs font-mono text-white/70">
                      {shipName ? `${shipName}, ${p.shipping_country as string ?? ''}` : <span className="text-white/30">—</span>}
                    </td>
                    <td className="py-2 pr-3 text-xs font-mono text-white/70">
                      {buyerEmail ?? <span className="text-white/30">none</span>}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">
                      ${parseFloat(p.amount_usdc as string).toFixed(2)}
                    </td>
                    <td className="py-2 text-right">
                      {isPhysical ? (
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => resend(id, 'brand')}
                            disabled={!!acting}
                            className="px-2 py-1 text-xs border border-white/20 hover:border-white/50 disabled:opacity-40 transition-all"
                          >
                            {acting === `${id}-brand` ? '…' : 'Brand'}
                          </button>
                          <button
                            onClick={() => resend(id, 'buyer')}
                            disabled={!!acting || !buyerEmail}
                            title={!buyerEmail ? 'No buyer email on record' : undefined}
                            className="px-2 py-1 text-xs border border-white/20 hover:border-white/50 disabled:opacity-40 transition-all"
                          >
                            {acting === `${id}-buyer` ? '…' : 'Buyer'}
                          </button>
                          <button
                            onClick={() => resend(id, 'both')}
                            disabled={!!acting}
                            className="px-2 py-1 text-xs border border-amber-400/30 text-amber-400 hover:border-amber-400 disabled:opacity-40 transition-all"
                          >
                            {acting === `${id}-both` ? '…' : 'Both'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-white/20 text-xs">digital</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
