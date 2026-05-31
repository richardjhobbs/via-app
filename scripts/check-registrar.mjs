/**
 * Confirm whether a given wallet is the VIA_REGISTRAR_PRIVATE_KEY's address
 * by inspecting its outgoing transactions on Base mainnet via BaseScan API.
 *
 * The registrar is the EOA that signs `register(string agentURI)` txs on the
 * ERC-8004 IdentityRegistry. If the candidate's recent outgoing tx list
 * contains txs whose `to` matches the registry address, it's the registrar.
 */
import { ethers } from 'ethers';
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org';
const CANDIDATE = (process.argv[2] || '').toLowerCase();
if (!CANDIDATE || !ethers.isAddress(CANDIDATE)) {
  console.error('Usage: node scripts/check-registrar.mjs 0xCANDIDATE');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC);

// Basic on-chain footprint
const balance = await provider.getBalance(CANDIDATE);
const nonce   = await provider.getTransactionCount(CANDIDATE);
console.log(`Address:        ${CANDIDATE}`);
console.log(`Balance (Base): ${ethers.formatEther(balance)} ETH`);
console.log(`Nonce:          ${nonce} (txs sent ever)`);

if (nonce === 0) {
  console.log('\n❌ Zero outgoing txs ever — cannot be the registrar.');
  process.exit(0);
}

// Pull recent outgoing txs from BaseScan (free, key optional).
const key = process.env.BASESCAN_API_KEY || '';
const url = `https://api.basescan.org/api?module=account&action=txlist&address=${CANDIDATE}&startblock=0&endblock=99999999&sort=desc&page=1&offset=20${key ? `&apikey=${key}` : ''}`;
const res = await fetch(url);
const json = await res.json();

if (json.status !== '1' || !Array.isArray(json.result)) {
  console.log(`\nBaseScan said: status=${json.status}, message=${json.message}`);
  console.log('Falling back to per-tx scan of last 5000 blocks…');
  // Fallback: scan recent blocks for txs from this address. Slow but works without an API key.
  const latest = await provider.getBlockNumber();
  let hits = 0;
  for (let b = latest; b > latest - 5000 && hits < 5; b--) {
    const block = await provider.getBlock(b, true);
    if (!block?.prefetchedTransactions) continue;
    for (const tx of block.prefetchedTransactions) {
      if (tx.from?.toLowerCase() === CANDIDATE && tx.to) {
        hits++;
        const isRegistry = tx.to.toLowerCase() === IDENTITY_REGISTRY.toLowerCase();
        console.log(`  block ${b}  ${tx.hash}  to=${tx.to}${isRegistry ? '  ← IdentityRegistry' : ''}`);
      }
    }
  }
  if (hits === 0) console.log('  (no outgoing txs in last 5000 blocks)');
  process.exit(0);
}

console.log(`\nLast ${json.result.length} outgoing tx(s):`);
let registryCalls = 0;
const distinctTargets = new Set();
for (const tx of json.result) {
  const to = (tx.to || '').toLowerCase();
  distinctTargets.add(to);
  const isRegistry = to === IDENTITY_REGISTRY.toLowerCase();
  if (isRegistry) registryCalls++;
  const method = tx.functionName || tx.methodId || '';
  console.log(`  block ${tx.blockNumber}  to ${tx.to ?? '(contract create)'}  method ${method.slice(0, 30).padEnd(30)}${isRegistry ? '  ← IdentityRegistry' : ''}`);
}

console.log('\n──────────────────────────────────────────────────────────────');
if (registryCalls > 0) {
  console.log(`✅ CONFIRMED. ${CANDIDATE} has called the ERC-8004 IdentityRegistry ${registryCalls} time(s) in its last ${json.result.length} txs.`);
  console.log('   This is the VIA registrar wallet.');
} else {
  console.log(`❌ NOT THE REGISTRAR. ${CANDIDATE} has 0 calls to the IdentityRegistry in its last ${json.result.length} txs.`);
  console.log(`   Distinct destination contracts in this slice:`);
  for (const t of distinctTargets) console.log(`     ${t}`);
}
