/**
 * RRG email helpers
 *
 * Two types of email:
 * 1. Approval notification: creator notified when their design goes live
 * 2. File delivery: buyer receives download link after mint
 */

const RESEND_URL = 'https://api.resend.com/emails';
const FROM       = process.env.FROM_EMAIL ?? 'deliver@getvia.xyz';
const SITE_URL   = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.getvia.xyz';

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
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; letter-spacing: 0.01em; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #2b9a66; margin: 0 0 8px; }
  h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; letter-spacing: -0.01em; }
  .body { padding: 28px 32px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .meta { width: 100%; border: 1px solid #e8e3db; border-collapse: collapse; margin: 0 0 24px; }
  .meta td { padding: 10px 16px; font-size: 13px; border-bottom: 1px solid #e8e3db; }
  .meta tr:last-child td { border-bottom: none; }
  .meta-label { color: #6e665c; white-space: nowrap; padding-right: 16px; }
  .meta-value { color: #1a1612; font-weight: 500; text-align: right; }
  .wallet { font-family: 'Courier New', Courier, monospace; font-size: 11px; color: #6b4f3a; text-align: right; word-break: break-all; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">Real Real Genuine</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Your creation is live</p>
      <h1>${escHtml(title)}</h1>
    </div>
    <div class="body">
      <p>Your submission has been approved and is now live on RRG.</p>
      <p class="lbl">Listing details</p>
      <table class="meta" cellpadding="0" cellspacing="0"><tbody>
        <tr><td class="meta-label">Price</td><td class="meta-value">${priceUsdc.toFixed(2)} USDC</td></tr>
        <tr><td class="meta-label">Edition</td><td class="meta-value">${editionSize} pieces</td></tr>
        <tr><td class="meta-label">Your share</td><td class="meta-value">70% per sale</td></tr>
        <tr><td class="meta-label">Revenue wallet</td><td class="wallet">${escHtml(creatorWallet)}</td></tr>
      </tbody></table>
      <p>Sales revenue (70%) is sent automatically to your wallet, no further steps from you.</p>
      <p>Share the link below. Every sale goes straight to your wallet.</p>
      <a class="btn" href="${dropUrl}">View your listing</a>
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
  sellerName,
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
  sellerName?: string | null;
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
      ${sellerName ? `<p class="brand-sub">${escHtml(sellerName)}</p>` : ''}
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
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; letter-spacing: 0.01em; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #6e665c; margin: 0 0 8px; }
  h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; letter-spacing: -0.01em; }
  .body { padding: 28px 32px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .reason { border: 1px solid #e8e3db; padding: 14px 16px; margin: 0 0 24px; background: #fdfbf7; }
  .reason p { margin: 0; font-size: 14px; color: #1a1612; line-height: 1.6; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">Real Real Genuine</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Submission update</p>
      <h1>${escHtml(title)}</h1>
    </div>
    <div class="body">
      <p>Thanks for submitting this work to RRG.</p>
      <p>After review, we weren't able to accept this submission for our current collection.</p>
      ${reason ? `
      <p class="lbl">Feedback</p>
      <div class="reason"><p>${escHtml(reason)}</p></div>` : ''}
      <p>We encourage you to refine and resubmit. We'd love to see more of your work.</p>
      <a class="btn" href="${SITE_URL}/rrg/submit">Submit again</a>
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
    subject: `Update on your RRG submission: "${title}"`,
    html,
  });
}

// ── 4. Physical product purchase notifications ──────────────────────────

interface PhysicalPurchaseEmailData {
  title: string;
  tokenId: number;
  /** Buyer's on-chain purchase tx hash, shown in buyer email */
  txHash: string;
  /** Brand's USDC payout tx hash, shown in seller email */
  brandPayoutTxHash?: string | null;
  buyerEmail: string | null;
  brandContactEmail: string;
  sellerName: string;
  shippingName: string;
  shippingAddress: string;   // pre-formatted multi-line
  shippingPhone: string | null;
  downloadUrl: string;
  ipfsMetadataUrl?: string | null;
  /** Product image signed URL for buyer email hero (optional) */
  imageUrl?: string | null;
  /** Selected size for garment products (null for non-garment) */
  selectedSize?: string | null;
  /** Selected colour variant (null when product has no colour axis) */
  selectedColor?: string | null;
  /** Price paid by buyer in USDC */
  priceUsdc?: number | null;
  /** Revenue sent to brand wallet in USDC (after platform fee) */
  brandRevenueUsdc?: number | null;
}

/** Send to brand: new physical product order with buyer shipping address */
export async function sendPhysicalOrderToBrand(data: PhysicalPurchaseEmailData): Promise<void> {
  const scanBase   = 'https://basescan.org';
  const listingUrl = `${SITE_URL}/rrg/drop/${data.tokenId}`;

  // Shared table row styles (table-based layout for email client compatibility)
  const rowStyle = 'padding:10px 16px;font-size:13px;border-bottom:1px solid #e8e3db;';
  const lblStyle = 'color:#6e665c;font-size:13px;white-space:nowrap;padding-right:16px;';
  const valStyle = 'color:#1a1612;font-weight:500;text-align:right;font-size:13px;';
  const monoStyle = "font-family:'Courier New',Courier,monospace;font-size:11px;";

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
  .badge { font-family: 'Courier New', Courier, monospace; font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; padding: 5px 10px; background: #6b4f3a; color: #ffffff; white-space: nowrap; }
  .body { padding: 28px 32px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 14px; }
  .address-block { padding: 14px 16px; font-family: 'Courier New', Courier, monospace; font-size: 13px; color: #1a1612; line-height: 1.7; white-space: pre-line; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">Real Real Genuine</p>
  <div class="card">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #e8e3db;"><tbody><tr>
      <td style="padding:28px 32px 24px;">
        <h1 style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:400;font-style:italic;color:#1a1612;letter-spacing:-0.01em;">New order</h1>
        <p style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#6e665c;margin:0;">Action required: please arrange shipping</p>
      </td>
      <td align="right" style="padding:28px 32px 24px;vertical-align:top;">
        <span class="badge">New order</span>
      </td>
    </tr></tbody></table>
    <div class="body">

      <p class="lbl">Order details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3db;margin:0 0 20px;border-collapse:collapse;"><tbody>
        ${mkRow('Product', escHtml(data.title))}
        ${mkRow('Token', `<span style="${monoStyle}">#${data.tokenId}</span>`)}
        ${data.selectedSize ? mkRow('Size', `<span style="color:#6b4f3a;font-weight:600;font-size:15px;">${escHtml(data.selectedSize)}</span>`) : ''}
        ${data.selectedColor ? mkRow('Colour', `<span style="color:#6b4f3a;font-weight:600;font-size:15px;">${escHtml(data.selectedColor)}</span>`) : ''}
        ${data.priceUsdc != null ? mkRow('Price paid', `$${data.priceUsdc.toFixed(2)} USDC`, true) : ''}
      </tbody></table>

      ${data.brandRevenueUsdc != null ? `
      <div style="border:1px solid #d5cfc7;background:#f7f3ee;padding:20px 24px;margin:0 0 20px;">
        <p style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#6b4f3a;margin:0 0 8px;">Your revenue (auto-distributed)</p>
        <p style="font-family:Georgia,'Times New Roman',serif;font-size:36px;font-weight:400;color:#1a1612;margin:0 0 4px;letter-spacing:-0.02em;">$${data.brandRevenueUsdc.toFixed(2)} USDC</p>
        <p style="font-size:12px;color:#6e665c;margin:0;">Sent automatically to your brand wallet on Base. No action needed.</p>
      </div>` : ''}

      <p class="lbl">Ship to</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3db;margin:0 0 20px;border-collapse:collapse;"><tbody>
        <tr><td colspan="2"><div class="address-block">${escHtml(data.shippingName)}
${escHtml(data.shippingAddress)}</div></td></tr>
        ${data.shippingPhone ? `<tr><td style="${rowStyle}${lblStyle}border-top:1px solid #e8e3db;">Phone</td><td style="${rowStyle}${valStyle}border-top:1px solid #e8e3db;">${escHtml(data.shippingPhone)}</td></tr>` : ''}
        ${data.buyerEmail ? `<tr><td style="${rowStyle}${lblStyle}border-top:1px solid #e8e3db;border-bottom:none;">Buyer email</td><td style="${rowStyle}${valStyle}border-top:1px solid #e8e3db;border-bottom:none;">${escHtml(data.buyerEmail)}</td></tr>` : ''}
      </tbody></table>

      <p class="lbl">On-chain proof</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3db;margin:0 0 20px;border-collapse:collapse;"><tbody>
        ${data.brandPayoutTxHash ? mkRow('Your payout tx', `<a href="${scanBase}/tx/${data.brandPayoutTxHash}" style="color:#6b4f3a;${monoStyle}">${data.brandPayoutTxHash.slice(0, 14)}&hellip;${data.brandPayoutTxHash.slice(-6)}</a>`) : ''}
        ${mkRow('Buyer purchase tx', `<a href="${scanBase}/tx/${data.txHash}" style="color:#6b4f3a;${monoStyle}">${data.txHash.slice(0, 14)}&hellip;${data.txHash.slice(-6)}</a>`, true)}
      </tbody></table>

      <p style="font-size:13px;color:#3a342d;line-height:1.6;margin:0 0 20px">Please arrange delivery to the address above. If you have any questions about this order, reply to this email.</p>
      <a class="btn" href="${listingUrl}">View listing on RRG</a>

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
    to: data.brandContactEmail,
    subject: `New order: "${data.title}" (Token #${data.tokenId}) - please arrange shipping`,
    html,
  });
}

/** Send to buyer: purchase confirmation, physical product prominent, download link minimal at end */
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
      <p class="brand-sub">${escHtml(data.sellerName)}${data.selectedSize ? `, Size ${escHtml(data.selectedSize)}` : ''}${data.selectedColor ? `, ${escHtml(data.selectedColor)}` : ''}</p>
    </div>

    ${data.imageUrl ? `<img class="product-img" src="${data.imageUrl}" alt="${escHtml(data.title)}" />` : ''}

    <div class="body">

      <p class="lbl">Your order</p>
      <div class="dispatch-box">
        <p>${escHtml(data.sellerName)} will arrange delivery to the address below. Allow a few days for dispatch confirmation. The seller will follow up directly if they need any further details.</p>
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
  sellerName,
  sellerSlug,
}: {
  to: string;
  sellerName: string;
  sellerSlug: string;
}): Promise<void> {
  const dashboardUrl = `${SITE_URL}/seller/${sellerSlug}/admin`;

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
  h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; letter-spacing: -0.01em; }
  .body { padding: 28px 32px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .bullets { border: 1px solid #e8e3db; padding: 14px 18px; margin: 0 0 24px; background: #fdfbf7; }
  .bullets p { margin: 0 0 6px; font-size: 14px; color: #1a1612; line-height: 1.6; }
  .bullets p:last-child { margin: 0; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">Real Real Genuine</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Brand approved</p>
      <h1>Welcome to RRG, ${escHtml(sellerName)}</h1>
    </div>
    <div class="body">
      <p>Your brand partner application has been approved. You now have full access to your brand dashboard.</p>
      <p class="lbl">From your dashboard you can</p>
      <div class="bullets">
        <p>Submit products for the RRG collection</p>
        <p>Track sales and revenue</p>
        <p>Manage your brand profile</p>
      </div>
      <a class="btn" href="${dashboardUrl}">Go to your dashboard</a>
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
    subject: `Your brand "${sellerName}" is approved. Welcome to RRG`,
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
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; letter-spacing: 0.01em; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #2b9a66; margin: 0 0 8px; }
  h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; letter-spacing: -0.01em; }
  .body { padding: 28px 32px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .actions { border: 1px solid #e8e3db; padding: 14px 18px; margin: 0 0 24px; background: #fdfbf7; }
  .actions p { margin: 0 0 8px; font-size: 14px; color: #1a1612; line-height: 1.6; }
  .actions p:last-child { margin: 0; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
  .post { margin-top: 16px; font-size: 13px; color: #6e665c; }
  .post a { color: #6b4f3a; text-decoration: none; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">Real Real Genuine</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Collaboration request</p>
      <h1>Your agent received a request from RRG</h1>
    </div>
    <div class="body">
      <p>Your ERC-8004 agent <strong style="color:#1a1612">"${escHtml(agentName)}"</strong>${idStr} was contacted by the RRG platform agent (#33313) via ${escHtml(channel.toUpperCase())}.</p>
      <p>RRG is an agent-native design and commerce platform on Base where AI agents can browse and purchase fashion listings, submit designs to brand briefs, and launch their own brands. All transactions use USDC with on-chain ERC-8004 reputation.</p>
      <p class="lbl">What your agent can do on RRG</p>
      <div class="actions">
        <p>Browse and purchase limited edition listings (gasless USDC)</p>
        <p>Submit original designs to open brand briefs (earn 35% on every sale)</p>
        <p>Register and launch its own brand with automatic USDC payouts</p>
      </div>
      <a class="btn" href="https://realrealgenuine.com/mcp">Connect your agent</a>
      <p class="post">RRG is a product of <a href="https://www.getvia.xyz/mcp">VIA Labs</a>.</p>
    </div>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">RRG Platform Agent (#33313)</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="https://realrealgenuine.com" style="color:#6e665c;text-decoration:none;">realrealgenuine.com</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `Your agent "${agentName}" received a collaboration request from RRG`,
    html,
  });
}

// ── 7. Event ticket / voucher delivery ────────────────────────────────
//
// VIA-branded. Sent to the buyer when an event-pass purchase settles: their
// unique redemption code(s) plus how to redeem them. One email per order.

export async function sendTicketDeliveryEmail({
  to,
  eventName,
  tierTitle,
  codes,
  redemption,
  orderRef,
  priceUsdc,
  txHash,
}: {
  to: string;
  eventName: string;
  tierTitle: string;
  codes: string[];
  redemption?: { instructions?: string | null; url?: string | null } | null;
  orderRef: string;
  priceUsdc?: number | null;
  txHash?: string | null;
}): Promise<void> {
  if (!to || codes.length === 0) return;

  const scanBase = 'https://basescan.org';
  const plural   = codes.length > 1;

  const codeBlocks = codes
    .map(
      (c) => `<p style="font-family:'Courier New',Courier,monospace;font-size:20px;letter-spacing:0.16em;color:#1a1612;margin:0;padding:14px 18px;border:2px solid #2b9a66;background:#f4faf6;text-align:center;">${escHtml(c)}</p>`,
    )
    .join('<div style="height:10px;"></div>');

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
  .sub { font-size: 13px; color: #6e665c; margin: 0; }
  .body { padding: 28px 32px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .body p.copy { margin: 0 0 16px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">VIA</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Your pass is confirmed</p>
      <h1>${escHtml(tierTitle)}</h1>
      <p class="sub">${escHtml(eventName)}</p>
    </div>
    <div class="body">
      <p class="copy">Thank you for your order. Your payment settled in USDC on Base and your ${plural ? 'redemption codes are' : 'redemption code is'} below.</p>

      <p class="lbl">Your redemption ${plural ? 'codes' : 'code'}</p>
      ${codeBlocks}

      ${redemption?.instructions ? `<p class="copy" style="margin-top:24px;">${escHtml(redemption.instructions)}</p>` : ''}
      ${redemption?.url ? `<a class="btn" href="${redemption.url}">Redeem your pass</a>` : ''}

      <p class="lbl" style="margin-top:28px;">Order</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3db;border-collapse:collapse;"><tbody>
        <tr><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #e8e3db;color:#6e665c;">Reference</td><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #e8e3db;color:#1a1612;font-weight:500;text-align:right;font-family:'Courier New',Courier,monospace;">${escHtml(orderRef)}</td></tr>
        ${priceUsdc != null ? `<tr><td style="padding:10px 16px;font-size:13px;${txHash ? 'border-bottom:1px solid #e8e3db;' : ''}color:#6e665c;">Paid</td><td style="padding:10px 16px;font-size:13px;${txHash ? 'border-bottom:1px solid #e8e3db;' : ''}color:#6b4f3a;font-weight:600;text-align:right;">$${priceUsdc.toFixed(2)} USDC</td></tr>` : ''}
        ${txHash ? `<tr><td style="padding:10px 16px;font-size:13px;color:#6e665c;">On-chain tx</td><td style="padding:10px 16px;font-size:13px;text-align:right;"><a href="${scanBase}/tx/${txHash}" style="color:#6b4f3a;font-family:'Courier New',Courier,monospace;font-size:11px;">${txHash.slice(0, 14)}&hellip;${txHash.slice(-6)}</a></td></tr>` : ''}
      </tbody></table>
    </div>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">VIA</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="${SITE_URL}" style="color:#6e665c;text-decoration:none;">app.getvia.xyz</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `Your ${eventName} pass: redemption ${plural ? 'codes' : 'code'} inside`,
    html,
  });
}

// ── 7b. Event pass: buyer payment receipt (manual fulfilment) ─────────
//
// Sent to the buyer when a pass settles under manual fulfilment (no Luma Pro
// API, no code pool): confirms the USDC transfer and tells them the organiser
// will follow up, with a support address for any further information and a link
// to the event's main website. No redemption code. VIA-branded, no em/en dashes.

export async function sendTicketReceiptEmail({
  to,
  eventName,
  tierTitle,
  orderRef,
  priceUsdc,
  txHash,
  supportEmail,
  websiteUrl,
}: {
  to: string;
  eventName: string;
  tierTitle: string;
  orderRef: string;
  priceUsdc?: number | null;
  txHash?: string | null;
  supportEmail: string;
  websiteUrl?: string | null;
}): Promise<void> {
  if (!to) return;
  const scanBase = 'https://basescan.org';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #2b9a66; margin: 0 0 8px; }
  h1 { margin: 0 0 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; }
  .sub { font-size: 13px; color: #6e665c; margin: 0; }
  .body { padding: 28px 32px; }
  .copy { margin: 0 0 16px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
  a { color: #6b4f3a; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">VIA</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Payment received</p>
      <h1>${escHtml(tierTitle)}</h1>
      <p class="sub">${escHtml(eventName)}</p>
    </div>
    <div class="body">
      <p class="copy">Thank you for purchasing your ${escHtml(eventName)} pass using VIA. Your payment settled in USDC on Base and your order is confirmed. The organiser will process your pass and be in touch with the next steps.</p>

      <p class="lbl">Order</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3db;border-collapse:collapse;margin:0 0 24px;"><tbody>
        <tr><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #e8e3db;color:#6e665c;">Reference</td><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #e8e3db;color:#1a1612;font-weight:500;text-align:right;font-family:'Courier New',Courier,monospace;">${escHtml(orderRef)}</td></tr>
        ${priceUsdc != null ? `<tr><td style="padding:10px 16px;font-size:13px;${txHash ? 'border-bottom:1px solid #e8e3db;' : ''}color:#6e665c;">Paid</td><td style="padding:10px 16px;font-size:13px;${txHash ? 'border-bottom:1px solid #e8e3db;' : ''}color:#6b4f3a;font-weight:600;text-align:right;">$${priceUsdc.toFixed(2)} USDC</td></tr>` : ''}
        ${txHash ? `<tr><td style="padding:10px 16px;font-size:13px;color:#6e665c;">On-chain tx</td><td style="padding:10px 16px;font-size:13px;text-align:right;"><a href="${scanBase}/tx/${txHash}" style="font-family:'Courier New',Courier,monospace;font-size:11px;">${txHash.slice(0, 14)}&hellip;${txHash.slice(-6)}</a></td></tr>` : ''}
      </tbody></table>

      <p class="copy">If any further information is required, send a request by email to <a href="mailto:${escHtml(supportEmail)}">${escHtml(supportEmail)}</a>.</p>
      ${websiteUrl ? `<a class="btn" href="${escHtml(websiteUrl)}" style="color:#faf7f2;text-decoration:none;">Visit the website</a>` : ''}

      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #e8e3db;">
        <p class="copy" style="margin:0;">VIA is the first end-to-end fully agentic platform for buyers and sellers. You, or your agent, can create and run a store on VIA. Just point them to <a href="https://app.getvia.xyz/mcp">app.getvia.xyz/mcp</a> or <a href="https://getvia.xyz">getvia.xyz</a> and select JOIN.</p>
      </div>
    </div>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">VIA</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="${SITE_URL}" style="color:#6e665c;text-decoration:none;">app.getvia.xyz</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;

  await sendEmail({ to, subject: `Your ${eventName} order is confirmed (${orderRef})`, html });
}

// ── 7c. Event pass: order notice to account admins (manual fulfilment) ──
//
// Sent to the store's owner + admins when a pass settles under manual
// fulfilment, so they can register the attendee. Carries the attendee details
// collected at purchase and the payment proof. VIA-branded, no em/en dashes.

export async function sendEventOrderToAdmins({
  to,
  eventName,
  tierTitle,
  orderRef,
  attendeeName,
  attendeeEmail,
  attendeeCountry,
  qty,
  priceUsdc,
  txHash,
  buyerWallet,
  dashboardUrl,
}: {
  to: string;
  eventName: string;
  tierTitle: string;
  orderRef: string;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  attendeeCountry?: string | null;
  qty: number;
  priceUsdc?: number | null;
  txHash?: string | null;
  buyerWallet?: string | null;
  dashboardUrl?: string | null;
}): Promise<void> {
  if (!to) return;
  const scanBase = 'https://basescan.org';
  const rowStyle = 'padding:10px 16px;font-size:13px;border-bottom:1px solid #e8e3db;';
  const lblStyle = 'color:#6e665c;font-size:13px;white-space:nowrap;padding-right:16px;';
  const valStyle = 'color:#1a1612;font-weight:500;text-align:right;font-size:13px;';
  const monoStyle = "font-family:'Courier New',Courier,monospace;font-size:11px;";

  const mkRow = (label: string, valueHtml: string, last = false) =>
    `<tr><td style="${rowStyle}${last ? 'border-bottom:none;' : ''}${lblStyle}">${label}</td><td style="${rowStyle}${last ? 'border-bottom:none;' : ''}${valStyle}">${valueHtml}</td></tr>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #6b4f3a; margin: 0 0 8px; }
  h1 { margin: 0 0 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 400; font-style: italic; color: #1a1612; }
  .sub { font-size: 13px; color: #6e665c; margin: 0; }
  .body { padding: 28px 32px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">VIA</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">New pass order &middot; action required</p>
      <h1>${escHtml(tierTitle)}</h1>
      <p class="sub">${escHtml(eventName)}</p>
    </div>
    <div class="body">
      <p style="font-size:13px;color:#3a342d;line-height:1.6;margin:0 0 20px;">A pass has been paid for and needs issuing. Register the attendee below on the event platform, then follow up with them directly.</p>

      <p class="lbl">Attendee</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3db;margin:0 0 20px;border-collapse:collapse;"><tbody>
        ${mkRow('Name', attendeeName ? escHtml(attendeeName) : '<span style="color:#b0442e;">not provided</span>')}
        ${mkRow('Email', attendeeEmail ? `<a href="mailto:${escHtml(attendeeEmail)}" style="color:#6b4f3a;">${escHtml(attendeeEmail)}</a>` : '<span style="color:#b0442e;">not provided</span>')}
        ${mkRow('Country', attendeeCountry ? escHtml(attendeeCountry) : '<span style="color:#b0442e;">not provided</span>', true)}
      </tbody></table>

      <p class="lbl">Order</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3db;margin:0 0 20px;border-collapse:collapse;"><tbody>
        ${mkRow('Reference', `<span style="${monoStyle}">${escHtml(orderRef)}</span>`)}
        ${mkRow('Tier', escHtml(tierTitle))}
        ${mkRow('Quantity', String(qty))}
        ${priceUsdc != null ? mkRow('Paid', `<span style="color:#6b4f3a;font-weight:600;">$${priceUsdc.toFixed(2)} USDC</span>`) : ''}
        ${buyerWallet ? mkRow('Buyer wallet', `<span style="${monoStyle}">${escHtml(buyerWallet.slice(0, 10))}&hellip;${escHtml(buyerWallet.slice(-6))}</span>`) : ''}
        ${txHash ? mkRow('On-chain tx', `<a href="${scanBase}/tx/${txHash}" style="color:#6b4f3a;${monoStyle}">${txHash.slice(0, 14)}&hellip;${txHash.slice(-6)}</a>`, true) : ''}
      </tbody></table>

      ${dashboardUrl ? `<a class="btn" href="${escHtml(dashboardUrl)}" style="color:#faf7f2;text-decoration:none;">View order</a>` : ''}
    </div>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">VIA</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="${SITE_URL}" style="color:#6e665c;text-decoration:none;">app.getvia.xyz</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;

  await sendEmail({ to, subject: `New ${eventName} pass order: ${orderRef} (${tierTitle})`, html });
}

// ── 8. Seller team invite ──────────────────────────────────────────────
//
// Sent when a seller owner/admin invites a teammate. The link carries an
// opaque invite token (app_seller_invites.token); the accept page creates the
// account (or signs in) and adds the membership row.

export async function sendSellerInviteEmail({
  to,
  sellerName,
  inviterEmail,
  role,
  acceptUrl,
  expiresAt,
}: {
  to: string;
  sellerName: string;
  inviterEmail: string | null;
  role: 'admin' | 'viewer';
  acceptUrl: string;
  expiresAt: string;
}): Promise<void> {
  const roleLabel = role === 'admin' ? 'Admin' : 'Viewer';
  const roleBlurb =
    role === 'admin'
      ? 'You will be able to manage products, negotiations, orders and settings.'
      : 'You will have read-only access to products, negotiations and orders.';
  const expires = new Date(expiresAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

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
  h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; letter-spacing: -0.01em; }
  .body { padding: 28px 32px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .role-box { border: 1px solid #e8e3db; padding: 14px 18px; margin: 0 0 24px; background: #fdfbf7; }
  .role-box p { margin: 0; font-size: 14px; color: #1a1612; line-height: 1.6; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
  .post { margin-top: 16px; font-size: 12px; color: #6e665c; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">VIA</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Team invitation</p>
      <h1>Join ${escHtml(sellerName)} on VIA</h1>
    </div>
    <div class="body">
      <p>${inviterEmail ? `${escHtml(inviterEmail)} has invited you` : 'You have been invited'} to help run <strong style="color:#1a1612">${escHtml(sellerName)}</strong> on VIA as a <strong style="color:#1a1612">${roleLabel}</strong>.</p>
      <p class="lbl">Your access</p>
      <div class="role-box"><p>${roleBlurb}</p></div>
      <a class="btn" href="${acceptUrl}">Accept invitation</a>
      <p class="post">This invitation expires on ${expires}. If you weren't expecting it, you can ignore this email.</p>
    </div>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">VIA</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="${SITE_URL}" style="color:#6e665c;text-decoration:none;">app.getvia.xyz</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;

  await sendEmail({
    to,
    subject: `You're invited to join ${sellerName} on VIA`,
    html,
  });
}

// ── 9. Event pass registered directly on Luma (no code to redeem) ──────
//
// Sent when fulfilment is Luma API auto-registration: the buyer was added to
// the event as a guest, so Luma issues the pass to them directly. VIA-branded,
// no em/en dashes.

export async function sendTicketRegisteredEmail({
  to,
  eventName,
  tierTitle,
  orderRef,
  priceUsdc,
  txHash,
}: {
  to: string;
  eventName: string;
  tierTitle: string;
  orderRef: string;
  priceUsdc?: number | null;
  txHash?: string | null;
}): Promise<void> {
  if (!to) return;
  const scanBase = 'https://basescan.org';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #2b9a66; margin: 0 0 8px; }
  h1 { margin: 0 0 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; }
  .sub { font-size: 13px; color: #6e665c; margin: 0; }
  .body { padding: 28px 32px; }
  .copy { margin: 0 0 16px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">VIA</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">You are registered</p>
      <h1>${escHtml(tierTitle)}</h1>
      <p class="sub">${escHtml(eventName)}</p>
    </div>
    <div class="body">
      <p class="copy">Thank you for your order. Your payment settled in USDC on Base and we have registered you directly for ${escHtml(eventName)}. Your pass will arrive in your inbox from the event organiser. No code to redeem.</p>
      <p class="lbl">Order</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e3db;border-collapse:collapse;"><tbody>
        <tr><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #e8e3db;color:#6e665c;">Reference</td><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #e8e3db;color:#1a1612;font-weight:500;text-align:right;font-family:'Courier New',Courier,monospace;">${escHtml(orderRef)}</td></tr>
        ${priceUsdc != null ? `<tr><td style="padding:10px 16px;font-size:13px;${txHash ? 'border-bottom:1px solid #e8e3db;' : ''}color:#6e665c;">Paid</td><td style="padding:10px 16px;font-size:13px;${txHash ? 'border-bottom:1px solid #e8e3db;' : ''}color:#6b4f3a;font-weight:600;text-align:right;">$${priceUsdc.toFixed(2)} USDC</td></tr>` : ''}
        ${txHash ? `<tr><td style="padding:10px 16px;font-size:13px;color:#6e665c;">On-chain tx</td><td style="padding:10px 16px;font-size:13px;text-align:right;"><a href="${scanBase}/tx/${txHash}" style="color:#6b4f3a;font-family:'Courier New',Courier,monospace;font-size:11px;">${txHash.slice(0, 14)}&hellip;${txHash.slice(-6)}</a></td></tr>` : ''}
      </tbody></table>
    </div>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">VIA</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="${SITE_URL}" style="color:#6e665c;text-decoration:none;">app.getvia.xyz</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;

  await sendEmail({ to, subject: `You are registered for ${eventName}`, html });
}

// ── 10. Free event pass: a confirmed place on the guest list ───────────
//
// Sent for the FREE event-pass channel (guest_list fulfilment): no payment, no
// redemption code. The guest has a confirmed place that the organiser admits
// them from. VIA-branded, no em/en dashes.

export async function sendEventGuestEmail({
  to,
  guestName,
  eventName,
  tierTitle,
  redemption,
}: {
  to: string;
  guestName?: string | null;
  eventName: string;
  tierTitle: string;
  redemption?: { platform?: string; instructions?: string; url?: string } | null;
}): Promise<void> {
  if (!to) return;
  const greeting = guestName ? `Hi ${escHtml(guestName)}, ` : '';
  const instructions = redemption?.instructions?.trim() || null;
  const url = redemption?.url?.trim() || null;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #2b9a66; margin: 0 0 8px; }
  h1 { margin: 0 0 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; }
  .sub { font-size: 13px; color: #6e665c; margin: 0; }
  .body { padding: 28px 32px; }
  .copy { margin: 0 0 16px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .cta { display: inline-block; margin-top: 4px; padding: 12px 20px; background: #1a1612; color: #faf7f2; text-decoration: none; font-size: 13px; letter-spacing: 0.04em; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">VIA</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">You are on the guest list</p>
      <h1>${escHtml(tierTitle)}</h1>
      <p class="sub">${escHtml(eventName)}</p>
    </div>
    <div class="body">
      <p class="copy">${greeting}your place at ${escHtml(eventName)} is confirmed. This pass is free, so there is nothing to pay and no code to redeem. The organiser has you on the guest list.</p>
      ${instructions ? `<p class="lbl">Getting in</p><p class="copy">${escHtml(instructions)}</p>` : ''}
      ${url ? `<a class="cta" href="${escHtml(url)}">Event details</a>` : ''}
    </div>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">VIA</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="${SITE_URL}" style="color:#6e665c;text-decoration:none;">app.getvia.xyz</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;

  await sendEmail({ to, subject: `You are on the guest list for ${eventName}`, html });
}

// ── HTML escape helper ─────────────────────────────────────────────────
function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
