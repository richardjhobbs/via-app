/**
 * One-click email unsubscribe for notification-class mail.
 *
 * POST (RFC 8058 one-click, fired by the mail client's unsubscribe button, or
 * by the confirm form below): verifies the HMAC token, adds the address to
 * app_email_suppressions, done. GET (human clicked the footer link): shows a
 * one-button confirm page rather than unsubscribing on the spot, so corporate
 * link scanners that prefetch URLs cannot unsubscribe people by accident.
 */
import { NextRequest, NextResponse } from 'next/server';
import { emailFromUnsubscribeToken, suppressEmail } from '@/lib/app/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 60px 20px; }
  .wrap { max-width: 480px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-style: italic; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; padding: 32px; }
  h1 { margin: 0 0 16px; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 400; font-style: italic; }
  p { margin: 0 0 16px; line-height: 1.6; font-size: 14px; color: #3a342d; }
  button { background: #1a1612; color: #faf7f2; border: none; padding: 12px 22px; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; cursor: pointer; }
</style></head>
<body><div class="wrap"><p class="wordmark">VIA</p><div class="card"><h1>${title}</h1>${body}</div></div></body>
</html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const email = emailFromUnsubscribeToken(token);
  if (!email) {
    return page('Link not valid', '<p>This unsubscribe link is not valid. If you still want to stop these emails, reply to any of them and we will remove you.</p>', 400);
  }
  if (req.nextUrl.searchParams.get('done') === '1') {
    return page('You are unsubscribed', `<p>${email} will no longer receive notification emails from VIA. Purchase receipts are not affected.</p>`);
  }
  return page(
    'Unsubscribe',
    `<p>Stop VIA notification emails (Back Room digests, room notices and invitations) to ${email}? Purchase receipts are not affected.</p>
     <form method="post" action="/api/email/unsubscribe?token=${token}"><button type="submit">Unsubscribe</button></form>`,
  );
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const email = emailFromUnsubscribeToken(token);
  if (!email) return NextResponse.json({ error: 'invalid token' }, { status: 400 });

  await suppressEmail(email);

  // Mail-client one-click posts want a plain 200; the confirm form wants the
  // confirmation page. The form posts as application/x-www-form-urlencoded too,
  // so distinguish by the RFC 8058 body the mail client sends.
  const body = await req.text().catch(() => '');
  if (body.includes('List-Unsubscribe=One-Click')) {
    return NextResponse.json({ status: 'ok' });
  }
  return NextResponse.redirect(`${req.nextUrl.origin}/api/email/unsubscribe?token=${token}&done=1`, 303);
}
