/**
 * scripts/repair-onchain-creator.mjs
 *
 * Generic remediation for brand-owned drops registered on-chain with the
 * WRONG creator (anything other than PLATFORM_WALLET). Per
 * lib/app/splits.ts:160 brand-product drops MUST be registered with
 * creator = PLATFORM_WALLET so the contract sends 100% to the platform
 * and auto-payout.ts settles the brand's negotiated share off-chain.
 *
 * Driven by the JSON output of scripts/audit-onchain-creator.mjs.
 *
 * Two modes per brand (operator-classified, no inference):
 *
 *   --remint <slug,slug,...>
 *     For live brands. Per affected token:
 *       1. pauseDrop(oldTokenId)
 *       2. claimNextTokenId() (bumps rrg_config.next_token_id)
 *       3. registerDrop(newTokenId, PLATFORM_WALLET, price6dp, remainingSupply)
 *          where remainingSupply = original edition_size - already minted on-chain
 *       4. UPDATE rrg_submissions SET token_id = newTokenId
 *
 *   --pause-only <slug,slug,...>
 *     For dummy/dormant/pre-onboarding brands. Per affected token:
 *       1. pauseDrop(oldTokenId)  -- bug neutralized; no DB mutation
 *     Existing buyers keep their NFTs; the listing becomes inert.
 *
 * Refuses to run if any brand in the audit's affected_drops is unclassified.
 *
 * Uses explicit nonce tracking (Base public RPC stale-nonce issue
 * documented in feedback_erc8004_nonce.md). Throttles between RPC reads.
 *
 * Usage:
 *   node scripts/repair-onchain-creator.mjs \
 *     --report tmp/onchain-creator-audit-XXXX.json \
 *     --remint frey-tailored,nolo,unknown-union,clooudie \
 *     --pause-only de-la-soul,eastcoast,rrg,les-basics,livvium,tyo \
 *     --dry-run
 *
 * Then re-run without --dry-run after confirming the dry output looks right.
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   DEPLOYER_PRIVATE_KEY, NEXT_PUBLIC_BASE_RPC_URL,
 *   NEXT_PUBLIC_VIA_CONTRACT_ADDRESS, NEXT_PUBLIC_PLATFORM_WALLET
 */

import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

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
const RRG_ADDR        = requireEnv('NEXT_PUBLIC_VIA_CONTRACT_ADDRESS');
const PLATFORM_WALLET = requireEnv('NEXT_PUBLIC_PLATFORM_WALLET');

// ── Args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const list = (s) => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : []);

const REPORT_PATH  = flag('--report');
const REMINT_SET   = new Set(list(flag('--remint')));
const PAUSE_SET    = new Set(list(flag('--pause-only')));
const DRY_RUN      = args.includes('--dry-run');

if (!REPORT_PATH) {
  console.error('FATAL: --report <path-to-audit-json> is required');
  console.error('Run: node scripts/audit-onchain-creator.mjs   to produce one');
  process.exit(1);
}

// Reject overlap
const overlap = [...REMINT_SET].filter(s => PAUSE_SET.has(s));
if (overlap.length) {
  console.error('FATAL: brand(s) in BOTH --remint and --pause-only:', overlap.join(', '));
  process.exit(1);
}

// ── Load audit ──────────────────────────────────────────────────────
let audit;
try {
  audit = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
} catch (e) {
  console.error('FATAL: could not read report:', e.message);
  process.exit(1);
}
if (!Array.isArray(audit.affected_drops)) {
  console.error('FATAL: report missing affected_drops[]'); process.exit(1);
}

// Classify and check
const dropsByBrand = {};
for (const d of audit.affected_drops) {
  (dropsByBrand[d.brand_slug] = dropsByBrand[d.brand_slug] || []).push(d);
}
const allBrands = Object.keys(dropsByBrand).sort();
const unclassified = allBrands.filter(s => !REMINT_SET.has(s) && !PAUSE_SET.has(s));
if (unclassified.length) {
  console.error('FATAL: brand(s) in audit but not classified:', unclassified.join(', '));
  console.error('Pass each brand in either --remint or --pause-only.');
  process.exit(1);
}

// Print plan
console.log('──── On-chain creator REPAIR ────');
console.log('Contract        :', RRG_ADDR);
console.log('PLATFORM_WALLET :', PLATFORM_WALLET);
console.log('Audit report    :', REPORT_PATH);
console.log('Dry run         :', DRY_RUN ? 'YES (no writes)' : 'no');
console.log();
console.log('Plan by brand:');
for (const slug of allBrands) {
  const mode = REMINT_SET.has(slug) ? 'REMINT      ' : 'PAUSE_ONLY  ';
  const ds   = dropsByBrand[slug];
  const tokens = ds.map(d => '#' + d.token_id).join(',');
  const minted = ds.reduce((a, d) => a + (d.minted ?? 0), 0);
  console.log(`  ${mode}${slug.padEnd(20)} ${ds.length} drops (${minted} minted total)  tokens: ${tokens}`);
}
console.log();

