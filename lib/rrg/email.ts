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
    <p>Share the link below. Every sale goes straight to your wallet.</p>
    <a class="btn" href="${dropUrl}">View your listing →</a>
  </div>
  <div class="footer"><a href="${SITE_URL}/rrg" style="color:#e5e5e5; text-decoration:none">Browse all listings</a></div>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `Your creation is live on RRG: "${title}"`,
    html,
  });
}

// ── 2. File delivery (digital-only purchases) ─────────────────────────
//
// Single buyer email per purchase. Uses the branded RRG template that
// matches sendPhysicalPurchaseToBuyer, minus the shipping block.
// The previous purple "Your RRG listing is ready" template is retired.

export async function sendFileDeliveryEmail({
  to,
  title,
  tokenId,
  txHash,
  downloadUrl,
  ipfsMetadataUrl,
  voucher,
  brandName,
  imageUrl,
  priceUsdc,
}: {
  to: string;
  title: string;
  tokenId: number;
  txHash: string;
  downloadUrl: string;
  ipfsMetadataUrl?: string | null;
  voucher?: { code: string; offer: string; brand_url: string | null; terms: string | null; expires_at: string } | null;
  brandName?: string | null;
  imageUrl?: string | null;
  priceUsdc?: number | null;
}): Promise<void> {
  const scanBase  = 'https://basescan.org';
  const rowStyle  = 'padding:10px 16px;font-size:13px;border-bottom:1px solid #e8e3db;';
  const lblStyle  = 'color:#6e665c;font-size:13px;white-space:nowrap;padding-right:16px;';
  const valStyle  = 'color:#1a1612;font-weight:500;text-align:right;font-size:13px;';
  const monoStyle = "font-family:'Courier New',Courier,monospace;font-size:11px;";
  const dropUrl   = `${SITE_URL}/rrg/drop/${tokenId}`;

  const mkRow = (label: string, valueHtml: string, last = false) =>
    `<tr><td style="${rowStyle}${last ? 'border-bottom:none;' : ''}${lblStyle}">${label}</td><td style="${rowStyle}${last ? 'border-bottom:none;' : ''}${valStyle}">${valueHtml}</td></tr>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; letter-spacing: 0.01em; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #2b9a66; margin: 0 0 8px; }
  h1 { margin: 0 0 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; letter-spacing: -0.01em; }
  .brand-sub { font-size: 13px; color: #6e665c; margin: 0; }
  .product-img { width: 100%; display: block; height: auto; border-bottom: 1px solid #e8e3db; }
  .body { padding: 28px 32px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .download-minimal { text-align: center; padding: 20px 32px; border-top: 1px solid #e8e3db; }
  .download-minimal a { font-family: 'Courier New', Courier, monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #6b4f3a; text-decoration: none; }
  .download-minimal p { font-family: 'Courier New', Courier, monospace; font-size: 10px; color: #6e665c; margin: 6px 0 0; letter-spacing: 0.06em; text-transform: uppercase; }
  .voucher { border: 2px solid #2b9a66; background: #f4faf6; padding: 20px 24px; margin: 0 0 24px; }
  .voucher .v-label { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #2b9a66; margin: 0 0 8px; }
  .voucher .v-offer { font-family: Georgia, 'Times New Roman', serif; font-size: 16px; font-style: italic; color: #1a1612; margin: 0 0 8px; }
  .voucher .v-code { font-family: 'Courier New', Courier, monospace; font-size: 18px; letter-spacing: 0.18em; color: #1a1612; margin: 0 0 8px; }
  .voucher .v-meta { font-size: 12px; color: #6e665c; margin: 0; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">Real Real Genuine</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Thank you for your order</p>
      <h1>${escHtml(title)}</h1>
      ${brandName ? `<p class="brand-sub">${escHtml(brandName)}</p>` : ''}
    </div>

    ${imageUrl ? `<img class="product-img" src="${imageUrl}" alt="${escHtml(title)}" />` : ''}

    <div class="body">
      <p class="lbl">Purchase details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3db;margin:0 0 24px;border-collapse:collapse;"><tbody>
        ${priceUsdc != null ? mkRow('Paid', `<span style="color:#6b4f3a;font-weight:600;font-size:15px;">$${priceUsdc.toFixed(2)} USDC</span>`) : ''}
        ${mkRow('On-chain tx', `<a href="${scanBase}/tx/${txHash}" style="color:#6b4f3a;${monoStyle}">${txHash.slice(0, 14)}&hellip;${txHash.slice(-6)}</a>`, !ipfsMetadataUrl && !voucher)}
        ${ipfsMetadataUrl ? mkRow('IPFS record', `<a href="${ipfsMetadataUrl}" style="color:#6b4f3a;font-size:12px;">View &rarr;</a>`, !voucher) : ''}
        ${mkRow('Listing', `<a href="${dropUrl}" style="color:#6b4f3a;font-size:12px;">View &rarr;</a>`, true)}
      </tbody></table>

      ${voucher ? `
      <div class="voucher">
        <p class="v-label">Your voucher</p>
        <p class="v-offer">${escHtml(voucher.offer)}</p>
        <p class="v-code">${escHtml(voucher.code)}</p>
        ${voucher.brand_url ? `<p class="v-meta">Redeem at <a href="${voucher.brand_url}" style="color:#2b9a66;">${escHtml(voucher.brand_url)}</a></p>` : ''}
        ${voucher.terms ? `<p class="v-meta">${escHtml(voucher.terms)}</p>` : ''}
        <p class="v-meta">Valid until ${new Date(voucher.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>` : ''}
    </div>

    <div class="download-minimal">
      <a href="${downloadUrl}">Download digital files &rarr;</a>
      <p>Link expires in 24 hours</p>
    </div>
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">RRG / Real Real Genuine</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="${SITE_URL}/rrg" style="color:#6e665c;text-decoration:none;">realrealgenuine.com</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `Thank you for your order: ${title}`,
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
    <p>We encourage you to refine and resubmit. We'd love to see more of your work.</p>
    <a class="btn" href="${SITE_URL}/rrg/submit">Submit again →</a>
  </div>
  <div class="footer"><a href="${SITE_URL}/rrg" style="color:#e5e5e5; text-decoration:none">Browse all listings</a></div>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `Update on your RRG submission: "${title}"`,
    html,
  });
}

// ── 4. Physical product purchase notifications ──────────────────────────

interface PhysicalPurchaseEmailData {
  title: string;
  tokenId: number;
  /** Buyer's on-chain purchase tx hash — shown in buyer email */
  txHash: string;
  /** Brand's USDC payout tx hash — shown in seller email */
  brandPayoutTxHash?: string | null;
  buyerEmail: string | null;
  brandContactEmail: string;
  brandName: string;
  shippingName: string;
  shippingAddress: string;   // pre-formatted multi-line
  shippingPhone: string | null;
  shippingType: string | null;
  downloadUrl: string;
  ipfsMetadataUrl?: string | null;
  /** Product image signed URL for buyer email hero (optional) */
  imageUrl?: string | null;
  /** Selected size for garment products (null for non-garment) */
  selectedSize?: string | null;
  /** Price paid by buyer in USDC */
  priceUsdc?: number | null;
  /** Revenue sent to brand wallet in USDC (after platform fee) */
  brandRevenueUsdc?: number | null;
}

/** Send to brand: new physical product order with buyer shipping address */
export async function sendPhysicalOrderToBrand(data: PhysicalPurchaseEmailData): Promise<void> {
  const scanBase   = 'https://basescan.org';
  const listingUrl = `${SITE_URL}/rrg/drop/${data.tokenId}`;
  // Maison design tokens (inlined for email client compatibility)
  // bg=#faf7f2  paper=#ffffff  ink=#1a1612  ink-2=#3a342d  ink-3=#6e665c
  // accent=#6b4f3a  line=#e8e3db  line-strong=#d5cfc7  live=#2b9a66
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; letter-spacing: 0.01em; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .card-head h1 { margin: 0 0 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 400; font-style: italic; color: #1a1612; letter-spacing: -0.01em; }
  .card-head .sub { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #6e665c; margin: 0; }
  .badge { font-family: 'Courier New', Courier, monospace; font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; padding: 5px 10px; background: #6b4f3a; color: #ffffff; white-space: nowrap; flex-shrink: 0; }
  .body { padding: 28px 32px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 14px; }
  .block { border: 1px solid #e8e3db; margin: 0 0 20px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 16px; border-bottom: 1px solid #e8e3db; font-size: 13px; }
  .row:last-child { border-bottom: none; }
  .row-lbl { color: #6e665c; }
  .row-val { color: #1a1612; font-weight: 500; text-align: right; }
  .row-val-accent { color: #6b4f3a; font-weight: 600; font-size: 15px; }
  .row-val-mono { font-family: 'Courier New', Courier, monospace; font-size: 11px; }
  .address-block { padding: 14px 16px; font-family: 'Courier New', Courier, monospace; font-size: 13px; color: #1a1612; line-height: 1.7; white-space: pre-line; }
  .revenue-block { border: 1px solid #d5cfc7; background: #f7f3ee; padding: 20px 24px; margin: 0 0 20px; }
  .revenue-lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6b4f3a; margin: 0 0 8px; }
  .revenue-amount { font-family: Georgia, 'Times New Roman', serif; font-size: 36px; font-weight: 400; color: #1a1612; margin: 0 0 4px; letter-spacing: -0.02em; }
  .revenue-note { font-size: 12px; color: #6e665c; margin: 0; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
  .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #e8e3db; font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #6e665c; display: flex; justify-content: space-between; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">Real Real Genuine</p>
  <div class="card">
    <div class="card-head">
      <div>
        <h1>New order</h1>
        <p class="sub">Action required: please arrange shipping</p>
      </div>
      <span class="badge">New order</span>
    </div>
    <div class="body">

      <p class="lbl">Order details</p>
      <div class="block">
        <div class="row"><span class="row-lbl">Product</span><span class="row-val">${escHtml(data.title)}</span></div>
        <div class="row"><span class="row-lbl">Token</span><span class="row-val row-val-mono">#${data.tokenId}</span></div>
        ${data.selectedSize ? `<div class="row"><span class="row-lbl">Size</span><span class="row-val row-val-accent">${escHtml(data.selectedSize)}</span></div>` : ''}
        ${data.priceUsdc != null ? `<div class="row"><span class="row-lbl">Price paid</span><span class="row-val">$${data.priceUsdc.toFixed(2)} USDC</span></div>` : ''}
      </div>

      ${data.brandRevenueUsdc != null ? `
      <div class="revenue-block">
        <p class="revenue-lbl">Your revenue (auto-distributed)</p>
        <p class="revenue-amount">$${data.brandRevenueUsdc.toFixed(2)} USDC</p>
        <p class="revenue-note">Sent automatically to your brand wallet on Base. No action needed.</p>
      </div>` : ''}

      <p class="lbl">Ship to</p>
      <div class="block">
        <div class="address-block">${escHtml(data.shippingName)}
${escHtml(data.shippingAddress)}</div>
        ${data.shippingPhone ? `<div class="row"><span class="row-lbl">Phone</span><span class="row-val">${escHtml(data.shippingPhone)}</span></div>` : ''}
        ${data.buyerEmail ? `<div class="row"><span class="row-lbl">Buyer email</span><span class="row-val">${escHtml(data.buyerEmail)}</span></div>` : ''}
      </div>

      <p class="lbl">On-chain proof</p>
      <div class="block">
        ${data.brandPayoutTxHash ? `<div class="row"><span class="row-lbl">Your payout tx</span><span class="row-val"><a href="${scanBase}/tx/${data.brandPayoutTxHash}" style="color:#6b4f3a; font-family:'Courier New',Courier,monospace; font-size:11px">${data.brandPayoutTxHash.slice(0, 14)}…${data.brandPayoutTxHash.slice(-6)}</a></span></div>` : ''}
        <div class="row"><span class="row-lbl">Buyer purchase tx</span><span class="row-val"><a href="${scanBase}/tx/${data.txHash}" style="color:#6b4f3a; font-family:'Courier New',Courier,monospace; font-size:11px">${data.txHash.slice(0, 14)}…${data.txHash.slice(-6)}</a></span></div>
      </div>

      <p style="font-size:13px;color:#3a342d;line-height:1.6;margin:0 0 20px">Please arrange delivery to the address above. If you have any questions about this order, reply to this email.</p>
      <a class="btn" href="${listingUrl}">View listing on RRG →</a>

    </div>
  </div>
  <div class="footer">
    <span>RRG / Real Real Genuine</span>
    <a href="${SITE_URL}/rrg" style="color:#6e665c; text-decoration:none">realrealgenuine.com</a>
  </div>
</div>
</body>
</html>`;

  await sendEmail({
    to: data.brandContactEmail,
    subject: `New order: "${data.title}" (Token #${data.tokenId}) - please arrange shipping`,
    html,
  });
}

/** Send to buyer: purchase confirmation — physical product prominent, download link minimal at end */
export async function sendPhysicalPurchaseToBuyer(data: PhysicalPurchaseEmailData): Promise<void> {
  if (!data.buyerEmail) return;

  const scanBase = 'https://basescan.org';

  const rowStyle    = 'padding:10px 16px;font-size:13px;border-bottom:1px solid #e8e3db;';
  const lblStyle    = 'color:#6e665c;font-size:13px;white-space:nowrap;padding-right:16px;';
  const valStyle    = 'color:#1a1612;font-weight:500;text-align:right;font-size:13px;';
  const monoStyle   = "font-family:'Courier New',Courier,monospace;font-size:11px;";

  const mkRow = (label: string, valueHtml: string, last = false) =>
    `<tr><td style="${rowStyle}${last ? 'border-bottom:none;' : ''}${lblStyle}">${label}</td><td style="${rowStyle}${last ? 'border-bottom:none;' : ''}${valStyle}">${valueHtml}</td></tr>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; letter-spacing: 0.01em; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #2b9a66; margin: 0 0 8px; }
  h1 { margin: 0 0 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; letter-spacing: -0.01em; }
  .brand-sub { font-size: 13px; color: #6e665c; margin: 0; }
  .product-img { width: 100%; display: block; height: auto; border-bottom: 1px solid #e8e3db; }
  .body { padding: 28px 32px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .block { border: 1px solid #e8e3db; margin: 0 0 24px; width: 100%; border-collapse: collapse; }
  .address-block { padding: 14px 16px; font-family: 'Courier New', Courier, monospace; font-size: 13px; color: #1a1612; line-height: 1.7; white-space: pre-line; }
  .dispatch-box { border: 2px solid #6b4f3a; padding: 20px 24px; margin: 0 0 24px; background: #fdf9f5; }
  .dispatch-box p { margin: 0; font-size: 14px; color: #1a1612; line-height: 1.6; }
  .download-minimal { text-align: center; padding: 20px 32px; border-top: 1px solid #e8e3db; }
  .download-minimal a { font-family: 'Courier New', Courier, monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #6b4f3a; text-decoration: none; }
  .download-minimal p { font-family: 'Courier New', Courier, monospace; font-size: 10px; color: #6e665c; margin: 6px 0 0; letter-spacing: 0.06em; text-transform: uppercase; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">Real Real Genuine</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Thank you for your order</p>
      <h1>${escHtml(data.title)}</h1>
      <p class="brand-sub">${escHtml(data.brandName)}${data.selectedSize ? `, Size ${escHtml(data.selectedSize)}` : ''}</p>
    </div>

    ${data.imageUrl ? `<img class="product-img" src="${data.imageUrl}" alt="${escHtml(data.title)}" />` : ''}

    <div class="body">

      <p class="lbl">Your order</p>
      <div class="dispatch-box">
        <p>${escHtml(data.brandName)} will arrange delivery to the address below. Allow a few days for dispatch confirmation. The seller will follow up directly if they need any further details.</p>
      </div>

      <p class="lbl">Delivery address</p>
      <div style="border:1px solid #e8e3db;margin:0 0 24px;">
        <div class="address-block">${escHtml(data.shippingName)}
${escHtml(data.shippingAddress)}</div>
        ${data.shippingPhone ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e8e3db;"><tbody><tr><td style="padding:10px 16px;font-size:13px;color:#6e665c;white-space:nowrap;padding-right:16px;">Phone</td><td style="padding:10px 16px;font-size:13px;color:#1a1612;font-weight:500;text-align:right;">${escHtml(data.shippingPhone)}</td></tr></tbody></table>` : ''}
      </div>

      <p class="lbl">Purchase details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3db;margin:0 0 24px;border-collapse:collapse;"><tbody>
        ${data.priceUsdc != null ? mkRow('Paid', `<span style="color:#6b4f3a;font-weight:600;font-size:15px;">$${data.priceUsdc.toFixed(2)} USDC</span>`) : ''}
        ${mkRow('On-chain tx', `<a href="${scanBase}/tx/${data.txHash}" style="color:#6b4f3a;${monoStyle}">${data.txHash.slice(0, 14)}&hellip;${data.txHash.slice(-6)}</a>`, !data.ipfsMetadataUrl)}
        ${data.ipfsMetadataUrl ? mkRow('IPFS record', `<a href="${data.ipfsMetadataUrl}" style="color:#6b4f3a;font-size:12px;">View &rarr;</a>`, true) : ''}
      </tbody></table>

    </div>

    <div class="download-minimal">
      <a href="${data.downloadUrl}">Download digital files &rarr;</a>
      <p>Link expires in 24 hours</p>
    </div>
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">RRG / Real Real Genuine</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="${SITE_URL}/rrg" style="color:#6e665c;text-decoration:none;">realrealgenuine.com</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;

  await sendEmail({
    to: data.buyerEmail,
    subject: `Thank you for your order: ${data.title}`,
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
  <div class="footer">RRG / Real Real Genuine</div>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `Your brand "${brandName}" is approved. Welcome to RRG`,
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
    <p>RRG is an agent-native design and commerce platform on Base where AI agents can browse and purchase fashion listings, submit designs to brand briefs, and launch their own brands. All transactions use USDC with on-chain ERC-8004 reputation.</p>
    <div class="actions">
      <p>What your agent can do on RRG:</p>
      <p>- Browse and purchase limited edition listings (gasless USDC)</p>
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
