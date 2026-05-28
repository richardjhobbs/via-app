#!/usr/bin/env node

/**
 * Delete wrong BSky post and repost with image.
 * Also update BSky profile to use realrealgenuine.com.
 * Run: cd /home/agent/apps/rrg && set -a && . .env.local && set +a && node scripts/fix-bsky-post.mjs
 */

const TOKEN_ID = 13;
const BUYER = '0x25b22971892b7314c36ec6dcfb5537500d50ea35';
const shortW = BUYER.slice(0, 6) + '…' + BUYER.slice(-4);
const SITE_URL = 'https://realrealgenuine.com';
const dropUrl = `${SITE_URL}/rrg/drop/${TOKEN_ID}`;

const BSKY_HANDLE = process.env.BSKY_HANDLE;
const BSKY_APP_PASS = process.env.BSKY_APP_PASS;

if (!BSKY_HANDLE || !BSKY_APP_PASS) {
  console.log('Missing BSKY_HANDLE or BSKY_APP_PASS');
  process.exit(1);
}

// ── Auth ──
const sessRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: BSKY_HANDLE, password: BSKY_APP_PASS }),
});
const session = await sessRes.json();
if (!session.accessJwt) { console.log('Auth failed:', session); process.exit(1); }
const jwt = session.accessJwt;
const did = session.did;
console.log(`Authenticated as ${did}`);

// ── Step 1: Find and delete the wrong EB Mask post ──
console.log('\nFinding recent posts...');
const feedRes = await fetch(`https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?actor=${did}&limit=10`, {
  headers: { Authorization: `Bearer ${jwt}` },
});
const feed = await feedRes.json();

for (const item of feed.feed || []) {
  const post = item.post;
  if (post.record?.text?.includes('EB Mask')) {
    console.log(`Found EB Mask post: ${post.uri}`);
    // Extract rkey from URI
    const rkey = post.uri.split('/').pop();
    const delRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.deleteRecord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', rkey }),
    });
    console.log(delRes.ok ? `  Deleted: ${rkey}` : `  Delete failed: ${await delRes.text()}`);
  }
}

// ── Step 2: Get image and upload as blob ──
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data: sub } = await db.from('rrg_submissions').select('*').eq('token_id', TOKEN_ID).single();
const { count } = await db.from('app_purchases').select('id', { count: 'exact', head: true }).eq('token_id', TOKEN_ID);
const remaining = Math.max(0, (sub.edition_size || 10) - (count || 1));

let blobRef = null;
if (sub.jpeg_storage_path) {
  const { data: signedData } = await db.storage.from('rrg-submissions').createSignedUrl(sub.jpeg_storage_path, 300);
  if (signedData?.signedUrl) {
    console.log('\nDownloading image...');
    const imgResp = await fetch(signedData.signedUrl);
    if (imgResp.ok) {
      const buf = await imgResp.arrayBuffer();
      const mimeType = imgResp.headers.get('content-type') || 'image/jpeg';
      console.log(`Image: ${buf.byteLength} bytes, ${mimeType}`);

      console.log('Uploading blob to BSky...');
      const uploadRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
        method: 'POST',
        headers: { 'Content-Type': mimeType, Authorization: `Bearer ${jwt}` },
        body: buf,
      });
      if (uploadRes.ok) {
        const { blob } = await uploadRes.json();
        blobRef = blob;
        console.log('Blob uploaded:', blob.ref.$link);
      } else {
        console.log('Blob upload failed:', await uploadRes.text());
      }
    }
  }
}

// ── Step 3: Create correct post with image ──
const text = `💸 Sold! — ${sub.title}\n\n${shortW} just purchased ${sub.title}.\n${remaining} of ${sub.edition_size || 10} remaining.\n\n${dropUrl}`;

const enc = new TextEncoder();
const urlStart = text.indexOf(dropUrl);
const byteStart = enc.encode(text.slice(0, urlStart)).length;
const byteEnd = byteStart + enc.encode(dropUrl).length;

const record = {
  $type: 'app.bsky.feed.post',
  text,
  createdAt: new Date().toISOString(),
  facets: [{
    index: { byteStart, byteEnd },
    features: [{ $type: 'app.bsky.richtext.facet#link', uri: dropUrl }],
  }],
};

if (blobRef) {
  record.embed = {
    $type: 'app.bsky.embed.images',
    images: [{ image: blobRef, alt: sub.title }],
  };
}

const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record }),
});
const postData = await postRes.json();
console.log(postData.uri ? `\n✅ BSky: posted with image` : `\n❌ BSky: ${JSON.stringify(postData)}`);

// ── Step 4: Update profile description to use realrealgenuine.com ──
console.log('\nUpdating profile...');
const profileRes = await fetch(`https://bsky.social/xrpc/app.bsky.actor.getProfile?actor=${did}`, {
  headers: { Authorization: `Bearer ${jwt}` },
});
const profile = await profileRes.json();
console.log(`Current description: ${profile.description}`);

// Read current profile record
const getRes = await fetch(`https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.actor.profile&rkey=self`, {
  headers: { Authorization: `Bearer ${jwt}` },
});
const profileRecord = await getRes.json();

// Update description — replace richard-hobbs.com/rrg with realrealgenuine.com
const oldDesc = profileRecord.value.description || '';
const newDesc = oldDesc.replace(/richard-hobbs\.com\/rrg/g, 'realrealgenuine.com');

if (oldDesc !== newDesc) {
  const updatedValue = { ...profileRecord.value, description: newDesc };
  const putRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.putRecord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      repo: did,
      collection: 'app.bsky.actor.profile',
      rkey: 'self',
      record: updatedValue,
    }),
  });
  console.log(putRes.ok ? '✅ Profile updated: realrealgenuine.com' : `❌ Profile update failed: ${await putRes.text()}`);
} else {
  console.log('Profile already correct (no richard-hobbs.com/rrg found)');
}

console.log('\nDone.');
