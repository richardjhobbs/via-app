/**
 * Email notifications via Resend.
 * Adapted from rrg/lib/app/email.ts
 */

import { Resend } from 'resend';

const FROM = process.env.FROM_EMAIL ?? 'fresh@realrealgenuine.com';
const DIGEST_FROM = process.env.DIGEST_FROM_EMAIL ?? 'fresh@realrealgenuine.com';
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com').replace(/\/$/, '');

function getResend() {
  return new Resend(process.env.RESEND_API_KEY ?? '');
}

interface EmailParams {
  to: string;
  subject: string;
  html: string;
  fromOverride?: string;
}

async function send({ to, subject, html, fromOverride }: EmailParams) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email-stub] To: ${to} | Subject: ${subject}`);
    return;
  }

  // Resend's SDK returns { data, error } rather than throwing on API errors
  // such as a revoked key (401) or unverified sender domain. Surface those
  // explicitly so the calling route logs the failure instead of silently
  // succeeding with no email actually delivered.
  const result = await getResend().emails.send({
    from: fromOverride ?? `VIA Drops <${FROM}>`,
    to,
    subject,
    html,
  });
  if (result.error) {
    throw new Error(`Resend send failed: ${result.error.name} ${result.error.message}`);
  }
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Sign-in (magic link) ─────────────────────────────────────────────

/**
 * One-shot sign-in link. Replaces the previous unauthenticated session
 * lookup. The link contains a single-use token that the server verifies
 * server-side before minting a session cookie. Tokens expire in 15 min.
 */
export async function sendSignInLink(
  email: string,
  agentName: string,
  rawToken: string,
) {
  const link = `${SITE_URL}/agents/auth/email/verify?token=${encodeURIComponent(rawToken)}`;
  await send({
    to: email,
    subject: `Sign in to Real Real Genuine`,
    html: `
      <div style="font-family: sans-serif; color: #1a1612; background: #faf7f2; padding: 32px;">
        <h2 style="color: #1a1612; font-family: serif; font-weight: 400; margin: 0 0 12px;">Sign in to your Concierge</h2>
        <p style="margin: 0 0 16px; color: #3a342d; line-height: 1.55;">
          Hi ${escHtml(agentName)},
        </p>
        <p style="margin: 0 0 20px; color: #3a342d; line-height: 1.55;">
          Click the button below to sign in. The link works once and expires in 15 minutes.
        </p>
        <a href="${link}" style="display: inline-block; background: #1a1612; color: #faf7f2; padding: 14px 28px; text-decoration: none; font-weight: 500; margin: 8px 0 20px;">
          Sign in
        </a>
        <p style="margin: 0 0 8px; color: #6b6058; font-size: 13px; line-height: 1.55;">
          If the button does not work, paste this URL into your browser:
        </p>
        <p style="margin: 0 0 24px; color: #6b6058; font-size: 12px; word-break: break-all;">
          ${link}
        </p>
        <p style="margin: 0; color: #6b6058; font-size: 12px; line-height: 1.55;">
          Did not request this? You can ignore this email. No one can sign in without the link above.
        </p>
      </div>
    `,
  });
}

// ── Notification templates ───────────────────────────────────────────

export async function sendRecommendation(
  email: string,
  agentName: string,
  dropTitle: string,
  reasoning: string,
  dropUrl: string
) {
  await send({
    to: email,
    subject: `${agentName} found a drop for you: ${dropTitle}`,
    html: `
      <div style="font-family: sans-serif; color: #ededed; background: #0a0a0a; padding: 32px;">
        <h2 style="color: #fff;">Your agent found something</h2>
        <p><strong>${agentName}</strong> evaluated <strong>${dropTitle}</strong> and thinks it's worth your attention.</p>
        <div style="background: #1a1a1a; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="color: #999; margin: 0 0 8px;">Agent's reasoning:</p>
          <p style="margin: 0;">${reasoning}</p>
        </div>
        <a href="${dropUrl}" style="display: inline-block; background: #fff; color: #000; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px;">
          Review &amp; Approve
        </a>
      </div>
    `,
  });
}

export async function sendBidPlaced(
  email: string,
  agentName: string,
  dropTitle: string,
  bidAmount: number
) {
  await send({
    to: email,
    subject: `${agentName} bid $${bidAmount} on ${dropTitle}`,
    html: `
      <div style="font-family: sans-serif; color: #ededed; background: #0a0a0a; padding: 32px;">
        <h2 style="color: #fff;">Bid placed</h2>
        <p><strong>${agentName}</strong> submitted a sealed bid of <strong>$${bidAmount} USDC</strong> on <strong>${dropTitle}</strong>.</p>
        <p style="color: #999;">You'll be notified when the bid window closes and results are in.</p>
      </div>
    `,
  });
}

export async function sendBidWon(
  email: string,
  agentName: string,
  dropTitle: string,
  bidAmount: number,
  txHash: string
) {
  await send({
    to: email,
    subject: `${agentName} won: ${dropTitle}`,
    html: `
      <div style="font-family: sans-serif; color: #ededed; background: #0a0a0a; padding: 32px;">
        <h2 style="color: #fff;">You won the drop</h2>
        <p><strong>${agentName}</strong> won <strong>${dropTitle}</strong> with a bid of <strong>$${bidAmount} USDC</strong>.</p>
        <p>Settlement tx: <a href="https://basescan.org/tx/${txHash}" style="color: #60a5fa;">${txHash.slice(0, 16)}...</a></p>
      </div>
    `,
  });
}

export async function sendBidLost(
  email: string,
  agentName: string,
  dropTitle: string
) {
  await send({
    to: email,
    subject: `${agentName}'s bid on ${dropTitle} was not successful`,
    html: `
      <div style="font-family: sans-serif; color: #ededed; background: #0a0a0a; padding: 32px;">
        <h2 style="color: #fff;">Bid unsuccessful</h2>
        <p><strong>${agentName}</strong>'s bid on <strong>${dropTitle}</strong> did not win this time. No funds were deducted.</p>
      </div>
    `,
  });
}

