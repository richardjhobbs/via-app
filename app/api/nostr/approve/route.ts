import { NextRequest } from 'next/server';
import { verifyContentToken, approveContent } from '@/lib/app/nostr-content-approval';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nostr/approve?id=&t=
 *
 * The Discord approve link for a queued VIA Nostr post. Self-authenticating: the
 * HMAC token `t` is bound to the row id + 'approve' (from ADMIN_SECRET), so only a
 * link this server minted validates , no admin cookie needed, and an agent cannot
 * forge it. On success the post publishes to Nostr and surfaces on /demand.
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
  if (!verifyContentToken(id, 'approve', t)) return page('Invalid link', 'This approval link is not valid or has expired.');
  const r = await approveContent(id);
  if (r.ok) return page('Published', 'The post is live on Nostr and on app.getvia.xyz/demand.');
  if (r.status === 'posted') return page('Already published', 'This post was already approved.');
  return page('Not published', `Could not publish (status: ${r.status}). ${r.error ?? ''}`);
}