// ── Clients ─────────────────────────────────────────────────────────
const db       = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(DEPLOYER_PK, provider);

const RRG_ABI = [
  'function pauseDrop(uint256 tokenId) external',
  'function registerDrop(uint256 tokenId, address creator, uint256 priceUsdc6dp, uint256 maxSupply) external',
  'function getDrop(uint256 tokenId) external view returns (tuple(address creator, uint256 priceUsdc, uint256 maxSupply, uint256 minted, bool active))',
];
const rrg = new ethers.Contract(RRG_ADDR, RRG_ABI, signer);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const toUsdc6dp = (priceStr) => BigInt(Math.round(parseFloat(priceStr) * 1_000_000));

// Explicit nonce tracking
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

async function getDropOnChainThrottled(tokenId) {
  let attempt = 0;
  while (true) {
    try {
      return await rrg.getDrop(tokenId);
    } catch (e) {
      const msg = e?.info?.error?.message || e.shortMessage || e.message;
      if (msg && msg.toLowerCase().includes('rate limit') && attempt < 5) {
        attempt++;
        await sleep(1000 * attempt);
        continue;
      }
      throw e;
    }
  }
}

// ── Pre-flight: verify each affected drop is still wrong on-chain ────
console.log('Pre-flight: verifying each affected drop is still wrong on-chain...');
for (const slug of allBrands) {
  for (const d of dropsByBrand[slug]) {
    const oc = await getDropOnChainThrottled(d.token_id);
    if (oc.creator === ethers.ZeroAddress) {
      console.error(`  ✗ #${d.token_id} (${slug}): not registered. Audit stale. Re-run audit.`);
      process.exit(1);
    }
    if (oc.creator.toLowerCase() === PLATFORM_WALLET.toLowerCase()) {
      console.warn(`  ⚠ #${d.token_id} (${slug}): already PLATFORM creator — will skip`);
      d._skip = 'already-platform';
    } else if (!oc.active) {
      console.warn(`  ⚠ #${d.token_id} (${slug}): already paused (creator still wrong) — depends on mode`);
      d._alreadyPaused = true;
    }
    // capture live minted count for remint maxSupply calc
    d._onchain_minted   = Number(oc.minted);
    d._onchain_maxSupply = Number(oc.maxSupply);
    await sleep(300);
  }
}
console.log();

// Headroom: deployer balance check
const bal = await provider.getBalance(signer.address);
console.log(`DEPLOYER ${signer.address} balance: ${ethers.formatEther(bal)} ETH`);
console.log();

// ── Load DB rows for affected drops (need price/edition/id for remint) ─
const allTokenIds = audit.affected_drops.filter(d => !d._skip).map(d => d.token_id);
const { data: rows, error: rowsErr } = await db
  .from('rrg_submissions')
  .select('id, token_id, title, price_usdc, edition_size, brand_id, app_sellers!inner(slug)')
  .in('token_id', allTokenIds);
if (rowsErr) { console.error('DB read failed:', rowsErr); process.exit(1); }
const rowByToken = Object.fromEntries(rows.map(r => [r.token_id, r]));
for (const tid of allTokenIds) {
  if (!rowByToken[tid]) {
    console.error(`FATAL: token #${tid} in audit but no DB row in rrg_submissions. Re-audit.`);
    process.exit(1);
  }
}

// ── Execute ─────────────────────────────────────────────────────────
const log = []; // [{slug, oldTokenId, mode, pauseTx, newTokenId?, registerTx?, dbUpdated?}]
let opsDone = 0, opsSkipped = 0, opsFailed = 0;

