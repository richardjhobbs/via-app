import { NextRequest } from 'next/server';
import { verifyContentToken, rejectContent } from '@/lib/app/nostr-content-approval';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nostr/reject?id=&t=
 *
 * The Discord reject link for a queued VIA Nostr post. HMAC-bound to the row id +
 * 'reject' (from ADMIN_SECRET), same self-authenticating scheme as approve. Marks
 * the draft rejected; nothing is published.
 */
function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<body style="font-family:system-ui;max-width:520px;margin:64px auto;padding:0 20px;color:#1a1612;line-height:1.5">`
    + `<h2 style="font-weight:600">${title}</h2><p>${body}</p></body>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const t = req.nextUrl.searchParams.get('t');
  if (!verifyContentToken(id, 'reject', t)) return page('Invalid link', 'This link is not valid or has expired.');
  const r = await rejectContent(id);
  if (r.ok) return page('Rejected', 'The draft was rejected. Nothing was published.');
  return page('No change', `Could not reject (status: ${r.status}). ${r.error ?? ''}`);
}
