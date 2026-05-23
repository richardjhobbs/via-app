/**
 * Email notifications via Resend.
 * Adapted from rrg/lib/rrg/email.ts
 */

import { Resend } from 'resend';

const FROM = process.env.FROM_EMAIL ?? 'drops@realrealgenuine.com';

function getResend() {
  return new Resend(process.env.RESEND_API_KEY ?? '');
}

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

async function send({ to, subject, html }: EmailParams) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email-stub] To: ${to} | Subject: ${subject}`);
    return;
  }

  await getResend().emails.send({
    from: `VIA Drops <${FROM}>`,
    to,
    subject,
    html,
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
 * Daily digest sent by the drop-match watcher when, and only when, the
 * scan wrote new match_found notifications for this agent in the current
 * run. Bundles every match into one email so it is not spammy: at most
 * one of these arrives per agent per day, and only on days with hits.
 */
export async function sendMatchDigest(
  email: string,
  agentName: string,
  matches: Array<{ title: string; brandName: string | null; url: string; priceUsdc: number | null; reason: string }>,
) {
  if (matches.length === 0) return;

  const rows = matches.map(m => {
    const price = m.priceUsdc != null ? ` &middot; $${m.priceUsdc.toFixed(2)} USDC` : '';
    const brand = m.brandName ? `<span style="color:#999">${m.brandName}</span> ` : '';
    return `
      <div style="background:#1a1a1a; padding:14px 16px; border-radius:8px; margin:10px 0;">
        <div style="font-size:15px; margin-bottom:4px;">${brand}<strong>${m.title}</strong>${price}</div>
        <div style="color:#bbb; font-size:13px; margin-bottom:10px;">${m.reason}</div>
        <a href="${m.url}" style="color:#60a5fa; font-size:13px; text-decoration:none;">View on RRG &rarr;</a>
      </div>
    `;
  }).join('');

  const count = matches.length;
  const subject = count === 1
    ? `${agentName}: 1 new drop matches your taste`
    : `${agentName}: ${count} new drops match your taste`;

  await send({
    to: email,
    subject,
    html: `
      <div style="font-family: sans-serif; color: #ededed; background: #0a0a0a; padding: 32px;">
        <h2 style="color: #fff; margin:0 0 8px;">${count === 1 ? 'A drop landed' : `${count} drops landed`}</h2>
        <p style="color:#bbb; margin:0 0 20px;">${agentName} flagged ${count === 1 ? 'this' : 'these'} from today's catalogue against the brands and styles you've shared.</p>
        ${rows}
        <p style="color:#666; font-size:12px; margin-top:24px;">You're only getting this email because there were matches today. Days with nothing new go silent.</p>
      </div>
    `,
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