for (const slug of allBrands) {
  const mode = REMINT_SET.has(slug) ? 'remint' : 'pause-only';
  console.log(`──── ${slug}  [${mode}]  ${dropsByBrand[slug].length} drops`);

  for (const d of dropsByBrand[slug]) {
    if (d._skip) {
      console.log(`  · #${d.token_id} skipped (${d._skip})`);
      opsSkipped++;
      continue;
    }
    const row = rowByToken[d.token_id];
    const entry = { slug, oldTokenId: d.token_id, mode, title: row.title };

    // 1. pauseDrop (skip if already paused)
    if (d._alreadyPaused) {
      console.log(`  · #${d.token_id} already paused on-chain — skipping pauseDrop`);
      entry.pauseTx = 'already-paused';
    } else if (DRY_RUN) {
      console.log(`  DRY: pauseDrop(${d.token_id})`);
      entry.pauseTx = 'DRY';
    } else {
      try {
        const tx = await rrg.pauseDrop(d.token_id, { nonce: await nextNonce() });
        const rcpt = await tx.wait(1);
        console.log(`  ✓ paused #${d.token_id}: ${rcpt.hash}`);
        entry.pauseTx = rcpt.hash;
      } catch (e) {
        console.error(`  ✗ pauseDrop(${d.token_id}) failed: ${e.shortMessage || e.message}`);
        opsFailed++;
        log.push({ ...entry, error: 'pause-failed: ' + (e.shortMessage || e.message) });
        continue;
      }
    }

    if (mode === 'pause-only') {
      log.push(entry);
      opsDone++;
      continue;
    }

    // 2. Claim a fresh token ID (REMINT mode)
    let newTokenId;
    if (DRY_RUN) {
      newTokenId = 999000 + d.token_id;
      console.log(`  DRY: claim newTokenId (placeholder ${newTokenId})`);
    } else {
      try {
        newTokenId = await claimNextTokenId();
        console.log(`  ✓ claimed newTokenId: ${newTokenId}`);
      } catch (e) {
        console.error(`  ✗ claimNextTokenId failed: ${e.message}`);
        opsFailed++;
        log.push({ ...entry, error: 'claim-failed: ' + e.message });
        continue;
      }
    }

    // 3. registerDrop with PLATFORM_WALLET as creator
    //    maxSupply = on-chain original maxSupply - already minted (so total edition stays honest)
    const remaining = d._onchain_maxSupply - d._onchain_minted;
    if (remaining <= 0) {
      console.log(`  · #${d.token_id} already fully minted (${d._onchain_minted}/${d._onchain_maxSupply}) — skip register, will UPDATE DB anyway`);
      entry.newTokenId = null;
      entry.registerTx = 'skipped-fully-minted';
    } else {
      const price6dp = toUsdc6dp(row.price_usdc);
      if (DRY_RUN) {
        console.log(`  DRY: registerDrop(${newTokenId}, ${PLATFORM_WALLET}, ${price6dp}, ${remaining})  [orig maxSupply=${d._onchain_maxSupply}, minted=${d._onchain_minted}]`);
        entry.newTokenId = newTokenId;
        entry.registerTx = 'DRY';
        entry.newMaxSupply = remaining;
      } else {
        try {
          const tx = await rrg.registerDrop(newTokenId, PLATFORM_WALLET, price6dp, remaining, { nonce: await nextNonce() });
          const rcpt = await tx.wait(1);
          console.log(`  ✓ registered new ${newTokenId} (creator=PLATFORM, maxSupply=${remaining}): ${rcpt.hash}`);
          entry.newTokenId = newTokenId;
          entry.registerTx = rcpt.hash;
          entry.newMaxSupply = remaining;
        } catch (e) {
          console.error(`  ✗ registerDrop(${newTokenId}) failed: ${e.shortMessage || e.message}`);
          opsFailed++;
          log.push({ ...entry, error: 'register-failed: ' + (e.shortMessage || e.message) });
          continue;
        }
      }
    }

    // 4. UPDATE rrg_submissions SET token_id = newTokenId (only if a new token was registered)
    if (entry.registerTx === 'skipped-fully-minted') {
      console.log(`  · DB token_id left as-is (#${d.token_id}) since no new register`);
    } else if (DRY_RUN) {
      console.log(`  DRY: UPDATE rrg_submissions ${row.id.slice(0,8)} SET token_id = ${newTokenId}`);
      entry.dbUpdated = 'DRY';
    } else {
      const { error: uErr } = await db.from('rrg_submissions').update({ token_id: newTokenId }).eq('id', row.id);
      if (uErr) {
        console.error(`  ✗ DB update failed for ${row.id}: ${uErr.message}`);
        opsFailed++;
        log.push({ ...entry, error: 'db-update-failed: ' + uErr.message });
        continue;
      }
      console.log(`  ✓ DB updated: ${row.id.slice(0,8)} token_id ${d.token_id} → ${newTokenId}`);
      entry.dbUpdated = true;
    }

    log.push(entry);
    opsDone++;
  }
  console.log();
}

// ── Persist audit log ──────────────────────────────────────────────
const outPath = resolve(process.cwd(), 'tmp', `repair-onchain-creator-${Date.now()}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({
  contract: RRG_ADDR,
  platform: PLATFORM_WALLET,
  source_audit: REPORT_PATH,
  dry_run: DRY_RUN,
  completed_at: new Date().toISOString(),
  done: opsDone,
  skipped: opsSkipped,
  failed: opsFailed,
  remint_brands: [...REMINT_SET].sort(),
  pause_only_brands: [...PAUSE_SET].sort(),
  log,
}, null, 2));

console.log(`──── Done ────`);
console.log(`done=${opsDone}  skipped=${opsSkipped}  failed=${opsFailed}`);
console.log(`Audit log: ${outPath}`);
if (opsFailed > 0) process.exit(2);