/**
 * @deprecated Replaced by sendOwnerDailyDigest. Retained for one release;
 * remove in the next pass when no callers remain.
 */
export async function sendNewListingMatch(
  email: string,
  agentName: string,
  match: { sellerName: string | null; title: string; url: string; priceUsdc: number | null; reason: string },
) {
  const price = match.priceUsdc != null ? `$${match.priceUsdc.toFixed(2)} USDC` : '';
  const subject = match.sellerName
    ? `${match.sellerName} matches your profile: ${match.title}`
    : `New on RRG, matches your profile: ${match.title}`;

  await send({
    to: email,
    subject,
    html: `
      <div style="font-family: sans-serif; color: #ededed; background: #0a0a0a; padding: 32px;">
        <h2 style="color: #fff; margin:0 0 12px;">${match.sellerName ? `${match.sellerName} &middot; ` : ''}${match.title}</h2>
        <p style="color:#bbb; margin:0 0 14px;">${match.reason}</p>
        ${price ? `<div style="color:#bbb; margin:0 0 18px;">${price}</div>` : ''}
        <a href="${match.url}" style="display:inline-block; background:#fff; color:#000; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600;">View on RRG</a>
        <p style="color:#666; font-size:12px; margin-top:28px;">${agentName} only emails when a new listing genuinely fits your profile. Quiet days stay quiet.</p>
      </div>
    `,
  });
}

/**
 * @deprecated Replaced by sendOwnerDailyDigest. Retained for one release.
 */
export async function sendNewBrandMatch(
  email: string,
  agentName: string,
  match: { sellerName: string; brandUrl: string; reason: string },
) {
  await send({
    to: email,
    subject: `${match.sellerName} joined RRG and matches your profile`,
    html: `
      <div style="font-family: sans-serif; color: #ededed; background: #0a0a0a; padding: 32px;">
        <h2 style="color: #fff; margin:0 0 12px;">${match.sellerName} on RRG</h2>
        <p style="color:#bbb; margin:0 0 18px;">${match.reason}</p>
        <a href="${match.brandUrl}" style="display:inline-block; background:#fff; color:#000; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600;">See the brand</a>
        <p style="color:#666; font-size:12px; margin-top:28px;">${agentName} only emails when a new brand genuinely fits your profile. Quiet days stay quiet.</p>
      </div>
    `,
  });
}

// ── Owner daily digest ─────────────────────────────────────────────────

export interface DigestBrand {
  name: string;
  url: string;
  matchedAgentNames: string[];
}

export interface DigestListing {
  title: string;
  sellerName: string | null;
  url: string;
  priceUsdc: number | null;
  reason: string;
  matchedAgentNames: string[];
}

export interface DigestPayload {
  brands: DigestBrand[];
  listings: DigestListing[];
}

