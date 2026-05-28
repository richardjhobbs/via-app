/**
 * Manual autopost for a missed sale notification.
 * Usage: node scripts/manual-autopost.mjs <tokenId> <buyerWallet>
 */

import 'dotenv/config';

const TOKEN_ID = parseInt(process.argv[2] || '13');
const BUYER_WALLET = process.argv[3] || '0x25b22971892b7314c36ec6dcfb5537500d50ea35';

const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID   = process.env.TELEGRAM_CHAT_ID || '-5010128713';
const BSKY_HANDLE   = process.env.BLUESKY_HANDLE;
const BSKY_PASSWORD  = process.env.BLUESKY_PASSWORD;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL   = process.env.DISCORD_CHANNEL_DROPS;

// Fetch drop data from Supabase
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data: submission } = await db
  .from('rrg_submissions')
  .select('*')
  .eq('token_id', TOKEN_ID)
  .single();

if (!submission) { console.error('Drop not found'); process.exit(1); }

const { data: purchases } = await db
  .from('app_purchases')
  .select('id', { count: 'exact', head: true })
  .eq('token_id', TOKEN_ID);

const totalPurchases = purchases?.length ?? 1;
const editionSize = submission.edition_size ?? 10;
const remaining = Math.max(0, editionSize - totalPurchases);

const siteUrl = 'https://realrealgenuine.com';
const dropUrl = `${siteUrl}/rrg/drop/${TOKEN_ID}`;
const shortWallet = BUYER_WALLET.slice(0, 6) + '…' + BUYER_WALLET.slice(-4);

console.log(`\nManual autopost for: ${submission.title} (token ${TOKEN_ID})`);
console.log(`Buyer: ${BUYER_WALLET}`);
console.log(`Remaining: ${remaining}/${editionSize}`);
console.log('---');

// ── Telegram ──
if (TG_BOT_TOKEN) {
  const html = `<b>SOLD — ${submission.title}</b>\n\n` +
    `Purchased by ${shortWallet}\n` +
    `${remaining} of ${editionSize} remaining\n\n` +
    `<a href="${dropUrl}">View Drop →</a>\n\n` +
    `<i>richard-hobbs.com/rrg</i>`;

  // Try with image first
  let sent = false;
  if (submission.jpeg_storage_path) {
    const { data: signedData } = await db.storage
      .from('rrg-submissions')
      .createSignedUrl(submission.jpeg_storage_path, 300);

    if (signedData?.signedUrl) {
      const tgRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TG_CHAT_ID,
          photo: signedData.signedUrl,
          caption: html,
          parse_mode: 'HTML',
        }),
      });
      const tgData = await tgRes.json();
      if (tgData.ok) {
        console.log('✅ Telegram: sent with image');
        sent = true;
      } else {
        console.log('⚠ Telegram photo failed:', tgData.description);
      }
    }
  }

  if (!sent) {
    const tgRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });
    const tgData = await tgRes.json();
    console.log(tgData.ok ? '✅ Telegram: sent (text only)' : `❌ Telegram: ${tgData.description}`);
  }
} else {
  console.log('⏭ Telegram: no bot token');
}

// ── Bluesky ──
if (BSKY_HANDLE && BSKY_PASSWORD) {
  try {
    // Create session
    const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: BSKY_HANDLE, password: BSKY_PASSWORD }),
    });
    const session = await sessionRes.json();

    const text = `SOLD — ${submission.title}\n\nPurchased by ${shortWallet}\n${remaining} of ${editionSize} remaining\n\n${dropUrl}`;

    // Create post with link facet
    const urlStart = text.indexOf(dropUrl);
    const urlEnd = urlStart + dropUrl.length;
    const encoder = new TextEncoder();
    const byteStart = encoder.encode(text.slice(0, urlStart)).length;
    const byteEnd = byteStart + encoder.encode(dropUrl).length;

    const record = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
      facets: [{
        index: { byteStart, byteEnd },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: dropUrl }],
      }],
    };

    const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record,
      }),
    });

    const postData = await postRes.json();
    console.log(postData.uri ? '✅ Bluesky: posted' : `❌ Bluesky: ${JSON.stringify(postData)}`);
  } catch (err) {
    console.log(`❌ Bluesky: ${err.message}`);
  }
} else {
  console.log('⏭ Bluesky: no credentials');
}

// ── Discord ──
if (DISCORD_BOT_TOKEN && DISCORD_CHANNEL) {
  const embed = {
    title: `SOLD — ${submission.title}`,
    url: dropUrl,
    description: `Purchased by \`${shortWallet}\`\n${remaining} of ${editionSize} remaining`,
    color: 0x22c55e,
    footer: { text: 'richard-hobbs.com/rrg' },
  };

  const discRes = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    },
    body: JSON.stringify({ embeds: [embed] }),
  });

  const discData = await discRes.json();
  console.log(discData.id ? '✅ Discord: posted' : `❌ Discord: ${JSON.stringify(discData)}`);
} else {
  console.log('⏭ Discord: no credentials');
}

console.log('\nDone.');
