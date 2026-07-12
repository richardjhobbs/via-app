/**
 * scripts/seed-backroom-from-event.mjs
 *
 * Seed a Back Room from an event guest list. The events funnel already turns
 * humans into Buying Agents (app_event_guests, each linked to an app_buyers
 * row); this takes those guests and forms them into a room as founding members.
 *
 * Reuses the framework: the room and members are the app_rooms / app_room_members
 * rows from migration 0036, and members are added through the app_join_room RPC
 * so the cap, dedup and (for founders) the vouch bypass all apply unchanged.
 * Founders carry no vouched_by; later members grow the room by vouching.
 *
 * Idempotent: re-running reuses the room by name and the RPC dedups members, so
 * it is safe to run again as more guests claim passes.
 *
 * Usage:
 *   node scripts/seed-backroom-from-event.mjs <event-seller-slug>
 *   node scripts/seed-backroom-from-event.mjs ads-ai --name "ADS&AI Room" --accent "#3f6f5f"
 *   node scripts/seed-backroom-from-event.mjs ads-ai --dry-run
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (or SUPABASE_SERVICE_KEY).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ethers } from 'ethers';
import crypto from 'crypto';

// ── Load .env.local ────────────────────────────────────────────────────
try {
  for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch {
  console.error('FATAL: could not read .env.local'); process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('FATAL: Supabase env missing'); process.exit(1); }

const APP_BASE = (process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://app.getvia.xyz').replace(/\/$/, '');

// ── Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
function flag(name, def = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
}
const dryRun = args.includes('--dry-run');
if (!slug) { console.error('Usage: node scripts/seed-backroom-from-event.mjs <event-seller-slug> [--name "..."] [--accent "#hex"] [--dry-run]'); process.exit(1); }

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Platform-derived room agent wallet (mirrors lib/app/agent-wallet.ts). A room
// is MCP-autonomous, so its identity/settlement wallet is derived from the
// platform seed + room id, never a human wallet. Returns null if the seed is unset.
function deriveRoomWallet(id) {
  const seed = process.env.AGENT_WALLET_SEED;
  if (!seed) return null;
  for (let i = 0; i < 8; i++) {
    const pk = '0x' + crypto.createHmac('sha256', seed).update(`agent-wallet|${id}|${i}`).digest('hex');
    try { return new ethers.Wallet(pk); } catch { /* out of curve order, try next */ }
  }
  return null;
}

async function main() {
  // 1. The event store.
  const { data: seller } = await db.from('app_sellers').select('id, name, slug').eq('slug', slug).maybeSingle();
  if (!seller) { console.error(`No event store with slug "${slug}"`); process.exit(1); }

  // 2. Its confirmed guests that became Buying Agents (have a buyer_id).
  const { data: guests } = await db
    .from('app_event_guests')
    .select('buyer_id, name, email, app_buyers!inner ( handle, wallet_address )')
    .eq('seller_id', seller.id)
    .eq('status', 'confirmed')
    .not('buyer_id', 'is', null);
  const members = [];
  const seen = new Set();
  for (const g of guests ?? []) {
    const b = Array.isArray(g.app_buyers) ? g.app_buyers[0] : g.app_buyers;
    const handle = b?.handle;
    if (handle && !seen.has(handle)) { seen.add(handle); members.push({ handle, name: g.name, wallet: b?.wallet_address ?? null }); }
  }
  if (members.length === 0) { console.error(`No confirmed guest Buying Agents for "${slug}". Nobody to seed.`); process.exit(1); }

  const roomName = flag('name', `${seller.name} Room`);
  const accent = flag('accent', '#8a5a3c');

  console.log(`Event: ${seller.name} (${slug})`);
  console.log(`Guests to seed as founders: ${members.length}`);
  members.forEach((m) => console.log(`  - @${m.handle}`));
  console.log(`Room: "${roomName}"  accent ${accent}`);
  if (dryRun) { console.log('\n[dry run] no writes made.'); return; }

  // 3. Reuse a room of this name if one exists, else create it.
  let { data: room } = await db.from('app_rooms').select('id, agent_wallet_address').eq('name', roomName).maybeSingle();
  if (!room) {
    const { data: created, error } = await db
      .from('app_rooms')
      .insert({ name: roomName, accent_hex: accent, created_from: 'event' })
      .select('id, agent_wallet_address')
      .single();
    if (error) { console.error('Failed to create room:', error.message); process.exit(1); }
    room = created;
    console.log(`Created room ${room.id}`);
  } else {
    console.log(`Reusing existing room ${room.id}`);
  }

  // Give the room its platform-derived agent wallet if it has none yet.
  if (!room.agent_wallet_address) {
    const wallet = deriveRoomWallet(room.id);
    if (wallet) {
      await db.from('app_rooms').update({ agent_wallet_address: wallet.address }).eq('id', room.id);
      console.log(`Room agent wallet: ${wallet.address}`);
    } else {
      console.log('AGENT_WALLET_SEED unset: room has no agent wallet yet (set the seed, then re-run to backfill).');
    }
  } else {
    console.log(`Room agent wallet: ${room.agent_wallet_address}`);
  }

  // 4. Add each guest as a founding member through the cap/vouch RPC.
  const outcomes = {};
  for (const m of members) {
    const { data, error } = await db.rpc('app_join_room', {
      p_room_id: room.id,
      p_member_platform: 'via',
      p_member_type: 'buyer',
      p_member_ref: m.handle,
      p_vouched_by: null,
      p_is_founder: true,
    });
    const row = Array.isArray(data) ? data[0] : data;
    const outcome = error ? `error:${error.message}` : (row?.outcome ?? 'unknown');
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    // Cache the member's wallet on the row so room auth is one lookup.
    if (outcome === 'joined' && row?.member_id && m.wallet) {
      await db.from('app_room_members').update({ member_wallet: m.wallet.toLowerCase() }).eq('id', row.member_id);
    }
  }

  console.log('\nJoin outcomes:', outcomes);
  console.log(`Room MCP: ${APP_BASE}/rooms/${room.id}/mcp`);
  console.log(`Room UI:  ${APP_BASE}/room/${room.id}?handle=<member>`);
}

main().catch((e) => { console.error(e); process.exit(1); });