function digestSubject(p: DigestPayload): string {
  const b = p.brands.length;
  const l = p.listings.length;
  if (b === 1 && l === 0) return `${p.brands[0].name} just joined RRG`;
  if (b === 0 && l === 1) return `One new listing on RRG for you`;
  if (b === 1 && l > 0) return `${p.brands[0].name} just joined RRG, plus ${l} more`;
  return `Today on RRG: ${b + l} new for you`;
}

function agentList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function digestHtml(p: DigestPayload): string {
  const brandsSection = p.brands.length === 0 ? '' : `
      <p class="lbl">New brands</p>
      <div class="block">
        ${p.brands.map(b => `
          <div class="row">
            <h3 class="row-title">${escHtml(b.name)}</h3>
            <p class="row-body">${escHtml(b.name)} has just joined RRG and has products you, or your agent ${escHtml(agentList(b.matchedAgentNames))}, may want to see.</p>
            <a class="row-btn" href="${b.url}">Visit the brand &rarr;</a>
          </div>
        `).join('')}
      </div>
  `;

  const listingsSection = p.listings.length === 0 ? '' : `
      <p class="lbl">${p.brands.length > 0 ? 'Also for you' : 'For you'}</p>
      <div class="block">
        ${p.listings.map(l => {
          const price = l.priceUsdc != null ? `<span class="price">$${l.priceUsdc.toFixed(2)} USDC</span>` : '';
          const matched = l.matchedAgentNames.length > 1
            ? `<span class="matched">Matched for ${escHtml(agentList(l.matchedAgentNames))}.</span>`
            : '';
          return `
          <div class="row">
            <h3 class="row-title">${l.sellerName ? `${escHtml(l.sellerName)} &middot; ` : ''}${escHtml(l.title)}</h3>
            <p class="row-body">${escHtml(l.reason)}</p>
            ${price ? `<p class="row-meta">${price}</p>` : ''}
            ${matched ? `<p class="row-meta">${matched}</p>` : ''}
            <a class="row-btn" href="${l.url}">View on RRG &rarr;</a>
          </div>
        `;
        }).join('')}
      </div>
  `;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 580px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; letter-spacing: 0.01em; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #2b9a66; margin: 0 0 8px; }
  h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 400; font-style: italic; color: #1a1612; letter-spacing: -0.01em; }
  .body { padding: 28px 32px; }
  .body > p.intro { margin: 0 0 24px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .block { border: 1px solid #e8e3db; margin: 0 0 24px; }
  .row { padding: 18px 20px; border-bottom: 1px solid #e8e3db; }
  .row:last-child { border-bottom: none; }
  .row-title { font-family: Georgia, 'Times New Roman', serif; font-size: 16px; font-style: italic; font-weight: 400; margin: 0 0 8px; color: #1a1612; }
  .row-body { font-size: 14px; line-height: 1.6; color: #3a342d; margin: 0 0 8px; }
  .row-meta { font-size: 12px; color: #6e665c; margin: 0 0 6px; }
  .price { color: #6b4f3a; font-weight: 600; }
  .matched { color: #6e665c; font-style: italic; }
  .row-btn { display: inline-block; margin-top: 8px; font-family: 'Courier New', Courier, monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #6b4f3a; text-decoration: none; }
  .footer-note { padding: 18px 32px; border-top: 1px solid #e8e3db; font-size: 12px; color: #6e665c; line-height: 1.6; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">Real Real Genuine</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Today on RRG</p>
      <h1>A summary of what arrived for you</h1>
    </div>
    <div class="body">
      <p class="intro">Your concierge keeps watch. Here is what came in over the last day that fits.</p>
      ${brandsSection}
      ${listingsSection}
    </div>
    <div class="footer-note">RRG only emails you when something genuinely fits. At most one summary per day. Quiet days stay quiet.</div>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">RRG / Real Real Genuine</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="${SITE_URL}" style="color:#6e665c;text-decoration:none;">realrealgenuine.com</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;
}

/**
 * Owner-level daily digest. Sent at most once per owner per 24h window
 * (cap enforced by the caller — the notification watcher that used to
 * live alongside this helper was deleted in the via-app fork).
 *
 * Bundles every brand-join and listing match the owner is eligible for
 * across all the agents they own. RRG-style transactional template.
 */
export async function sendOwnerDailyDigest(
  email: string,
  payload: DigestPayload,
): Promise<void> {
  if (payload.brands.length === 0 && payload.listings.length === 0) return;

  await send({
    to: email,
    subject: digestSubject(payload),
    html: digestHtml(payload),
    fromOverride: `Real Real Genuine <${DIGEST_FROM}>`,
  });
}

/**
 * Sent when an agent hits its weekly LLM-spend cap. Cream/serif RRG
 * transactional design matching sendOwnerDailyDigest. Asks the owner
 * to authorise raising the cap; until they do, the agent's LLM calls
 * are blocked for the remainder of the 7-day window.
 */
export async function sendWeeklyCapHit(
  email: string,
  agentName: string,
  match: { weeklyCapUsdc: number; weeklySpentUsdc: number },
): Promise<void> {
  const cap = match.weeklyCapUsdc.toFixed(2);
  const spent = match.weeklySpentUsdc.toFixed(4);
  const dashboardUrl = `${SITE_URL}/agents/dashboard`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #faf7f2; color: #1a1612; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  .wordmark { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 400; font-style: italic; letter-spacing: 0.01em; color: #1a1612; margin: 0 0 24px; }
  .card { background: #ffffff; border: 1px solid #e8e3db; }
  .card-head { padding: 28px 32px 24px; border-bottom: 1px solid #e8e3db; }
  .eyebrow { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #6b4f3a; margin: 0 0 8px; }
  h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 400; font-style: italic; color: #1a1612; letter-spacing: -0.01em; }
  .body { padding: 28px 32px; }
  .body p { margin: 0 0 16px; line-height: 1.6; color: #3a342d; font-size: 14px; }
  .lbl { font-family: 'Courier New', Courier, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6e665c; margin: 0 0 12px; }
  .meta { width: 100%; border: 1px solid #e8e3db; border-collapse: collapse; margin: 0 0 24px; }
  .meta td { padding: 10px 16px; font-size: 13px; border-bottom: 1px solid #e8e3db; }
  .meta tr:last-child td { border-bottom: none; }
  .meta-label { color: #6e665c; white-space: nowrap; padding-right: 16px; }
  .meta-value { color: #1a1612; font-weight: 500; text-align: right; }
  .btn { display: inline-block; background: #1a1612; color: #faf7f2; padding: 12px 22px; text-decoration: none; font-size: 12px; letter-spacing: 0.04em; font-weight: 500; }
</style></head>
<body>
<div class="wrap">
  <p class="wordmark">Real Real Genuine</p>
  <div class="card">
    <div class="card-head">
      <p class="eyebrow">Weekly cap reached</p>
      <h1>${escHtml(agentName)} has paused</h1>
    </div>
    <div class="body">
      <p>${escHtml(agentName)} reached this week's LLM cap and has stopped making calls. We do this to keep an upper bound on how much of your USDC the platform will pull back to cover the cost of running your concierge.</p>
      <p class="lbl">This week's usage</p>
      <table class="meta" cellpadding="0" cellspacing="0"><tbody>
        <tr><td class="meta-label">Weekly cap</td><td class="meta-value">$${cap} USDC</td></tr>
        <tr><td class="meta-label">Spent this week</td><td class="meta-value">$${spent} USDC</td></tr>
      </tbody></table>
      <p>If you want ${escHtml(agentName)} to keep working this week, raise the cap from your dashboard. The new cap applies immediately and resets at the end of the current 7-day window.</p>
      <a class="btn" href="${dashboardUrl}">Raise the cap</a>
    </div>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e3db;"><tbody><tr>
    <td style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;">RRG / Real Real Genuine</td>
    <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#6e665c;text-align:right;"><a href="${SITE_URL}" style="color:#6e665c;text-decoration:none;">realrealgenuine.com</a></td>
  </tr></tbody></table>
</div>
</body>
</html>`;

  await send({
    to: email,
    subject: `${agentName} reached this week's LLM cap on RRG`,
    html,
    fromOverride: `Real Real Genuine <${DIGEST_FROM}>`,
  });
}

export async function sendLowBalance(
  email: string,
  agentName: string,
  balance: number
) {
  await send({
    to: email,
    subject: `${agentName}: low USDC balance ($${balance.toFixed(2)})`,
    html: `
      <div style="font-family: sans-serif; color: #ededed; background: #0a0a0a; padding: 32px;">
        <h2 style="color: #fff;">Low balance warning</h2>
        <p><strong>${agentName}</strong>'s wallet balance is <strong>$${balance.toFixed(2)} USDC</strong>, which is below your budget ceiling.</p>
        <p style="color: #999;">Top up your agent's wallet to ensure it can bid on upcoming drops.</p>
      </div>
    `,
  });
}
