import { NextRequest, NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/app/auth';
import { approveContent, rejectContent } from '@/lib/app/nostr-content-approval';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/nostr-content/[id]   (form-encoded: action=approve|reject)
 *
 * Admin-page fallback for the Discord approve card. Same shared logic
 * (approveContent / rejectContent in lib/app/nostr-content-approval): approve
 * publishes the queued post to Nostr (it then surfaces on /demand) and edits the
 * Discord card; reject discards it. Admin-cookie gated.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminFromCookies())) {
    return NextResponse.redirect(new URL('/admin/login?next=/admin/nostr', req.url), 303);
  }
  const { id } = await params;
  const form = await req.formData();
  const action = String(form.get('action') ?? '');

  if (action === 'reject') {
    await rejectContent(id);
    return NextResponse.redirect(new URL('/admin/nostr', req.url), 303);
  }
  if (action === 'approve') {
    const r = await approveContent(id);
    const url = r.ok ? '/admin/nostr' : '/admin/nostr?error=publish-failed';
    return NextResponse.redirect(new URL(url, req.url), 303);
  }
  return NextResponse.redirect(new URL('/admin/nostr', req.url), 303);
}
