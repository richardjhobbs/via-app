/**
 * mainnet-migrate.js — Sequential migration with delays to avoid RPC throttling.
 * Run on VPS: cd /home/agent/apps/rrg && node scripts/mainnet-migrate.js
 */
require('dotenv').config({ path: '.env.local' });
const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Config
const RPC_URL          = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org';
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_VIA_CONTRACT_ADDRESS;
const DEPLOYER_KEY     = process.env.DEPLOYER_PRIVATE_KEY;
const CHAIN_ID         = process.env.NEXT_PUBLIC_CHAIN_ID;
const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const DELAY_MS         = 3000; // 3 seconds between txs

const NETWORK = CHAIN_ID === '8453' ? 'base' : 'base-sepolia';

const ABI = [
  'function registerDrop(uint256 tokenId, address creator, uint256 priceUsdc6dp, uint256 maxSupply) external',
  'function operatorMint(uint256 tokenId, address buyer) external',
  'function getDrop(uint256 tokenId) view returns (address creator, uint256 priceUsdc6dp, uint256 maxSupply, uint256 minted, bool active)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function owner() view returns (address)',
];

function toUsdc6dp(amount) {
  return BigInt(Math.round(amount * 1_000_000));
}

async function main() {
  console.log('=== RRG Mainnet Migration ===');
  console.log('RPC:', RPC_URL);
  console.log('Contract:', CONTRACT_ADDRESS);
  console.log('Network:', NETWORK);
  console.log('Delay between txs:', DELAY_MS, 'ms');
  console.log();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, deployer);

  const balance = await provider.getBalance(deployer.address);
  console.log('Deployer:', deployer.address);
  console.log('Balance:', ethers.formatEther(balance), 'ETH');
  console.log();

  // Verify ownership
  const owner = await contract.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.error('ERROR: Deployer is not contract owner!');
    console.error('Owner:', owner);
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  // ── Step 1: Register drops ──────────────────────────────────────────
  console.log('=== Step 1: Register Drops ===');
  const { data: submissions } = await db
    .from('rrg_submissions')
    .select('token_id, title, creator_wallet, price_usdc, edition_size')
    .eq('status', 'approved')
    .eq('network', NETWORK)
    .order('token_id', { ascending: true });

  let dropsRegistered = 0;
  let dropsSkipped = 0;
  let dropsFailed = 0;

  for (const sub of submissions || []) {
    const tokenId = sub.token_id;
    const title = sub.title;

    try {
      // Check if already registered (with retry)
      let drop;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          drop = await contract.getDrop(tokenId);
          break;
        } catch (e) {
          if (attempt < 3) {
            console.log(`  getDrop(${tokenId}) retry ${attempt}/3...`);
            await sleep(2000);
          } else throw e;
        }
      }

      if (drop.creator !== '0x0000000000000000000000000000000000000000') {
        console.log(`  #${tokenId} "${title}" — already registered ✓`);
        dropsSkipped++;
        continue;
      }

      // Register
      const price6dp = toUsdc6dp(parseFloat(sub.price_usdc));
      console.log(`  #${tokenId} "${title}" — registering (price: ${sub.price_usdc} USDC, edition: ${sub.edition_size})...`);

      const tx = await contract.registerDrop(tokenId, sub.creator_wallet, price6dp, sub.edition_size);
      const receipt = await tx.wait(1);
      console.log(`  #${tokenId} ✅ registered — tx: ${receipt.hash}`);
      dropsRegistered++;

      await sleep(DELAY_MS);
    } catch (err) {
      console.error(`  #${tokenId} ❌ FAILED:`, err.message?.slice(0, 120));
      dropsFailed++;
      await sleep(DELAY_MS);
    }
  }

  console.log();
  console.log(`Drops summary: ${dropsRegistered} registered, ${dropsSkipped} skipped, ${dropsFailed} failed`);
  console.log();

  // ── Step 2: Re-mint purchases ────────────────────────────────────────
  console.log('=== Step 2: Re-mint Purchases ===');
  const { data: purchases } = await db
    .from('app_purchases')
    .select('token_id, buyer_wallet')
    .eq('network', NETWORK)
    .order('token_id', { ascending: true });

  let mintsOk = 0;
  let mintsSkipped = 0;
  let mintsFailed = 0;

  for (const purchase of purchases || []) {
    const tokenId = purchase.token_id;
    const buyer = purchase.buyer_wallet;

    try {
      // Check if already owns (with retry)
      let bal;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          bal = await contract.balanceOf(buyer, tokenId);
          break;
        } catch (e) {
          if (attempt < 3) {
            console.log(`  balanceOf retry ${attempt}/3...`);
            await sleep(2000);
          } else throw e;
        }
      }

      if (bal > 0n) {
        console.log(`  #${tokenId} → ${buyer.slice(0,10)}… — already owns ✓`);
        mintsSkipped++;
        continue;
      }

      console.log(`  #${tokenId} → ${buyer.slice(0,10)}… — minting...`);
      const tx = await contract.operatorMint(tokenId, buyer);
      const receipt = await tx.wait(1);
      console.log(`  #${tokenId} ✅ minted — tx: ${receipt.hash}`);
      mintsOk++;

      await sleep(DELAY_MS);
    } catch (err) {
      console.error(`  #${tokenId} → ${buyer.slice(0,10)}… ❌ FAILED:`, err.message?.slice(0, 120));
      mintsFailed++;
      await sleep(DELAY_MS);
    }
  }

  console.log();
  console.log(`Mints summary: ${mintsOk} minted, ${mintsSkipped} skipped, ${mintsFailed} failed`);

  // Final balance
  const finalBal = await provider.getBalance(deployer.address);
  console.log();
  console.log('Final balance:', ethers.formatEther(finalBal), 'ETH');
  console.log('Gas used:', ethers.formatEther(balance - finalBal), 'ETH');
  console.log('=== Done ===');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
