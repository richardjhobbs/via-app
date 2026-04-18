/**
 * scripts/register-brand-agent.mjs
 *
 * Mint a dedicated brand-agent identity on ERC-8004 (Base mainnet).
 *
 * Flow:
 *   1. Generate a fresh EOA (the brand's concierge wallet)
 *   2. Fund it from DEPLOYER (~0.00005 ETH — plenty for future signing)
 *   3. From the new wallet, call `register(agentURI)` on the ERC-8004
 *      Identity Registry (0x8004A169…) → mints an agent token owned by
 *      the new wallet. Token ID parsed from the Transfer event.
 *   4. Update rrg_brands.wallet_address to the new wallet
 *   5. Write the new PK + agent_id to tmp/<slug>-credentials-<ts>.json
 *      (gitignored) so you can paste it into .env.local + Vercel
 *
 * Usage:
 *   node scripts/register-brand-agent.mjs --brand passport-adv
 *   node scripts/register-brand-agent.mjs --brand passport-adv --dry-run
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   DEPLOYER_PRIVATE_KEY, NEXT_PUBLIC_BASE_RPC_URL
 */

import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Brand context (must match a row in rrg_brands) ───────────────────
const BRANDS = {
  'passport-adv': {
    name:        'PassportADV',
    description: 'Ethiopian-inflected, Los Angeles-based streetwear and technical apparel. Mirror of passportadv.com on Real Real Genuine — checkout in USDC on Base, ships from PassportADV.',
    storefront:  'https://realrealgenuine.com/brand/passport-adv',
    mcpEndpoint: 'https://realrealgenuine.com/brand/passport-adv/mcp',
    website:     'https://www.passportadv.com',
    categories:  ['streetwear', 'apparel', 'footwear', 'technical'],
  },
  'nolo': {
    name:        'Nolo',
    description: 'UK decaf cold brew oat latte brand. Classic and Caramel Swirl in 12, 24, and 36 can packs, plus a Decaf Double Bundle. Mirror of wearenolo.com on Real Real Genuine. Checkout in USDC on Base, ships from Nolo UK.',
    storefront:  'https://realrealgenuine.com/brand/nolo',
    mcpEndpoint: 'https://realrealgenuine.com/brand/nolo/mcp',
    website:     'https://wearenolo.com',
    categories:  ['coffee', 'beverage', 'decaf', 'cold-brew', 'oat-milk'],
  },
};

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

const SUPABASE_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
const RPC_URL      = requireEnv('NEXT_PUBLIC_BASE_RPC_URL');
const DEPLOYER_PK  = requireEnv('DEPLOYER_PRIVATE_KEY');

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const IDENTITY_ABI = [
  'function register(string calldata agentURI) external returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
];

// Fund-new-wallet amount. At ~0.006 gwei on Base, 0.00005 ETH covers ~40
// transactions — enough for register + future signing without being a
// large standing balance on a hot wallet.
const FUND_ETH = '0.00005';

// ── CLI flags ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || true) : null;
};
const BRAND_SLUG = flag('--brand');
const DRY_RUN    = args.includes('--dry-run');

if (!BRAND_SLUG || !BRANDS[BRAND_SLUG]) {
  console.error(`Usage: node scripts/register-brand-agent.mjs --brand <slug>`);
  console.error(`Available: ${Object.keys(BRANDS).join(', ')}`);
  process.exit(1);
}

const CFG = BRANDS[BRAND_SLUG];

console.log(`──── Brand Agent Registration: ${CFG.name} ────`);
console.log(`Dry run: ${DRY_RUN ? 'YES' : 'no'}`);
console.log();

// ── Clients ──────────────────────────────────────────────────────────
const db       = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const provider = new ethers.JsonRpcProvider(RPC_URL);
const deployer = new ethers.Wallet(DEPLOYER_PK, provider);

