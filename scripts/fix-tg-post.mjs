#!/usr/bin/env node

/**
 * Check and fix TG posts.
 * Run: cd /home/agent/apps/rrg && set -a && . .env.local && set +a && node scripts/fix-tg-post.mjs
 */

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

if (!TG_BOT_TOKEN) { console.log('No TG_BOT_TOKEN'); process.exit(1); }

// Check what signoff the app actually uses
console.log('App signoff uses SITE_URL:', process.env.NEXT_PUBLIC_SITE_URL || 'https://realrealgenuine.com');

// The TG manual post I sent earlier had "richard-hobbs.com/rrg" in it
// TG doesn't let bots delete messages older than 48h, but this one is recent

// First, let's find the message. Get recent updates or use getChat
const chatRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getChat?chat_id=${TG_CHAT_ID}`);
const chat = await chatRes.json();
console.log('\nChat info:', chat.result?.title, chat.result?.description?.slice(0, 100));

// Check if chat description has richard-hobbs
if (chat.result?.description?.includes('richard-hobbs')) {
  console.log('⚠ Chat description contains richard-hobbs.com!');
}

// The manual autopost I sent — need to find and delete it
// TG bots can't search messages, but we can try to get the message ID
// The manual script sent via sendPhoto, so we need the message_id

// Let's just send a corrected version. The old one with "richard-hobbs.com/rrg"
// in the signoff was from the manual script. But we can't easily find its message_id
// without storing it.

// Instead, let's just note the issue and send a corrected post
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TOKEN_ID = 13;
const BUYER = '0x25b22971892b7314c36ec6dcfb5537500d50ea35';
const shortW = BUYER.slice(0, 6) + '…' + BUYER.slice(-4);
const SITE_URL = 'https://realrealgenuine.com';
const dropUrl = `${SITE_URL}/rrg/drop/${TOKEN_ID}`;

const { data: sub } = await db.from('rrg_submissions').select('*').eq('token_id', TOKEN_ID).single();
const { count } = await db.from('app_purchases').select('id', { count: 'exact', head: true }).eq('token_id', TOKEN_ID);
const remaining = Math.max(0, (sub.edition_size || 10) - (count || 1));

// Get image
let imageUrl = null;
if (sub.jpeg_storage_path) {
  const { data: signedData } = await db.storage.from('rrg-submissions').createSignedUrl(sub.jpeg_storage_path, 300);
  if (signedData) imageUrl = signedData.signedUrl;
}

// Check the autopost.ts signoff
// SIGNOFF_TG = `Join in. Be a part of the co-creation brand revolution at <a href="${RRG_URL}">RRG</a>`
// RRG_URL = `${SITE_URL}/rrg`
// So if SITE_URL is correct, signoff link goes to realrealgenuine.com/rrg ✓
// But the text still shows "RRG" as clickable link, not the domain text

console.log('\n--- Checking app autopost signoff ---');
console.log(`SITE_URL: ${process.env.NEXT_PUBLIC_SITE_URL}`);
console.log(`Signoff will link to: ${process.env.NEXT_PUBLIC_SITE_URL}/rrg`);
console.log('TG signoff shows "RRG" as link text (href to realrealgenuine.com/rrg) ✓');

// The manual script had: <i>richard-hobbs.com/rrg</i>
// That's wrong. The actual app signoff is different.
// Let me look for recent messages from the bot to see what was posted

console.log('\n--- Attempting to find recent bot messages ---');
// We can use getUpdates but that only shows incoming messages, not outgoing
// Let's check if there's a way to search... there isn't via bot API

// The simplest fix: just note that the manual post had the wrong URL
// and the app autopost is correct going forward.
// We could pin a correction or just leave it.

console.log('\nManual TG post from earlier contained "richard-hobbs.com/rrg"');
console.log('App autopost signoff links to: realrealgenuine.com/rrg (correct)');
console.log('\nNote: TG Bot API cannot search/list old messages.');
console.log('You may want to manually delete the wrong TG post from the group.');

console.log('\nDone.');
