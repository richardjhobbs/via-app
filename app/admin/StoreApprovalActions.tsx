'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Approve / reject controls for one pending agent-registered store. Posts to
 * /api/admin/store-approvals with the admin cookie, then refreshes the page so
 * the row drops out of the queue and (on approval) appears in the live list.
 */
export function StoreApprovalActions({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: 'approve' | 'reject') {
    setError(null);
    let reason = '';
    if (decision === 'reject') {
      reason = window.prompt('Reason for rejecting this store (shown to the agent):') ?? '';
      if (!reason.trim()) return; // cancelled or empty
    }
    setBusy(decision);
    try {
      const res = await fetch('/api/admin/store-approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, decision, reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Request failed');
        setBusy(null);
        return;
      }
      if (decision === 'approve' && json.mint_error) {
        setError(`Approved, but the ERC-8004 mint failed: ${json.mint_error}. Retry the mint from the store page.`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          onClick={() => submit('approve')}
          disabled={busy !== null}
          className="px-3 py-1 text-[11px] font-mono uppercase tracking-widest rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          onClick={() => submit('reject')}
          disabled={busy !== null}
          className="px-3 py-1 text-[11px] font-mono uppercase tracking-widest rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
      {error && <p className="text-[11px] text-red-700 max-w-xs text-right">{error}</p>}
    </div>
  );
}