// ── Main ─────────────────────────────────────────────────────────────
(async () => {
  // Step 0: verify the brand row exists
  const { data: brand } = await db
    .from('rrg_brands')
    .select('id, slug, name, wallet_address, status')
    .eq('slug', BRAND_SLUG)
    .single();
  if (!brand) { console.error(`FATAL: brand "${BRAND_SLUG}" not found in rrg_brands`); process.exit(1); }

  console.log(`[db] brand row: ${brand.id}`);
  console.log(`[db] current wallet: ${brand.wallet_address}`);
  console.log();

  // Step 1: generate fresh EOA
  const brandWallet = ethers.Wallet.createRandom().connect(provider);
  console.log(`[step 1] generated fresh EOA:`);
  console.log(`         address:     ${brandWallet.address}`);
  console.log(`         private_key: ${brandWallet.privateKey.slice(0,6)}…${brandWallet.privateKey.slice(-4)}  (saved to credentials file)`);
  console.log();

  // Step 2: fund from DEPLOYER
  const fundWei = ethers.parseEther(FUND_ETH);
  const depBalance = await provider.getBalance(deployer.address);
  console.log(`[step 2] funding new wallet with ${FUND_ETH} ETH from DEPLOYER ${deployer.address}`);
  console.log(`         (deployer balance: ${ethers.formatEther(depBalance)} ETH)`);
  if (depBalance < fundWei * 2n) {
    console.error('FATAL: deployer balance too low'); process.exit(1);
  }

  if (!DRY_RUN) {
    const tx1 = await deployer.sendTransaction({ to: brandWallet.address, value: fundWei });
    console.log(`         tx ${tx1.hash} — waiting for confirmation…`);
    const r1 = await tx1.wait(1);
    console.log(`         mined in block ${r1.blockNumber}, gas used: ${r1.gasUsed}`);
  } else {
    console.log('         DRY: skipped');
  }
  console.log();

  // Step 3: register on ERC-8004 Identity Registry
  const agentUri = JSON.stringify({
    name: `${CFG.name} Concierge`,
    description: CFG.description,
    agentWallet: brandWallet.address.toLowerCase(),
    endpoint: CFG.mcpEndpoint,
    storefront: CFG.storefront,
    website: CFG.website,
    protocols: ['mcp', 'erc8004', 'x402'],
    capabilities: ['browse', 'size', 'stock', 'purchase'],
    categories: CFG.categories,
    platform: 'RRG',
    brandSlug: BRAND_SLUG,
  });
  console.log(`[step 3] register(agentURI) on ${IDENTITY_REGISTRY}`);
  console.log(`         agentURI: ${agentUri}`);

  let agentId = null;
  let registerTxHash = null;
  if (!DRY_RUN) {
    const identity = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, brandWallet);
    const tx2 = await identity.register(agentUri);
    console.log(`         tx ${tx2.hash} — waiting…`);
    const r2 = await tx2.wait(1);
    registerTxHash = r2.hash;
    const transfer = r2.logs.find(l => l.topics[0] === ethers.id('Transfer(address,address,uint256)'));
    if (transfer && transfer.topics[3]) {
      agentId = BigInt(transfer.topics[3]).toString();
    } else {
      const tid = await identity.tokenOfOwnerByIndex(brandWallet.address, 0);
      agentId = tid.toString();
    }
    console.log(`         ✓ minted agent ID: ${agentId}  (owner: ${brandWallet.address})`);
  } else {
    console.log('         DRY: skipped');
  }
  console.log();

  // Step 4: update rrg_brands.wallet_address
  console.log(`[step 4] update rrg_brands.wallet_address → ${brandWallet.address}`);
  if (!DRY_RUN) {
    const { error } = await db.from('rrg_brands')
      .update({ wallet_address: brandWallet.address.toLowerCase() })
      .eq('id', brand.id);
    if (error) { console.error(`         ERR: ${error.message}`); process.exit(1); }
    console.log(`         ✓ updated`);
  } else {
    console.log('         DRY: skipped');
  }
  console.log();

  // Step 5: write credentials file (gitignored via tmp/)
  const ts = Date.now();
  const credPath = resolve(process.cwd(), 'tmp', `${BRAND_SLUG}-credentials-${ts}.json`);
  if (!existsSync(resolve(process.cwd(), 'tmp'))) mkdirSync(resolve(process.cwd(), 'tmp'));
  const creds = {
    brand_slug: BRAND_SLUG,
    brand_name: CFG.name,
    wallet_address: brandWallet.address,
    wallet_private_key: brandWallet.privateKey,
    erc8004_agent_id: agentId,
    erc8004_register_tx: registerTxHash,
    mcp_endpoint: CFG.mcpEndpoint,
    generated_at: new Date().toISOString(),
    dry_run: DRY_RUN,
  };
  writeFileSync(credPath, JSON.stringify(creds, null, 2));
  console.log(`[step 5] credentials written to ${credPath}`);
  console.log();

  console.log(`──── Done ────`);
  console.log(`Brand:          ${CFG.name}`);
  console.log(`Wallet:         ${brandWallet.address}`);
  console.log(`Agent ID:       ${agentId ?? '(dry-run)'}`);
  console.log(`Register tx:    ${registerTxHash ?? '(dry-run)'}`);
  console.log(`Credentials:    ${credPath}`);
  console.log();
  console.log(`Next: add to .env.local (local + VPS + Vercel):`);
  console.log(`  PASSPORT_ADV_WALLET_PRIVATE_KEY=${brandWallet.privateKey}`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
