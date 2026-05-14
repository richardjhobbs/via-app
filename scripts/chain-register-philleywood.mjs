/**
 * scripts/chain-register-philleywood.mjs
 *
 * One-shot chain registration for the 14 Philleywood product drops
 * (tokens #330-343) that were imported by brand-mirror.mjs without
 * --commit-chain. Calls registerDrop(tokenId, PLATFORM_WALLET,
 * price6dp, editionSize) for each row.
 *
 * Per feedback_register_drop_creator_must_be_platform.md:
 *   - creator MUST be PLATFORM_WALLET, not the brand wallet
 *   - the off-chain auto-payout settles the brand's 97.5% from
 *     platform reserves; passing the brand wallet here loses 67.5%/sale
 *
 * Per feedback_erc8004_nonce.md:
 *   - never use signer.getNonce('latest') between sequential txs on
 *     Base public RPC; cache and increment in process.
 *
 * Usage:
 *   node scripts/chain-register-philleywood.mjs [--dry-run]
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   DEPLOYER_PRIVATE_KEY, NEXT_PUBLIC_BASE_RPC_URL,
 *   NEXT_PUBLIC_RRG_CONTRACT_ADDRESS, NEXT_PUBLIC_PLATFORM_WALLET
 */

import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
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

const need = (k) => {
  if (!process.env[k]) { console.error(`FATAL: ${k} not set`); process.exit(1); }
  return process.env[k];
};

const SUPABASE_URL    = need('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_KEY    = need('SUPABASE_SERVICE_KEY');
const RPC_URL         = need('NEXT_PUBLIC_BASE_RPC_URL');
const RRG_ADDR        = need('NEXT_PUBLIC_RRG_CONTRACT_ADDRESS');
const DEPLOYER_PK     = need('DEPLOYER_PRIVATE_KEY');
const PLATFORM_WALLET = need('NEXT_PUBLIC_PLATFORM_WALLET');

const DRY_RUN = process.argv.includes('--dry-run');

const BRAND_SLUG = 'philleywood';

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(DEPLOYER_PK, provider);
const RRG_ABI = [
  'function registerDrop(uint256 tokenId, address creator, uint256 priceUsdc6dp, uint256 maxSupply) external',
  'function getDrop(uint256 tokenId) external view returns (tuple(address creator, uint256 priceUsdc, uint256 maxSupply, uint256 minted, bool active))',
];
const rrg = new ethers.Contract(RRG_ADDR, RRG_ABI, signer);

const toUsdc6dp = (n) => BigInt(Math.round(Number(n) * 1_000_000));

(async () => {
  console.log(`──── Chain-register Philleywood drops ────`);
  console.log(`Dry run:  ${DRY_RUN ? 'YES' : 'no'}`);
  console.log(`Contract: ${RRG_ADDR}`);
  console.log(`Creator:  ${PLATFORM_WALLET} (PLATFORM)`);
  console.log(`Signer:   ${await signer.getAddress()}`);
  console.log();

  const { data: brand, error: bErr } = await db
    .from('rrg_brands')
    .select('id, slug, name')
    .eq('slug', BRAND_SLUG)
    .maybeSingle();
  if (bErr || !brand) { console.error(`FATAL: brand ${BRAND_SLUG} not found`); process.exit(1); }

  const { data: rows, error: rErr } = await db
    .from('rrg_submissions')
    .select('id, token_id, title, price_usdc, edition_size')
    .eq('brand_id', brand.id)
    .gte('token_id', 330)
    .lte('token_id', 343)
    .order('token_id', { ascending: true });
  if (rErr || !rows?.length) { console.error(`FATAL: no submissions in 330-343 for brand`); process.exit(1); }

  console.log(`[db] ${rows.length} drops to register`);
  console.log();

  if (DRY_RUN) {
    for (const r of rows) {
      const price6 = toUsdc6dp(r.price_usdc);
      const maxSupply = BigInt(r.edition_size);
      console.log(`[dry #${r.token_id}] would registerDrop(${r.token_id}, ${PLATFORM_WALLET}, ${price6}, ${maxSupply})  (${r.title})`);
    }
    return;
  }

  let nonce = await signer.getNonce('latest');
  const results = [];
  for (const r of rows) {
    const price6 = toUsdc6dp(r.price_usdc);
    const maxSupply = BigInt(r.edition_size);
    console.log(`[register #${r.token_id}] price=$${r.price_usdc} edition=${r.edition_size} nonce=${nonce}  (${r.title})`);
    try {
      const tx = await rrg.registerDrop(r.token_id, PLATFORM_WALLET, price6, maxSupply, { nonce });
      console.log(`  → tx ${tx.hash}`);
      const receipt = await tx.wait(1);
      console.log(`  → mined block=${receipt.blockNumber} gas=${receipt.gasUsed.toString()}`);
      results.push({ token_id: r.token_id, tx: receipt.hash, ok: true });
      nonce++;
    } catch (e) {
      // If already registered the contract reverts. Log and continue.
      const msg = e?.shortMessage || e?.message || String(e);
      console.log(`  → FAILED: ${msg}`);
      results.push({ token_id: r.token_id, tx: null, ok: false, error: msg });
      // Don't bump nonce — failed tx returned before send, nonce unchanged.
      // Re-read nonce to be safe in case Base accepted it as reverted-but-mined.
      nonce = await signer.getNonce('latest');
    }
    // Throttle to dodge Base public-RPC rate limit (seen at burst >5 reqs/s).
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log();
  console.log(`──── Done ────`);
  for (const r of results) {
    console.log(`  #${r.token_id} → ${r.tx ?? 'DRY'}`);
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
