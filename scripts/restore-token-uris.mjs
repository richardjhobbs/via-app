/**
 * restore-token-uris.mjs — Re-set all tokenURIs on the new RRG contract.
 * Reads ipfs_cid from DB and calls setTokenURI for each approved drop.
 * Run: node scripts/restore-token-uris.mjs
 */
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const RPC_URL         = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org';
const CONTRACT_ADDR   = process.env.NEXT_PUBLIC_VIA_CONTRACT_ADDRESS;
const DEPLOYER_KEY    = process.env.DEPLOYER_PRIVATE_KEY;
const SUPABASE_URL    = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const DELAY_MS        = 3000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ABI = [
  'function setTokenURI(uint256 tokenId, string calldata tokenUri) external',
  'function uri(uint256 tokenId) view returns (string memory)',
];

const provider  = new ethers.JsonRpcProvider(RPC_URL);
const wallet    = new ethers.Wallet(DEPLOYER_KEY, provider);
const contract  = new ethers.Contract(CONTRACT_ADDR, ABI, wallet);
const db        = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('=== Restore Token URIs ===');
console.log('Contract:', CONTRACT_ADDR);
console.log('Deployer:', wallet.address);
console.log('');

const { data: drops, error } = await db
  .from('rrg_submissions')
  .select('token_id, ipfs_cid')
  .eq('status', 'approved')
  .not('ipfs_cid', 'is', null)
  .order('token_id');

if (error) throw new Error('DB error: ' + error.message);
console.log(`Found ${drops.length} drops with IPFS CIDs\n`);

let set = 0, skipped = 0, failed = 0;

for (const drop of drops) {
  const { token_id, ipfs_cid } = drop;
  const uri = `ipfs://${ipfs_cid}`;

  // Check current on-chain URI
  let current = '';
  try {
    current = await contract.uri(token_id);
  } catch { /* unregistered token, set it anyway */ }

  if (current === uri) {
    console.log(`  #${token_id} ✓ already correct`);
    skipped++;
    continue;
  }

  try {
    const tx = await contract.setTokenURI(token_id, uri);
    await tx.wait();
    console.log(`  #${token_id} ✅ set — ${uri.slice(0, 60)}...`);
    set++;
    await sleep(DELAY_MS);
  } catch (err) {
    console.log(`  #${token_id} ❌ FAILED: ${err.message?.slice(0, 80)}`);
    failed++;
    await sleep(1000);
  }
}

console.log(`\nDone: ${set} set, ${skipped} already correct, ${failed} failed`);
