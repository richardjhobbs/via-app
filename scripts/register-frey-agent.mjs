/**
 * scripts/register-frey-agent.mjs
 *
 * One-shot: register the existing Frey concierge wallet (0x30b1e8…) on the
 * ERC-8004 Identity Registry (Base mainnet), funded by DEPLOYER.
 *
 * Adapted from register-brand-agent.mjs — uses an EXISTING private key
 * (already saved as Frey's brand wallet) instead of generating a new EOA.
 *
 * Steps:
 *   1. Verify the Frey brand row + read current wallet
 *   2. Fund the wallet from DEPLOYER (0.00005 ETH on Base)
 *   3. From the wallet, call register(agentURI) on the Identity Registry
 *   4. Append agent ID + tx hash to tmp/frey-wallet-eloise.json
 */

import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RPC_URL      = process.env.NEXT_PUBLIC_BASE_RPC_URL;
const DEPLOYER_PK  = process.env.DEPLOYER_PRIVATE_KEY;

const FREY_PRIVATE_KEY = process.argv.includes('--pk') ? process.argv[process.argv.indexOf('--pk') + 1] : null;
if (!FREY_PRIVATE_KEY) { console.error('FATAL: pass --pk <private-key>'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const IDENTITY_ABI = [
  'function register(string calldata agentURI) external returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
];
const FUND_ETH = '0.00005';

const db       = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const provider = new ethers.JsonRpcProvider(RPC_URL);
const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
const freyWallet = new ethers.Wallet(FREY_PRIVATE_KEY, provider);

console.log('──── Frey Concierge ERC-8004 Registration ────');
console.log(`Wallet:   ${freyWallet.address}`);
console.log(`Deployer: ${deployer.address}`);
console.log(`Dry run:  ${DRY_RUN ? 'YES' : 'no'}`);
console.log();

// Step 0: verify Frey brand row + that the wallet matches
const { data: brand, error: e1 } = await db
  .from('app_sellers')
  .select('id, slug, name, wallet_address')
  .eq('slug', 'frey-tailored')
  .single();
if (e1 || !brand) { console.error('FATAL: brand frey-tailored not found'); process.exit(1); }
if (brand.wallet_address.toLowerCase() !== freyWallet.address.toLowerCase()) {
  console.error(`FATAL: brand wallet (${brand.wallet_address}) doesn't match supplied PK address (${freyWallet.address})`);
  process.exit(1);
}
console.log(`[db] brand row OK: ${brand.id} → wallet matches`);
console.log();

// Step 1: check existing balance, fund if low
const startBalance = await provider.getBalance(freyWallet.address);
console.log(`[step 1] Frey wallet ETH balance: ${ethers.formatEther(startBalance)} ETH`);
const fundWei = ethers.parseEther(FUND_ETH);
if (startBalance < fundWei / 2n) {
  console.log(`[step 1] funding ${FUND_ETH} ETH from DEPLOYER`);
  const depBal = await provider.getBalance(deployer.address);
  console.log(`         deployer balance: ${ethers.formatEther(depBal)} ETH`);
  if (depBal < fundWei * 2n) { console.error('FATAL: deployer balance too low'); process.exit(1); }
  if (!DRY_RUN) {
    const tx1 = await deployer.sendTransaction({ to: freyWallet.address, value: fundWei });
    console.log(`         fund tx ${tx1.hash} — waiting…`);
    await tx1.wait(1);
    const newBalance = await provider.getBalance(freyWallet.address);
    console.log(`         new balance: ${ethers.formatEther(newBalance)} ETH`);
  } else {
    console.log('         DRY: skipped');
  }
} else {
  console.log('[step 1] balance sufficient — no funding needed');
}
console.log();

// Step 2: build agentURI
const agentUri = JSON.stringify({
  name: 'Frey Tailored Concierge',
  description: 'Frey Tailored — a Hong Kong-based womenswear label specialising in tailoring. Half canvas construction, surgeon\u2019s cuffs, satin peak lapels, jetted pockets — Savile Row techniques applied to contemporary feminine silhouettes. Mirror of frey-tailored.com on Real Real Genuine. Checkout in USDC on Base, ships from Frey HK.',
  agentWallet: freyWallet.address.toLowerCase(),
  endpoint: 'https://realrealgenuine.com/brand/frey-tailored/mcp',
  storefront: 'https://realrealgenuine.com/brand/frey-tailored',
  website: 'https://frey-tailored.com',
  protocols: ['mcp', 'erc8004', 'x402'],
  capabilities: ['browse', 'size', 'stock', 'purchase'],
  categories: ['tailoring', 'womenswear', 'jackets', 'trousers', 'skirts', 'dresses', 'knitwear', 'silk'],
  platform: 'RRG',
  sellerSlug: 'frey-tailored',
});

console.log(`[step 2] register(agentURI) on ${IDENTITY_REGISTRY}`);
console.log(`         agentURI length: ${agentUri.length} chars`);

let agentId = null;
let registerTxHash = null;

if (!DRY_RUN) {
  const identity = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, freyWallet);
  const tx2 = await identity.register(agentUri);
  console.log(`         register tx ${tx2.hash} — waiting…`);
  const r2 = await tx2.wait(1);
  registerTxHash = r2.hash;
  const transfer = r2.logs.find(l => l.topics[0] === ethers.id('Transfer(address,address,uint256)'));
  if (transfer && transfer.topics[3]) {
    agentId = BigInt(transfer.topics[3]).toString();
  } else {
    const tid = await identity.tokenOfOwnerByIndex(freyWallet.address, 0);
    agentId = tid.toString();
  }
  console.log(`         ✓ minted agent ID: ${agentId}`);
} else {
  console.log('         DRY: skipped');
}
console.log();

// Step 3: persist agent ID into the existing wallet credentials file
const credPath = '/tmp/frey-wallet-eloise.json';
if (existsSync(credPath)) {
  const creds = JSON.parse(readFileSync(credPath, 'utf8'));
  creds.erc8004_agent_id    = agentId;
  creds.erc8004_register_tx = registerTxHash;
  creds.erc8004_registered_at = new Date().toISOString();
  writeFileSync(credPath, JSON.stringify(creds, null, 2));
  console.log(`[step 3] appended agent ID to ${credPath}`);
}

console.log();
console.log('──── Done ────');
console.log(`Wallet:        ${freyWallet.address}`);
console.log(`Agent ID:      ${agentId ?? '(dry-run)'}`);
console.log(`Register tx:   ${registerTxHash ?? '(dry-run)'}`);
console.log(`Etherscan:     https://basescan.org/tx/${registerTxHash ?? ''}`);
