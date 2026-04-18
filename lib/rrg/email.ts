/**
 * RRG email helpers
 *
 * Two types of email:
 * 1. Approval notification — creator notified when their design goes live
 * 2. File delivery — buyer receives download link after mint
 */

const RESEND_URL = 'https://api.resend.com/emails';
const FROM       = process.env.FROM_EMAIL ?? 'deliver@realrealgenuine.com';
const SITE_URL   = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com';

async function sendEmail(payload: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, ...payload }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend error ${res.status}: ${text}`);
  }
}

// ── 1. Approval notification ───────────────────────────────────────────

export async function sendApprovalNotification({
  to,
  title,
  tokenId,
  priceUsdc,
  editionSize,
  creatorWallet,
}: {
  to: string;
  title: string;
  tokenId: number;
  priceUsdc: number;
  editionSize: number;
  creatorWallet: string;
}): Promise<void> {
  const dropUrl = `${SITE_URL}/rrg/drop/${tokenId}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
  .card { max-width: 520px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 12px; overflow: hidden; }
  .header { background: #d4ff22; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; color: #0a0a0a; font-weight: 700; }
  .body { padding: 28px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #ccc; font-size: 14px; }
  .meta { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 20px 0; }
  .meta-row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; font-size: 13px; border-bottom: 1px solid #222; }
  .meta-row:last-child { border-bottom: none; }
  .meta-label { color: #888; min-width: 110px; }
  .meta-value { color: #e5e5e5; font-weight: 500; }
  .btn { display: inline-block; background: #d4ff22; color: #0a0a0a; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; margin-top: 8px; }
  .footer { padding: 20px 28px; border-top: 1px solid #1a1a1a; font-size: 12px; color: #555; }
  .wallet { font-family: monospace; font-size: 12px; color: #7c3aed; word-break: break-all; }
</style></head>
<body>
<div class="card">
  <div class="header"><h1>Your creation is live on RRG</h1></div>
  <div class="body">
    <p>Your submission <strong style="color:#e5e5e5">"${escHtml(title)}"</strong> has been approved and is now live.</p>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Price:</span><span class="meta-value">${priceUsdc.toFixed(2)} USDC</span></div>
      <div class="meta-row"><span class="meta-label">Edition:</span><span class="meta-value">${editionSize} pieces</span></div>
      <div class="meta-row"><span class="meta-label">Your share:</span><span class="meta-value">70% per sale</span></div>
      <div class="meta-row"><span class="meta-label">Revenue wallet:</span><span class="wallet">${creatorWallet}</span></div>
    </div>
    <p>Sales revenue (70%) is sent automatically to your wallet with no further steps from you.</p>
    <p>Share the link below — every sale goes straight to your wallet.</p>
    <a class="btn" href="${dropUrl}">View your drop →</a>
  </div>
  <div class="footer"><a href="${SITE_URL}/rrg" style="color:#e5e5e5; text-decoration:none">Browse all drops</a></div>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `Your creation is live on RRG — "${title}"`,
    html,
  });
}

// ── 2. File delivery ───────────────────────────────────────────────────

export async function sendFileDeliveryEmail({
  to,
  title,
  tokenId,
  txHash,
  downloadUrl,
  ipfsMetadataUrl,
  voucher,
}: {
  to: string;
  title: string;
  tokenId: number;
  txHash: string;
  downloadUrl: string;
  ipfsMetadataUrl?: string | null;
  voucher?: { code: string; offer: string; brand_url: string | null; terms: string | null; expires_at: string } | null;
}): Promise<void> {
  const scanBase    = 'https://basescan.org';
  const dropUrl     = `${SITE_URL}/rrg/drop/${tokenId}`;
  const basescanUrl = `${scanBase}/tx/${txHash}`;
  const shortTx     = txHash; // full hash so the link is unambiguous

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
  .card { max-width: 520px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 12px; overflow: hidden; }
  .header { background: #7c3aed; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; color: #fff; font-weight: 700; }
  .body { padding: 28px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #ccc; font-size: 14px; }
  .btn { display: inline-block; background: #d4ff22; color: #0a0a0a; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; margin: 8px 0; }
  .tx { font-family: monospace; font-size: 12px; color: #7c3aed; }
  .note { font-size: 12px; color: #555; margin-top: 12px; }
  .footer { padding: 20px 28px; border-top: 1px solid #1a1a1a; font-size: 12px; color: #555; }
</style></head>
<body>
<div class="card">
  <div class="header"><h1>Your RRG drop is ready</h1></div>
  <div class="body">
    <p>Thanks for purchasing <strong style="color:#e5e5e5">"${escHtml(title)}"</strong>. Your files are ready to download.</p>
    <p><a class="btn" href="${downloadUrl}">Download your files →</a></p>
    <p class="note">⚠️ This link expires in 24 hours. Download and save your files now.</p>
    <p>On-chain receipt: <a href="${basescanUrl}" class="tx">${shortTx}</a></p>
    <p><a href="${dropUrl}" style="color:#7c3aed; text-decoration:none; font-size:13px">View drop page →</a></p>
    ${ipfsMetadataUrl ? `<p><a href="${ipfsMetadataUrl}" style="color:#7c3aed; text-decoration:none; font-size:13px">View metadata on IPFS →</a></p>` : ''}
    ${voucher ? `
    <div style="background:#052e16; border:1px solid rgba(16,185,129,0.3); border-radius:8px; padding:16px; margin:20px 0;">
      <p style="color:#10b981; font-size:12px; text-transform:uppercase; letter-spacing:1px; margin:0 0 8px; font-weight:700">Your Voucher</p>
      <p style="color:#e5e5e5; font-size:16px; font-weight:600; margin:0 0 4px">${escHtml(voucher.offer)}</p>
      <p style="color:#fff; font-size:22px; font-family:monospace; letter-spacing:3px; margin:0 0 8px">${escHtml(voucher.code)}</p>
      ${voucher.brand_url ? `<p style="color:#ccc; font-size:13px; margin:0 0 4px">Redeem at: <a href="${voucher.brand_url}" style="color:#10b981">${escHtml(voucher.brand_url)}</a></p>` : ''}
      ${voucher.terms ? `<p style="color:#888; font-size:12px; margin:0 0 4px">${escHtml(voucher.terms)}</p>` : ''}
      <p style="color:#888; font-size:12px; margin:0">Valid until ${new Date(voucher.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </div>` : ''}
  </div>
  <div class="footer"><a href="${SITE_URL}/rrg" style="color:#e5e5e5; text-decoration:none">Browse all drops</a></div>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `Your RRG drop is ready — "${title}"`,
    html,
  });
}

// ── 3. Rejection notification ─────────────────────────────────────────

export async function sendRejectionNotification({
  to,
  title,
  reason,
}: {
  to: string;
  title: string;
  reason?: string | null;
}): Promise<void> {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
  .card { max-width: 520px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 12px; overflow: hidden; }
  .header { background: #555; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; color: #fff; font-weight: 700; }
  .body { padding: 28px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #ccc; font-size: 14px; }
  .reason { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 20px 0; }
  .reason-label { color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .reason-text { color: #e5e5e5; font-size: 14px; line-height: 1.6; }
  .btn { display: inline-block; background: #d4ff22; color: #0a0a0a; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; margin-top: 8px; }
  .footer { padding: 20px 28px; border-top: 1px solid #1a1a1a; font-size: 12px; color: #555; }
</style></head>
<body>
<div class="card">
  <div class="header"><h1>Update on your submission</h1></div>
  <div class="body">
    <p>Thanks for submitting <strong style="color:#e5e5e5">"${escHtml(title)}"</strong> to RRG.</p>
    <p>After review, we weren't able to accept this submission for our current collection.</p>
    ${reason ? `
    <div class="reason">
      <div class="reason-label">Feedback</div>
      <div class="reason-text">${escHtml(reason)}</div>
    </div>` : ''}
    <p>We encourage you to refine and resubmit — we'd love to see more of your work.</p>
    <a class="btn" href="${SITE_URL}/rrg/submit">Submit again →</a>
  </div>
  <div class="footer"><a href="${SITE_URL}/rrg" style="color:#e5e5e5; text-decoration:none">Browse all drops</a></div>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `Update on your RRG submission — "${title}"`,
    html,
  });
}

// ── 4. Physical product purchase notifications ──────────────────────────

interface PhysicalPurchaseEmailData {
  title: string;
  tokenId: number;
  txHash: string;
  buyerEmail: string | null;
  brandContactEmail: string;
  brandName: string;
  shippingName: string;
  shippingAddress: string;   // pre-formatted multi-line
  shippingPhone: string | null;
  shippingType: string | null;
  downloadUrl: string;
  ipfsMetadataUrl?: string | null;
  /** Selected size for garment products (null for non-garment) */
  selectedSize?: string | null;
}

/** Send to brand: new physical product order with buyer shipping address */
export async function sendPhysicalOrderToBrand(data: PhysicalPurchaseEmailData): Promise<void> {
  const scanBase = 'https://basescan.org';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
  .card { max-width: 520px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 12px; overflow: hidden; }
  .header { background: #65a30d; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; color: #fff; font-weight: 700; }
  .body { padding: 28px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #ccc; font-size: 14px; }
  .meta { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 20px 0; }
  .meta-row { padding: 6px 0; font-size: 13px; border-bottom: 1px solid #222; }
  .meta-row:last-child { border-bottom: none; }
  .meta-label { color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta-value { color: #e5e5e5; font-weight: 500; margin-top: 4px; }
  .address { white-space: pre-line; font-family: monospace; font-size: 13px; color: #e5e5e5; }
  .footer { padding: 20px 28px; border-top: 1px solid #1a1a1a; font-size: 12px; color: #555; }
</style></head>
<body>
<div class="card">
  <div class="header"><h1>New physical product order</h1></div>
  <div class="body">
    <p>A buyer has purchased <strong style="color:#e5e5e5">"${escHtml(data.title)}"</strong> (Token #${data.tokenId}).</p>
    <p>This product includes a physical item. Please arrange shipping.</p>
    <div class="meta">
      ${data.selectedSize ? `<div class="meta-row"><div class="meta-label">Size</div><div class="meta-value" style="font-size:18px; color:#d4ff22; font-weight:700">${escHtml(data.selectedSize)}</div></div>` : ''}
      <div class="meta-row">
        <div class="meta-label">Ship To</div>
        <div class="meta-value address">${escHtml(data.shippingName)}
${escHtml(data.shippingAddress)}</div>
      </div>
      ${data.shippingPhone ? `<div class="meta-row"><div class="meta-label">Phone</div><div class="meta-value">${escHtml(data.shippingPhone)}</div></div>` : ''}
      ${data.buyerEmail ? `<div class="meta-row"><div class="meta-label">Buyer Email</div><div class="meta-value">${escHtml(data.buyerEmail)}</div></div>` : ''}
      <div class="meta-row">
        <div class="meta-label">Transaction</div>
        <div class="meta-value"><a href="${scanBase}/tx/${data.txHash}" style="color:#65a30d; font-family:monospace; font-size:12px">${data.txHash.slice(0, 20)}…</a></div>
      </div>
    </div>
    <p>Please arrange delivery to the address above.</p>
  </div>
  <div class="footer">RRG — Real Real Genuine</div>
</div>
</body>
</html>`;

  await sendEmail({
    to: data.brandContactEmail,
    subject: `New physical product order — "${data.title}"`,
    html,
  });
}

/** Send to buyer: purchase confirmation with shipping address + physical product info */
export async function sendPhysicalPurchaseToBuyer(data: PhysicalPurchaseEmailData): Promise<void> {
  const scanBase = 'https://basescan.org';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
  .card { max-width: 520px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 12px; overflow: hidden; }
  .header { background: #7c3aed; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; color: #fff; font-weight: 700; }
  .body { padding: 28px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #ccc; font-size: 14px; }
  .btn { display: inline-block; background: #d4ff22; color: #0a0a0a; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; margin: 8px 0; }
  .meta { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 20px 0; }
  .meta-row { padding: 6px 0; font-size: 13px; border-bottom: 1px solid #222; }
  .meta-row:last-child { border-bottom: none; }
  .meta-label { color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta-value { color: #e5e5e5; font-weight: 500; margin-top: 4px; }
  .address { white-space: pre-line; font-family: monospace; font-size: 13px; color: #e5e5e5; }
  .physical { background: #1a2e05; border: 1px solid #65a30d33; border-radius: 8px; padding: 16px; margin: 20px 0; }
  .physical-title { color: #65a30d; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; font-weight: 700; }
  .footer { padding: 20px 28px; border-top: 1px solid #1a1a1a; font-size: 12px; color: #555; }
</style></head>
<body>
<div class="card">
  <div class="header"><h1>Your RRG drop is ready</h1></div>
  <div class="body">
    <p>Thanks for purchasing <strong style="color:#e5e5e5">"${escHtml(data.title)}"</strong>. Your digital files are ready to download.</p>
    <p><a class="btn" href="${data.downloadUrl}">Download your files →</a></p>
    <p style="font-size:12px;color:#555">⚠️ This link expires in 24 hours.</p>

    <div class="physical">
      <div class="physical-title">Physical Product</div>
      <p style="margin:0 0 8px;font-size:13px;color:#ccc">This purchase includes a physical product from <strong>${escHtml(data.brandName)}</strong>.</p>
      <p style="margin:0;font-size:13px;color:#ccc">The brand will arrange delivery to the address provided.</p>
    </div>

    <div class="meta">
      ${data.selectedSize ? `<div class="meta-row"><div class="meta-label">Size</div><div class="meta-value" style="font-size:16px; color:#d4ff22; font-weight:700">${escHtml(data.selectedSize)}</div></div>` : ''}
      <div class="meta-row">
        <div class="meta-label">Shipping To</div>
        <div class="meta-value address">${escHtml(data.shippingName)}
${escHtml(data.shippingAddress)}</div>
      </div>
      <div class="meta-row">
        <div class="meta-label">Brand Contact</div>
        <div class="meta-value"><a href="mailto:${escHtml(data.brandContactEmail)}" style="color:#7c3aed">${escHtml(data.brandContactEmail)}</a></div>
      </div>
    </div>

    <p style="font-size:13px">On-chain receipt: <a href="${scanBase}/tx/${data.txHash}" style="color:#7c3aed; font-family:monospace; font-size:12px">${data.txHash.slice(0, 20)}…</a></p>
    ${data.ipfsMetadataUrl ? `<p><a href="${data.ipfsMetadataUrl}" style="color:#7c3aed; text-decoration:none; font-size:13px">View metadata on IPFS →</a></p>` : ''}
  </div>
  <div class="footer"><a href="${SITE_URL}/rrg" style="color:#e5e5e5; text-decoration:none">Browse all drops</a></div>
</div>
</body>
</html>`;

  if (!data.buyerEmail) return; // can't send without email

  await sendEmail({
    to: data.buyerEmail,
    subject: `Your RRG drop is ready — "${data.title}" (includes physical product)`,
    html,
  });
}

// ── 5. Brand approval notification ────────────────────────────────────

export async function sendBrandApprovalEmail({
  to,
  brandName,
  brandSlug,
}: {
  to: string;
  brandName: string;
  brandSlug: string;
}): Promise<void> {
  const dashboardUrl = `${SITE_URL}/brand/${brandSlug}/admin`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
  .card { max-width: 520px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 12px; overflow: hidden; }
  .header { background: #d4ff22; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; color: #0a0a0a; font-weight: 700; }
  .body { padding: 28px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #ccc; font-size: 14px; }
  .btn { display: inline-block; background: #d4ff22; color: #0a0a0a; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; margin-top: 8px; }
  .footer { padding: 20px 28px; border-top: 1px solid #1a1a1a; font-size: 12px; color: #555; }
</style></head>
<body>
<div class="card">
  <div class="header"><h1>Welcome to RRG, ${escHtml(brandName)}</h1></div>
  <div class="body">
    <p>Your brand partner application has been approved. You now have full access to your brand dashboard.</p>
    <p>From your dashboard you can:</p>
    <p style="color:#e5e5e5">• Submit products for the RRG collection<br>• Track sales and revenue<br>• Manage your brand profile</p>
    <a class="btn" href="${dashboardUrl}">Go to your dashboard →</a>
  </div>
  <div class="footer">RRG — Real Real Genuine</div>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `Your brand "${brandName}" is approved — welcome to RRG`,
    html,
  });
}

// ── 6. Outreach owner notification ─────────────────────────────────────

export async function sendOutreachOwnerEmail({
  to,
  agentName,
  agentId,
  channel,
}: {
  to: string;
  agentName: string;
  agentId: number | null;
  channel: string;
}): Promise<void> {
  const idStr = agentId ? ` (#${agentId})` : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 40px 20px; }
  .card { max-width: 520px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 12px; overflow: hidden; }
  .header { background: #d4ff22; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; color: #0a0a0a; font-weight: 700; }
  .body { padding: 28px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #ccc; font-size: 14px; }
  .actions { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 20px 0; }
  .actions p { margin: 0 0 8px; font-size: 13px; color: #e5e5e5; }
  .btn { display: inline-block; background: #d4ff22; color: #0a0a0a; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; margin-top: 8px; }
  .footer { padding: 20px 28px; border-top: 1px solid #1a1a1a; font-size: 12px; color: #555; }
</style></head>
<body>
<div class="card">
  <div class="header"><h1>Your agent received a collaboration request</h1></div>
  <div class="body">
    <p>Your ERC-8004 agent <strong style="color:#e5e5e5">"${escHtml(agentName)}"</strong>${idStr} was contacted by the RRG platform agent (#33313) via ${escHtml(channel.toUpperCase())}.</p>
    <p>RRG is an agent-native design and commerce platform on Base where AI agents can browse and purchase fashion drops, submit designs to brand briefs, and launch their own brands — all using USDC with on-chain ERC-8004 reputation.</p>
    <div class="actions">
      <p>What your agent can do on RRG:</p>
      <p>- Browse and purchase limited edition drops (gasless USDC)</p>
      <p>- Submit original designs to open brand briefs (earn 35% on every sale)</p>
      <p>- Register and launch its own brand with automatic USDC payouts</p>
    </div>
    <a class="btn" href="https://realrealgenuine.com/mcp">Connect your agent</a>
    <p style="margin-top: 16px; font-size: 13px;">RRG is a product of <a href="https://www.getvia.xyz/mcp" style="color:#d4ff22; text-decoration:none">VIA Labs</a>.</p>
  </div>
  <div class="footer">RRG Platform Agent (#33313) | <a href="https://realrealgenuine.com" style="color:#e5e5e5; text-decoration:none">realrealgenuine.com</a></div>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `Your agent "${agentName}" received a collaboration request from RRG`,
    html,
  });
}

// ── HTML escape helper ─────────────────────────────────────────────────
function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
