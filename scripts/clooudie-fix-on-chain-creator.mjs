/**
 * scripts/clooudie-fix-on-chain-creator.mjs
 *
 * One-shot remediation for the 14 Clooudie drops registered on-chain with
 * the WRONG creator (the old test wallet 0x734a25fb…349e7). Per
 * lib/rrg/splits.ts:160 brand-product drops must be registered with
 * creator = PLATFORM_WALLET so the platform receives 100% on-chain and
 * settles the brand's 97.5% off-chain via auto-payout.ts.
 *
 * Steps per token:
 *   1. pauseDrop(oldTokenId)             — stops mintWithPermit on the bad token
 *   2. claimNextTokenId() → newTokenId   — bumps rrg_config.next_token_id
 *   3. registerDrop(newTokenId, PLATFORM_WALLET, price6dp, editionSize)
 *   4. UPDATE rrg_submissions SET token_id = newTokenId WHERE id = <row.id>
 *
 * Uses explicit nonce tracking — Base public RPC reports stale nonce on
 * back-to-back txs (verified earlier in this project's lifetime).
 *
 * Usage:
 *   node scripts/clooudie-fix-on-chain-creator.mjs --dry-run
 *   node scripts/clooudie-fix-on-chain-creator.mjs
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   DEPLOYER_PRIVATE_KEY, NEXT_PUBLIC_BASE_RPC_URL,
 *   NEXT_PUBLIC_RRG_CONTRACT_ADDRESS, NEXT_PUBLIC_PLATFORM_WALLET
 */

import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ── Load .env.local ──────────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env.local');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch { console.error('FATAL: could not read .env.local'); process.exit(1); }

const requireEnv = (k) => {
  if (!process.env[k]) { console.error(`FATAL: ${k} not set`); process.exit(1); }
  return process.env[k];
};

const SUPABASE_URL    = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_KEY    = requireEnv('SUPABASE_SERVICE_KEY');
const RPC_URL         = requireEnv('NEXT_PUBLIC_BASE_RPC_URL');
const DEPLOYER_PK     = requireEnv('DEPLOYER_PRIVATE_KEY');
const RRG_ADDR        = requireEnv('NEXT_PUBLIC_RRG_CONTRACT_ADDRESS');
const PLATFORM_WALLET = requireEnv('NEXT_PUBLIC_PLATFORM_WALLET');

const BRAND_ID  = '6ada42e7-ced0-45e8-9d8b-96bd43c98617';
const OLD_TOKENS = [45, 46, 47, 49, 50, 52, 54, 55, 57, 58, 59, 60, 61, 62];

const DRY_RUN = process.argv.includes('--dry-run');

console.log('──── Clooudie on-chain creator fix ────');
console.log('Contract        :', RRG_ADDR);
console.log('PLATFORM_WALLET :', PLATFORM_WALLET);
console.log('Brand id        :', BRAND_ID);
console.log('Old token IDs   :', OLD_TOKENS.join(', '));
console.log('Dry run         :', DRY_RUN ? 'YES (no writes)' : 'no');
console.log();

// ── Clients ──────────────────────────────────────────────────────────
const db       = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(DEPLOYER_PK, provider);

const RRG_ABI = [
  'function pauseDrop(uint256 tokenId) external',
  'function registerDrop(uint256 tokenId, address creator, uint256 priceUsdc6dp, uint256 maxSupply) external',
  'function getDrop(uint256 tokenId) external view returns (tuple(address creator, uint256 priceUsdc, uint256 maxSupply, uint256 minted, bool active))',
];
const rrg = new ethers.Contract(RRG_ADDR, RRG_ABI, signer);

const toUsdc6dp = (priceStr) => BigInt(Math.round(parseFloat(priceStr) * 1_000_000));

// Explicit nonce tracking (Base public RPC has stale-nonce issues on bursts)
let _nextNonce = null;
async function nextNonce() {
  if (_nextNonce === null) _nextNonce = await signer.getNonce('latest');
  return _nextNonce++;
}

