/**
 * scripts/fund-agent-float.mjs
 *
 * Operator tool: top up a VIA seller's platform-derived agent wallet with a small
 * USDC float so it can pay the x402 door micro-fee. Funds from the platform
 * treasury (PLATFORM_PRIVATE_KEY, wallet 0xbfd71e). Mirrors lib/app/agent-funding.ts
 * (which runs this automatically on store approval); this script is for one-off /
 * backfill funding of sellers approved before that hook existed (eli, sentient).
 *
 * Looks up agent_wallet_address from app_sellers by --slug so the amount always
 * lands on the wallet the agent actually signs with.
 *
 * Usage: node scripts/fund-agent-float.mjs --slug eli-s-artisan-bakery [--amount 0.1] [--dry-run]
 * Requires .env.local: PLATFORM_PRIVATE_KEY, NEXT_PUBLIC_BASE_RPC_URL,
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) { const k = m[1].trim(); if (!process.env[k]) process.env[k] = m[2].trim().replace(/^["']|["']$/g, ''); }
}

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || true) : null; };
const SLUG = flag('--slug');
const AMOUNT = Number(flag('--amount') || '0.1');
const DRY = args.includes('--dry-run');
if (!SLUG || typeof SLUG !== 'string') { console.error('Usage: node scripts/fund-agent-float.mjs --slug <slug> [--amount 0.5] [--dry-run]'); process.exit(1); }

const RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL;
const PK = process.env.PLATFORM_PRIVATE_KEY;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!RPC || !PK) { console.error('FATAL: NEXT_PUBLIC_BASE_RPC_URL / PLATFORM_PRIVATE_KEY required'); process.exit(1); }
if (!SB_URL || !SB_KEY) { console.error('FATAL: Supabase URL / service key required'); process.exit(1); }

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const provider = new ethers.JsonRpcProvider(RPC);
const treasury = new ethers.Wallet(PK, provider);
const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

(async () => {
  const { data: seller, error } = await db
    .from('app_sellers')
    .select('slug, agent_wallet_address')
    .eq('slug', SLUG)
    .single();
  if (error || !seller) { console.error(`FATAL: seller "${SLUG}" not found: ${error?.message}`); process.exit(1); }
  if (!seller.agent_wallet_address) { console.error(`FATAL: ${SLUG} has no agent_wallet_address`); process.exit(1); }

  const usdc = new ethers.Contract(USDC, [
    'function transfer(address,uint256) returns(bool)',
    'function balanceOf(address) view returns(uint256)',
  ], treasury);
  const amount6 = BigInt(Math.round(AMOUNT * 1_000_000));
  const tbal = await usdc.balanceOf(treasury.address);
  console.log(`treasury ${treasury.address} USDC ${ethers.formatUnits(tbal, 6)}`);
  console.log(`target   ${SLUG} -> ${seller.agent_wallet_address}  amount ${AMOUNT} USDC  (dry-run: ${DRY ? 'YES' : 'no'})`);
  if (DRY) return;
  if (tbal < amount6) { console.error('FATAL: treasury USDC below float amount'); process.exit(1); }

  const before = await usdc.balanceOf(seller.agent_wallet_address);
  const tx = await usdc.transfer(seller.agent_wallet_address, amount6);
  console.log(`fund tx ${tx.hash} …`);
  await tx.wait(1);
  const after = await usdc.balanceOf(seller.agent_wallet_address);
  console.log(`✓ ${SLUG} USDC ${ethers.formatUnits(after, 6)} (was ${ethers.formatUnits(before, 6)})`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
