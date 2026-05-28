#!/usr/bin/env node

/**
 * Delete wrong Discord posts and repost with correct URLs.
 * Run: cd /home/agent/apps/rrg && set -a && . .env.local && set +a && node scripts/fix-discord-posts.mjs
 */

const DISCORD_CHANNEL = '1482200038896828678';
const discToken = process.env.DISCORD_BOT_TOKEN;
if (!discToken) { console.log('No DISCORD_BOT_TOKEN'); process.exit(1); }

const TOKEN_ID = 13;
const BUYER = '0x25b22971892b7314c36ec6dcfb5537500d50ea35';
const shortW = BUYER.slice(0, 6) + '…' + BUYER.slice(-4);
const SITE_URL = 'https://realrealgenuine.com';
const dropUrl = `${SITE_URL}/rrg/drop/${TOKEN_ID}`;

// ── Step 1: Find and delete recent bot messages ──
console.log('Fetching recent messages...');
const msgsRes = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages?limit=20`, {
  headers: { Authorization: `Bot ${discToken}` },
});
const msgs = await msgsRes.json();

// Delete messages that contain "richard-hobbs.com" or "EB Mask" from the bot
let deleted = 0;
for (const msg of msgs) {
  if (!msg.author?.bot) continue;
  const text = JSON.stringify(msg);
  if (text.includes('EB Mask') && (text.includes('richard-hobbs.com') || text.includes('SOLD'))) {
    console.log(`Deleting msg ${msg.id} from ${msg.timestamp}`);
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages/${msg.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bot ${discToken}` },
    });
    deleted++;
    await new Promise(r => setTimeout(r, 500)); // rate limit
  }
}
console.log(`Deleted ${deleted} messages.`);

// ── Step 2: Post correct sale notification with image ──
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data: sub } = await db.from('rrg_submissions').select('*').eq('token_id', TOKEN_ID).single();
const { count } = await db.from('app_purchases').select('id', { count: 'exact', head: true }).eq('token_id', TOKEN_ID);
const remaining = Math.max(0, (sub.edition_size || 10) - (count || 1));

// Get image
let imageBuffer = null;
if (sub.jpeg_storage_path) {
  const { data: signedData } = await db.storage.from('rrg-submissions').createSignedUrl(sub.jpeg_storage_path, 300);
  if (signedData?.signedUrl) {
    const imgResp = await fetch(signedData.signedUrl, { signal: AbortSignal.timeout(15_000) });
    if (imgResp.ok) imageBuffer = Buffer.from(await imgResp.arrayBuffer());
  }
}

const embed = {
  title: `Sold! — ${sub.title}`,
  url: dropUrl,
  description: [
    `\`${shortW}\` just purchased **${sub.title}**.`,
    `**${remaining}** editions remaining.`,
  ].join('\n\n'),
  color: 0xFFD600,
};

if (imageBuffer) {
  embed.image = { url: 'attachment://drop.jpg' };
  const boundary = `----DiscordBoundary${Date.now()}`;
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
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Authorization: `Bot ${discToken}` },
    body,
  });
  const d = await r.json();
  console.log(d.id ? `✅ Discord: posted with image (${d.id})` : `❌ Discord: ${JSON.stringify(d)}`);
} else {
  const r = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bot ${discToken}` },
    body: JSON.stringify({ content: '💸 **RRG Sale**', embeds: [embed] }),
  });
  const d = await r.json();
  console.log(d.id ? `✅ Discord: posted (${d.id})` : `❌ Discord: ${JSON.stringify(d)}`);
}

console.log('Done.');