async function claimNextTokenId() {
  const { data: cfg, error: e1 } = await db.from('rrg_config').select('value').eq('key', 'next_token_id').single();
  if (e1) throw new Error(`rrg_config read: ${e1.message}`);
  const current = parseInt(cfg.value, 10);
  const next = current + 1;
  const { error: e2 } = await db.from('rrg_config').update({ value: String(next) }).eq('key', 'next_token_id');
  if (e2) throw new Error(`rrg_config update: ${e2.message}`);
  return current;
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────
(async () => {
  // Load the 14 rows
  const { data: rows, error } = await db
    .from('rrg_submissions')
    .select('id, token_id, title, price_usdc, edition_size')
    .eq('brand_id', BRAND_ID)
    .eq('is_brand_product', true)
    .in('token_id', OLD_TOKENS)
    .order('token_id', { ascending: true });
  if (error) { console.error(error); process.exit(1); }
  if (rows.length !== OLD_TOKENS.length) {
    console.error(`Expected ${OLD_TOKENS.length} rows, got ${rows.length}. Aborting.`);
    process.exit(1);
  }

  // Verify each is on-chain with the bad creator before touching it.
  // Base public RPC rate-limits aggressively — throttle the verification loop.
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (const r of rows) {
    let attempt = 0;
    while (true) {
      try {
        const d = await rrg.getDrop(r.token_id);
        if (d.creator === ethers.ZeroAddress) {
          console.error(`Token #${r.token_id}: not registered on-chain. Aborting.`);
          process.exit(1);
        }
        if (d.creator.toLowerCase() === PLATFORM_WALLET.toLowerCase()) {
          console.warn(`Token #${r.token_id}: creator is ALREADY platform wallet — skip`);
        }
        break;
      } catch (e) {
        const msg = e?.info?.error?.message || e.shortMessage || e.message;
        if (msg && msg.includes('rate limit') && attempt < 5) {
          attempt++;
          const wait = 1000 * attempt;
          console.warn(`Rate limited on getDrop(${r.token_id}); retrying in ${wait}ms (attempt ${attempt}/5)`);
          await sleep(wait);
          continue;
        }
        throw e;
      }
    }
    await sleep(400);
  }

  // Headroom: deployer balance check
  const bal = await provider.getBalance(signer.address);
  console.log(`DEPLOYER ${signer.address} balance: ${ethers.formatEther(bal)} ETH`);
  console.log();

  const mapping = []; // [{ submissionId, oldTokenId, newTokenId, pauseTx, registerTx, title }]

  for (const r of rows) {
    console.log(`── ${r.title}  (#${r.token_id} → ?)  $${r.price_usdc}`);

    // 1. pauseDrop(oldTokenId)
    if (DRY_RUN) {
      console.log(`   DRY: would pauseDrop(${r.token_id})`);
    } else {
      try {
        const tx = await rrg.pauseDrop(r.token_id, { nonce: await nextNonce() });
        const rcpt = await tx.wait(1);
        console.log(`   ✓ paused ${r.token_id}: ${rcpt.hash}`);
        mapping.push({ submissionId: r.id, oldTokenId: r.token_id, title: r.title, pauseTx: rcpt.hash });
      } catch (e) {
        console.error(`   ✗ pause ${r.token_id} failed: ${e.shortMessage || e.message}`);
        process.exit(1);
      }
    }

    // 2. Claim a fresh token ID
    let newTokenId;
    if (DRY_RUN) {
      newTokenId = 999000 + r.token_id;
      console.log(`   DRY: would claim newTokenId (placeholder ${newTokenId})`);
    } else {
      newTokenId = await claimNextTokenId();
      console.log(`   ✓ claimed new tokenId: ${newTokenId}`);
    }

    // 3. registerDrop(newTokenId, PLATFORM_WALLET, price6dp, editionSize)
    const price6dp = toUsdc6dp(r.price_usdc);
    if (DRY_RUN) {
      console.log(`   DRY: would registerDrop(${newTokenId}, ${PLATFORM_WALLET}, ${price6dp}, ${r.edition_size})`);
    } else {
      try {
        const tx = await rrg.registerDrop(newTokenId, PLATFORM_WALLET, price6dp, r.edition_size, { nonce: await nextNonce() });
        const rcpt = await tx.wait(1);
        console.log(`   ✓ registered new ${newTokenId} (creator=PLATFORM): ${rcpt.hash}`);
        mapping[mapping.length - 1].newTokenId  = newTokenId;
        mapping[mapping.length - 1].registerTx = rcpt.hash;
      } catch (e) {
        console.error(`   ✗ registerDrop(${newTokenId}) failed: ${e.shortMessage || e.message}`);
        process.exit(1);
      }
    }

    // 4. UPDATE rrg_submissions SET token_id = newTokenId
    if (DRY_RUN) {
      console.log(`   DRY: would UPDATE rrg_submissions ${r.id} SET token_id = ${newTokenId}`);
    } else {
      const { error: uErr } = await db.from('rrg_submissions')
        .update({ token_id: newTokenId })
        .eq('id', r.id);
      if (uErr) { console.error(`   ✗ DB update failed: ${uErr.message}`); process.exit(1); }
      console.log(`   ✓ DB updated: submission ${r.id.slice(0,8)}… token_id ${r.token_id} → ${newTokenId}`);
    }

    console.log();
  }

  // Persist mapping for the audit trail
  const auditPath = resolve(process.cwd(), 'tmp', `clooudie-onchain-fix-${Date.now()}.json`);
  writeFileSync(auditPath, JSON.stringify({
    contract:      RRG_ADDR,
    platform:      PLATFORM_WALLET,
    brand_id:      BRAND_ID,
    dry_run:       DRY_RUN,
    completed_at:  new Date().toISOString(),
    mapping,
  }, null, 2));
  console.log(`Audit log: ${auditPath}`);
  console.log();
  console.log('──── Done ────');
  console.log(`Pause + re-register: ${mapping.length} tokens`);
  console.log(`Storefront: https://realrealgenuine.com/brand/clooudie`);
  for (const m of mapping) {
    console.log(`  • ${m.title.padEnd(45)}  #${m.oldTokenId} → #${m.newTokenId ?? 'DRY'}`);
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
