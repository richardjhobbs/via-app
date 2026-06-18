/**
 * scripts/topup-seller-floats.mjs
 *
 * Maintenance: top every seller-agent roster wallet back up to a USDC floor
 * (default 0.10) so each can pay the VIA x402 door micro-fee. Funds the
 * shortfall (floor - current balance) from the platform treasury
 * (PLATFORM_PRIVATE_KEY, 0xbfd71e). Wallets already at/above the floor are
 * skipped. Mirrors lib/app/agent-funding.ts but sweeps the whole roster.
 *
 * Roster = the 15 seller-agent.mjs sellers: 3 VIA (derived from AGENT_WALLET_SEED
 * + store id) + 12 RRG (static payer addresses, same as place-seller-keys.mjs).
 *
 * Usage: node scripts/topup-seller-floats.mjs [--floor 0.10] [--dry-run]
 * Requires .env.local: PLATFORM_PRIVATE_KEY, AGENT_WALLET_SEED,
 * NEXT_PUBLIC_BASE_RPC_URL.
 */
import { ethers } from 'ethers';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) { const k = m[1].trim(); if (!process.env[k]) process.env[k] = m[2].trim().replace(/^["']|["']$/g, ''); }
}

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || true) : null; };
const FLOOR = Number(flag('--floor') || '0.10');
const DRY = args.includes('--dry-run');

const RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL;
const PK = process.env.PLATFORM_PRIVATE_KEY;
const SEED = process.env.AGENT_WALLET_SEED;
if (!RPC || !PK) { console.error('FATAL: NEXT_PUBLIC_BASE_RPC_URL / PLATFORM_PRIVATE_KEY required'); process.exit(1); }
if (!SEED) { console.error('FATAL: AGENT_WALLET_SEED required (for the 3 VIA wallets)'); process.exit(1); }

function deriveAgentWallet(id) {
  for (let i = 0; i < 8; i++) {
    const pk = '0x' + crypto.createHmac('sha256', SEED).update(`agent-wallet|${id}|${i}`).digest('hex');
    try { return new ethers.Wallet(pk); } catch { /* out of curve order */ }
  }
  return null;
}

// VIA: derive from store id. RRG: static payer addresses (place-seller-keys.mjs).
const VIA = [
  { slug: 'drhobbs-knowledge',    id: 'dd0e81fd-586b-4196-99f3-5f3ed2974ad6' },
  { slug: 'eli-s-artisan-bakery', id: 'e6a32d65-c452-4e07-9393-4fd4c8e8fd6e' },
  { slug: 'the-sentient-startup', id: '0296cc76-6e88-4459-b978-aea036a893d7' },
];
const RRG = [
  { slug: 'clooudie',                addr: '0xca5c9c4da1787fea491ed6c94e86b04ec46be61d' },
  { slug: 'nolo',                    addr: '0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d' },
  { slug: 'tyo',                     addr: '0xf78cb04c28e1898638ee4322f4b7b91ee8c0db00' },
  { slug: 'university-of-diversity', addr: '0xb8ca93c837cdcb09ab7e0d61a740fd95d25d7961' },
  { slug: 'les-basics',              addr: '0x8d566ed9a15f38439465405f654416f1276f25b3' },
  { slug: 'gumball-3000',            addr: '0x154bbd968dece4957c7604c8188a8048888de3f9' },
  { slug: 'philleywood',             addr: '0x35df756e97efd1db987e192ccefbf1b210bf4179' },
  { slug: 'pitchers-only',           addr: '0x03e1fc8bf74e11a1fb75d7fc54c1b613fd627d9d' },
  { slug: 'livvium',                 addr: '0x52b406dd49e8fe0cc147e73f1c16ee04530241f5' },
  { slug: 'jennys',                  addr: '0xe206d575572e563a490f4f63e7f8c45b11f87dd6' },
  { slug: 'frey-tailored',           addr: '0x30b1e8cc377a75d9664c26415a820c4925afa595' },
  { slug: 'unknown-union',           addr: '0xe9cedf6453b61771505404b47671602eaa158881' },
];

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const provider = new ethers.JsonRpcProvider(RPC);
const treasury = new ethers.Wallet(PK, provider);
const usdc = new ethers.Contract(USDC, [
  'function transfer(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
], treasury);

const floor6 = BigInt(Math.round(FLOOR * 1_000_000));
const DUST6 = 1000n; // ignore shortfalls under 0.001 USDC

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function bal(addr) {
  for (let i = 0; i < 10; i++) {
    try { return await usdc.balanceOf(addr); } catch { await sleep(2000 + i * 500); }
  }
  throw new Error(`balanceOf failed for ${addr}`);
}

(async () => {
  const roster = [
    ...VIA.map(v => ({ slug: v.slug, addr: deriveAgentWallet(v.id).address })),
    ...RRG,
  ];

  console.log(`──── SELLER FLOAT TOP-UP (floor ${FLOOR} USDC) ────  (dry-run: ${DRY ? 'YES' : 'no'})`);
  const plan = [];
  for (const r of roster) {
    const b = await bal(r.addr);
    const short = floor6 > b ? floor6 - b : 0n;
    plan.push({ ...r, b, short });
    const tag = short >= DUST6 ? `TOP +${ethers.formatUnits(short, 6)}` : 'ok';
    console.log(`  ${r.slug.padEnd(24)} ${r.addr} bal=${ethers.formatUnits(b, 6).padStart(8)}  ${tag}`);
  }

  const fund = plan.filter(p => p.short >= DUST6);
  const total = fund.reduce((a, p) => a + p.short, 0n);
  const tbal = await bal(treasury.address);
  console.log(`\nNeed top-up: ${fund.length} wallets, total ${ethers.formatUnits(total, 6)} USDC`);
  console.log(`Treasury ${treasury.address} USDC ${ethers.formatUnits(tbal, 6)}`);
  if (tbal < total) console.log(`WARNING: treasury short by ${ethers.formatUnits(total - tbal, 6)} USDC; will fund in roster order until exhausted.`);
  if (DRY) { console.log('\nDRY RUN , no transfers sent.'); return; }
  if (!fund.length) { console.log('\nNothing to do , all wallets at/above floor.'); return; }

  let spent = 0n;
  for (const p of fund) {
    const liveT = await bal(treasury.address);
    if (liveT < p.short) { console.log(`  SKIP ${p.slug} , treasury insufficient (${ethers.formatUnits(liveT, 6)} < ${ethers.formatUnits(p.short, 6)})`); continue; }
    const tx = await usdc.transfer(p.addr, p.short);
    await tx.wait(1);
    spent += p.short;
    console.log(`  ✓ ${p.slug.padEnd(24)} +${ethers.formatUnits(p.short, 6)} USDC  tx=${tx.hash}`);
  }
  console.log(`\nDone. Sent ${ethers.formatUnits(spent, 6)} USDC across ${fund.length} wallets.`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
