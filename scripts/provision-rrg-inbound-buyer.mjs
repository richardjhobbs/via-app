/**
 * scripts/provision-rrg-inbound-buyer.mjs
 *
 * One-time: create (or reuse) the single shared buyer that owns every intent
 * posted by RRG's personal agents via POST /api/via/partner/intent. Mirrors the
 * NOSTR inbound buyer model , one dedicated, PUBLIC buyer so untrusted partner
 * input can never spawn buyer rows on the demand feed.
 *
 * app_buyers.owner_user_id and .wallet_address are NOT NULL, so we copy them from
 * an existing template buyer (the NOSTR inbound buyer if NOSTR_INBOUND_BUYER_ID is
 * set, else the first buyer found). This buyer is discovery-only: it never signs,
 * so the copied wallet_address is a placeholder for the NOT NULL constraint.
 *
 * Idempotent: if a buyer with handle 'rrg-agents' already exists it is reused and
 * forced public=true. Prints the id to paste into RRG_INBOUND_BUYER_ID.
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Usage: node scripts/provision-rrg-inbound-buyer.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) { const k = m[1].trim(); if (!process.env[k]) process.env[k] = m[2].trim().replace(/^["']|["']$/g, ''); }
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }

const HANDLE = 'rrg-agents';
const db = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  // Already provisioned? Reuse and ensure it is public.
  const { data: existing } = await db.from('app_buyers').select('id, public').eq('handle', HANDLE).maybeSingle();
  if (existing) {
    if (!existing.public) await db.from('app_buyers').update({ public: true }).eq('id', existing.id);
    console.log(`Reused existing buyer '${HANDLE}'.`);
    console.log(`RRG_INBOUND_BUYER_ID=${existing.id}`);
    return;
  }

  // Copy the NOT NULL owner_user_id + wallet_address from a template buyer.
  const templateId = process.env.NOSTR_INBOUND_BUYER_ID;
  const tq = db.from('app_buyers').select('owner_user_id, wallet_address');
  const { data: template, error: tErr } = templateId
    ? await tq.eq('id', templateId).maybeSingle()
    : await tq.limit(1).maybeSingle();
  if (tErr || !template) { console.error('FATAL: no template buyer to copy owner_user_id / wallet_address from:', tErr?.message); process.exit(1); }

  const { data, error } = await db.from('app_buyers').insert({
    handle: HANDLE,
    display_name: 'RRG Agents',
    public: true,
    owner_user_id: template.owner_user_id,
    wallet_address: template.wallet_address,
  }).select('id').single();
  if (error || !data) { console.error('FATAL: insert failed:', error?.message); process.exit(1); }

  console.log(`Created buyer '${HANDLE}' (public=true).`);
  console.log(`RRG_INBOUND_BUYER_ID=${data.id}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
