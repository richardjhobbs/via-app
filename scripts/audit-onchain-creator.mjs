/**
 * scripts/audit-onchain-creator.mjs
 *
 * Read-only audit. For every brand-owned drop in rrg_submissions
 * (is_brand_product=true, network=base, status=approved), query on-chain
 * `getDrop(tokenId).creator` and compare against PLATFORM_WALLET.
 *
 * Reports any drop whose on-chain creator != PLATFORM_WALLET — those are
 * affected by the registerDrop-creator bug (post-mortem at
 * memory/feedback_register_drop_creator_must_be_platform.md).
 *
 * Usage:
 *   node scripts/audit-onchain-creator.mjs
 *   node scripts/audit-onchain-creator.mjs --brand frey-tailored   # one brand only
 *   node scripts/audit-onchain-creator.mjs --report-path tmp/audit.json
 *
 * Throttles to avoid the Base public RPC rate limit.
 */

import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

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
const RRG_ADDR        = requireEnv('NEXT_PUBLIC_VIA_CONTRACT_ADDRESS');
const PLATFORM_WALLET = requireEnv('NEXT_PUBLIC_PLATFORM_WALLET').toLowerCase();

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const FILTER_BRAND = flag('--brand');
const REPORT_PATH  = flag('--report-path') || resolve(process.cwd(), 'tmp', `onchain-creator-audit-${Date.now()}.json`);

const db       = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const provider = new ethers.JsonRpcProvider(RPC_URL);
const iface = new ethers.Interface([
  'function getDrop(uint256) view returns (tuple(address creator, uint256 priceUsdc, uint256 maxSupply, uint256 minted, bool active))',
]);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getDropOnChain(tokenId) {
  let attempt = 0;
  while (true) {
    try {
      const data = iface.encodeFunctionData('getDrop', [tokenId]);
      const raw  = await provider.call({ to: RRG_ADDR, data });
      const d    = iface.decodeFunctionResult('getDrop', raw)[0];
      return {
        creator:    d[0],
        priceUsdc:  d[1].toString(),
        maxSupply:  Number(d[2]),
        minted:     Number(d[3]),
        active:     d[4],
      };
    } catch (e) {
      const msg = e?.info?.error?.message || e.shortMessage || e.message;
      if (msg && msg.toLowerCase().includes('rate limit') && attempt < 5) {
        attempt++;
        await sleep(800 * attempt);
        continue;
      }
      throw e;
    }
  }
}

(async () => {
  console.log('──── On-chain creator audit ────');
  console.log('Contract        :', RRG_ADDR);
  console.log('PLATFORM_WALLET :', PLATFORM_WALLET);
  console.log('Brand filter    :', FILTER_BRAND || '(all)');
  console.log();

  let q = db
    .from('rrg_submissions')
    .select('token_id, title, brand_id, price_usdc, edition_size, app_sellers!inner(slug, wallet_address, status)')
    .eq('is_brand_product', true)
    .eq('network', 'base')
    .eq('status', 'approved')
    .not('token_id', 'is', null)
    .order('token_id');
  if (FILTER_BRAND) q = q.eq('app_sellers.slug', FILTER_BRAND);

  const { data: rows, error } = await q;
  if (error) { console.error(error); process.exit(1); }
  console.log(`Auditing ${rows.length} drops…`);
  console.log();

  const results = {
    total: rows.length,
    correct: 0,    // creator == PLATFORM
    wrong: 0,      // creator != PLATFORM AND not address(0)
    unregistered: 0,
    paused: 0,
    by_brand: {},
    affected_drops: [],
  };

  // Chunked concurrency. getDropOnChain has its own rate-limit retry with
  // exponential backoff, so 5-wide concurrency is safe against the public
  // Base RPC; total wall time scales O(n / CONCURRENCY) instead of O(n).
  const CONCURRENCY = 5;
  const BATCH_PAUSE_MS = 200;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((r) => getDropOnChain(r.token_id))
    );

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const slug    = r.app_sellers.slug;
      const tokenId = r.token_id;
      if (!results.by_brand[slug]) results.by_brand[slug] = { total: 0, correct: 0, wrong: 0, unregistered: 0, paused: 0 };
      results.by_brand[slug].total++;

      const s = settled[j];
      if (s.status === 'rejected') {
        const e = s.reason;
        console.warn(`  [#${tokenId} ${slug}] error: ${e?.shortMessage || e?.message || e}`);
        continue;
      }
      const drop = s.value;

      if (drop.creator === ethers.ZeroAddress) {
        results.unregistered++;
        results.by_brand[slug].unregistered++;
      } else if (!drop.active) {
        results.paused++;
        results.by_brand[slug].paused++;
      } else if (drop.creator.toLowerCase() === PLATFORM_WALLET) {
        results.correct++;
        results.by_brand[slug].correct++;
      } else {
        results.wrong++;
        results.by_brand[slug].wrong++;
        results.affected_drops.push({
          token_id:    tokenId,
          title:       r.title,
          brand_slug:  slug,
          brand_wallet: r.app_sellers.wallet_address,
          on_chain_creator: drop.creator,
          price_usdc: r.price_usdc,
          edition:    r.edition_size,
          minted:     drop.minted,
          max:        drop.maxSupply,
          active:     drop.active,
        });
      }
    }

    if (i + CONCURRENCY < rows.length) await sleep(BATCH_PAUSE_MS);
  }

  // Persist
  writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2));

  console.log();
  console.log('──── Audit Summary ────');
  console.log(`Total drops audited : ${results.total}`);
  console.log(`Correct             : ${results.correct}  (creator = PLATFORM_WALLET)`);
  console.log(`Wrong (BUG)         : ${results.wrong}    (creator != PLATFORM_WALLET, active)`);
  console.log(`Paused              : ${results.paused}   (active=false; bug irrelevant)`);
  console.log(`Unregistered        : ${results.unregistered}  (DB row but no on-chain entry)`);
  console.log();
  console.log('By brand:');
  for (const [slug, b] of Object.entries(results.by_brand).sort((a, b) => b[1].wrong - a[1].wrong)) {
    const flag = b.wrong > 0 ? ' ⚠ ' : '   ';
    console.log(` ${flag}${slug.padEnd(30)} total=${b.total} correct=${b.correct} wrong=${b.wrong} paused=${b.paused} unreg=${b.unregistered}`);
  }
  console.log();
  console.log(`Full report: ${REPORT_PATH}`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
