/**
 * scripts/audit-agent-wallets.mjs
 *
 * Read-only audit: for every active app_sellers / app_buyers row, derive the
 * platform agent wallet from AGENT_WALLET_SEED + id and compare it to the
 * on-record agent_wallet_address. Flags any MISMATCH (the platform-run agent
 * cannot sign for a wallet it did not derive).
 *
 * Prints ADDRESSES ONLY, never private keys.
 *
 * Requires .env.local: AGENT_WALLET_SEED, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage: node scripts/audit-agent-wallets.mjs
 */
import { ethers } from 'ethers';
import crypto from 'node:crypto';
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

const SEED = process.env.AGENT_WALLET_SEED;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SEED) { console.error('FATAL: AGENT_WALLET_SEED not set'); process.exit(1); }
if (!URL || !KEY) { console.error('FATAL: Supabase URL / service key not set'); process.exit(1); }

function deriveAgentWallet(id) {
  for (let i = 0; i < 8; i++) {
    const pk = '0x' + crypto.createHmac('sha256', SEED).update(`agent-wallet|${id}|${i}`).digest('hex');
    try { return new ethers.Wallet(pk); } catch { /* out of curve order, try next */ }
  }
  return null;
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });

function row(label, id, onRecord, derived) {
  const or = (onRecord || '').toLowerCase();
  const dv = (derived || '').toLowerCase();
  let status;
  if (!or)          status = 'NULL (no agent wallet on record)';
  else if (or === dv) status = 'MATCH';
  else              status = 'MISMATCH';
  return { label, id, on_record: or || null, derived: dv, status };
}

(async () => {
  const out = [];

  const { data: sellers, error: se } = await db
    .from('app_sellers')
    .select('id, slug, agent_wallet_address, erc8004_agent_id, active, approval_status')
    .order('slug');
  if (se) { console.error('sellers query failed:', se.message); process.exit(1); }

  for (const s of sellers ?? []) {
    const d = deriveAgentWallet(s.id);
    const r = row(`seller:${s.slug}`, s.id, s.agent_wallet_address, d?.address);
    out.push({ ...r, erc8004: s.erc8004_agent_id ?? null, active: s.active, approval: s.approval_status });
  }

  const { data: buyers, error: be } = await db
    .from('app_buyers')
    .select('id, handle, agent_wallet_address')
    .order('handle');
  if (be) { console.error('buyers query failed:', be.message); process.exit(1); }

  for (const b of buyers ?? []) {
    const d = deriveAgentWallet(b.id);
    out.push(row(`buyer:${b.handle}`, b.id, b.agent_wallet_address, d?.address));
  }

  const mism = out.filter(r => r.status === 'MISMATCH');
  const nul  = out.filter(r => String(r.status).startsWith('NULL'));

  console.log('──── AGENT WALLET AUDIT ────');
  for (const r of out) {
    const tag = r.status === 'MATCH' ? 'ok  ' : r.status === 'MISMATCH' ? 'BAD ' : 'null';
    console.log(`[${tag}] ${r.label.padEnd(32)} on=${(r.on_record ?? '-').padEnd(42)} derived=${r.derived} ${r.erc8004 ? `erc8004=${r.erc8004}` : ''}`);
  }
  console.log(`\nTotals: ${out.length} rows, ${mism.length} MISMATCH, ${nul.length} NULL`);
  if (mism.length) {
    console.log('\nMISMATCH rows (platform-run agent CANNOT sign these):');
    for (const r of mism) console.log(`  ${r.label}  id=${r.id}  on_record=${r.on_record}  should_be=${r.derived}  erc8004=${r.erc8004 ?? '-'}`);
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
