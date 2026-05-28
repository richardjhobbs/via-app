#!/usr/bin/env node
// Backfills app_purchases.network based on verified-on-chain reality, then optionally deletes
// the Sepolia rows (testnet, no accounting value).
//
// Usage:
//   node scripts/fix-purchases-network.mjs --dry-run    (default; reports what would change)
//   node scripts/fix-purchases-network.mjs --apply      (executes UPDATE and DELETE)
//
// Verification: each tx_hash queried on both Base mainnet and Base Sepolia via Blockscout V2.
// - Found on mainnet  -> network = 'base'
// - Found on sepolia  -> network = 'base-sepolia' (then deleted)
// - Orphan (neither)  -> left untouched, reported for manual review

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Read Supabase creds from .env.local
const ENV_PATH = process.env.RRG_ENV_PATH || '.env.local';
const env = Object.fromEntries(readFileSync(ENV_PATH, 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const i = l.indexOf('=');
  return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
}));
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

console.error(`Mode: ${APPLY ? 'APPLY (will UPDATE and DELETE)' : 'DRY RUN (no writes)'}`);

const { data: rows, error } = await sb
  .from('app_purchases')
  .select('id, created_at, tx_hash, network, amount_usdc, buyer_wallet, token_id')
  .order('created_at', { ascending: false });
if (error) throw error;
console.error(`Loaded ${rows.length} rows from app_purchases.`);

async function fetchJson(url) {
  const r = await fetch(url);
  return r.json();
}
async function lookup(hash, chainHost) {
  try {
    const tx = await fetchJson(`https://${chainHost}/api/v2/transactions/${hash}`);
    return tx && tx.hash ? true : false;
  } catch { return false; }
}

console.error('Verifying every tx_hash on both chains...');
const verified = new Map(); // id -> { actual: 'base'|'base-sepolia'|'orphan' }
for (let i = 0; i < rows.length; i += 8) {
  const chunk = rows.slice(i, i + 8);
  const results = await Promise.all(chunk.flatMap(r => [
    lookup(r.tx_hash, 'base.blockscout.com').then(found => ({ id: r.id, chain: 'mainnet', found })),
    lookup(r.tx_hash, 'base-sepolia.blockscout.com').then(found => ({ id: r.id, chain: 'sepolia', found })),
  ]));
  for (const { id, chain, found } of results) {
    if (!verified.has(id)) verified.set(id, { mainnet: false, sepolia: false });
    verified.get(id)[chain] = found;
  }
  process.stderr.write(`  verified ${Math.min(i + 8, rows.length)}/${rows.length}\n`);
}

const toUpdateToBase = [];     // verified mainnet, network != 'base'
const toUpdateToSepolia = [];  // verified sepolia, network != 'base-sepolia'
const toDelete = [];           // verified sepolia (after backfill, all such rows get deleted)
const orphans = [];            // not on either chain
const unchanged = [];          // already correct, mainnet

for (const r of rows) {
  const v = verified.get(r.id);
  if (v.mainnet) {
    if (r.network !== 'base') toUpdateToBase.push(r);
    else unchanged.push(r);
  } else if (v.sepolia) {
    if (r.network !== 'base-sepolia') toUpdateToSepolia.push(r);
    toDelete.push(r);
  } else {
    orphans.push(r);
  }
}

console.error(`\n=== Plan ===`);
console.error(`Update network='base'           : ${toUpdateToBase.length} rows`);
console.error(`Update network='base-sepolia'   : ${toUpdateToSepolia.length} rows`);
console.error(`Delete (verified Sepolia)       : ${toDelete.length} rows`);
console.error(`Orphans (not on either chain)   : ${orphans.length} rows (untouched)`);
console.error(`Unchanged (already correct base): ${unchanged.length} rows`);

if (orphans.length > 0) {
  console.error(`\nOrphan rows (manual review needed):`);
  for (const r of orphans) {
    console.error(`  ${r.created_at.slice(0,10)}  id=${r.id}  tx=${r.tx_hash}  network=${r.network}  $${r.amount_usdc}`);
  }
}

if (!APPLY) {
  console.error(`\nDry run complete. To apply, re-run with --apply.`);
  process.exit(0);
}

console.error(`\n=== Applying ===`);

if (toUpdateToBase.length > 0) {
  for (const r of toUpdateToBase) {
    const { error: e } = await sb.from('app_purchases').update({ network: 'base' }).eq('id', r.id);
    if (e) console.error(`  UPDATE failed for ${r.id}: ${e.message}`);
  }
  console.error(`  updated ${toUpdateToBase.length} rows to network='base'`);
}

if (toUpdateToSepolia.length > 0) {
  for (const r of toUpdateToSepolia) {
    const { error: e } = await sb.from('app_purchases').update({ network: 'base-sepolia' }).eq('id', r.id);
    if (e) console.error(`  UPDATE failed for ${r.id}: ${e.message}`);
  }
  console.error(`  updated ${toUpdateToSepolia.length} rows to network='base-sepolia'`);
}

if (toDelete.length > 0) {
  for (const r of toDelete) {
    const { error: e } = await sb.from('app_purchases').delete().eq('id', r.id);
    if (e) console.error(`  DELETE failed for ${r.id}: ${e.message}`);
  }
  console.error(`  deleted ${toDelete.length} Sepolia rows`);
}

console.error(`\nDone.`);
