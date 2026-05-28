#!/usr/bin/env node

/**
 * Manual autopost for a missed sale.
 * Run from VPS: cd /home/agent/apps/rrg && set -a && . .env.local && set +a && node scripts/manual-autopost-v2.mjs
 */

const TOKEN_ID = 13;
const BUYER = '0x25b22971892b7314c36ec6dcfb5537500d50ea35';
const shortW = BUYER.slice(0, 6) + '…' + BUYER.slice(-4);
const DISCORD_CHANNEL = '1482200038896828678';

import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data: sub } = await db.from('rrg_submissions').select('*').eq('token_id', TOKEN_ID).single();
if (!sub) { console.log('No drop'); process.exit(1); }

const { count } = await db.from('app_purchases').select('id', { count: 'exact', head: true }).eq('token_id', TOKEN_ID);
const remaining = Math.max(0, (sub.edition_size || 10) - (count || 1));
const dropUrl = `https://realrealgenuine.com/rrg/drop/${TOKEN_ID}`;

console.log(`Drop: ${sub.title}, remaining: ${remaining}/${sub.edition_size || 10}`);

// Get signed image URL
let imageUrl = null;
if (sub.jpeg_storage_path) {
  const { data: signedData } = await db.storage.from('rrg-submissions').createSignedUrl(sub.jpeg_storage_path, 300);
  if (signedData) imageUrl = signedData.signedUrl;
}

// ── Telegram ──
const tgToken = process.env.TG_BOT_TOKEN;
const tgChat = process.env.TG_CHAT_ID;
if (tgToken) {
  const html = `<b>SOLD — ${sub.title}</b>\n\nPurchased by ${shortW}\n${remaining} of ${sub.edition_size || 10} remaining\n\n<a href="${dropUrl}">View Drop →</a>\n\n<i>richard-hobbs.com/rrg</i>`;
  let ok = false;
  if (imageUrl) {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendPhoto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgChat, photo: imageUrl, caption: html, parse_mode: 'HTML' })
    });
    const d = await r.json();
    if (d.ok) { console.log('✅ TG: sent with image'); ok = true; }
    else console.log('TG photo fail:', d.description);
  }
  if (!ok) {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgChat, text: html, parse_mode: 'HTML' })
    });
    const d = await r.json();
    console.log(d.ok ? '✅ TG: sent text' : `❌ TG: ${d.description}`);
  }
} else { console.log('⏭ TG: no token'); }

// ── Bluesky ──
const bskyH = process.env.BSKY_HANDLE;
const bskyP = process.env.BSKY_APP_PASS;
if (bskyH && bskyP) {
  try {
    const sessR = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: bskyH, password: bskyP })
    });
    const sess = await sessR.json();
    if (sess.accessJwt) {
      const text = `SOLD — ${sub.title}\n\nPurchased by ${shortW}\n${remaining} of ${sub.edition_size || 10} remaining\n\n${dropUrl}`;
      const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString() };
      const postR = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.accessJwt}` },
        body: JSON.stringify({ repo: sess.did, collection: 'app.bsky.feed.post', record })
      });
      const pd = await postR.json();
      console.log(pd.uri ? '✅ BSky: posted' : `❌ BSky: ${JSON.stringify(pd)}`);
    } else { console.log('❌ BSky session fail:', JSON.stringify(sess)); }
  } catch (err) { console.log(`❌ BSky: ${err.message}`); }
} else { console.log('⏭ BSky: no creds'); }

// ── Discord ──
const discToken = process.env.DISCORD_BOT_TOKEN;
if (discToken) {
  const embed = {
    title: `SOLD — ${sub.title}`,
    url: dropUrl,
    description: `Purchased by \`${shortW}\`\n${remaining} of ${sub.edition_size || 10} remaining`,
    color: 0x22c55e,
    footer: { text: 'richard-hobbs.com/rrg' },
  };
  const r = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bot ${discToken}` },
    body: JSON.stringify({ embeds: [embed] })
  });
  const d = await r.json();
  console.log(d.id ? '✅ Discord: posted' : `❌ Discord: ${JSON.stringify(d)}`);
} else { console.log('⏭ Discord: no token'); }

console.log('\nDone.');
