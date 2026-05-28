#!/usr/bin/env node

/**
 * Repost Discord sale with image for EB Mask (token 13).
 * Run: cd /home/agent/apps/rrg && set -a && . .env.local && set +a && node scripts/repost-discord-sale.mjs
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

const discToken = process.env.DISCORD_BOT_TOKEN;
if (!discToken) { console.log('No DISCORD_BOT_TOKEN'); process.exit(1); }

if (!imageUrl) {
  console.log('No image URL — posting without image');
  const embed = {
    title: `Sold! — ${sub.title}`,
    url: dropUrl,
    description: `\`${shortW}\` just purchased **${sub.title}**.\n\n**${remaining}** editions remaining.`,
    color: 0xFFD600,
    footer: { text: 'richard-hobbs.com/rrg' },
  };
  const r = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bot ${discToken}` },
    body: JSON.stringify({ content: '💸 **RRG Sale**', embeds: [embed] }),
  });
  const d = await r.json();
  console.log(d.id ? '✅ Discord: posted (no image)' : `❌ Discord: ${JSON.stringify(d)}`);
  process.exit(0);
}

// Download image
console.log('Downloading image...');
const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
if (!imgResp.ok) { console.log('Image download failed'); process.exit(1); }
const imageBuffer = Buffer.from(await imgResp.arrayBuffer());
console.log(`Image downloaded: ${imageBuffer.length} bytes`);

// Multipart upload with image
const boundary = `----DiscordBoundary${Date.now()}`;
const embed = {
  title: `Sold! — ${sub.title}`,
  url: dropUrl,
  description: `\`${shortW}\` just purchased **${sub.title}**.\n\n**${remaining}** editions remaining.`,
  color: 0xFFD600,
  image: { url: 'attachment://drop.jpg' },
  footer: { text: 'richard-hobbs.com/rrg' },
};

const jsonPayload = JSON.stringify({ content: '💸 **RRG Sale**', embeds: [embed] });
const parts = [
  `--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${jsonPayload}\r\n`,
  `--${boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="drop.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
];

const body = Buffer.concat([
  Buffer.from(parts[0]),
  Buffer.from(parts[1]),
  imageBuffer,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);

const r = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    Authorization: `Bot ${discToken}`,
  },
  body,
  signal: AbortSignal.timeout(15_000),
});

if (r.ok) {
  const d = await r.json();
  console.log(`✅ Discord: posted with image (msg ${d.id})`);
} else {
  console.log(`❌ Discord (${r.status}):`, await r.text());
}
