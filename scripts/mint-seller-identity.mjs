/**
 * scripts/mint-seller-identity.mjs
 *
 * One-off reconcile: mint an ERC-8004 identity for a VIA seller's PLATFORM-DERIVED
 * agent wallet on Base mainnet via the permissionless Identity Registry
 * register(). Used to fix sellers whose agent_wallet_address was set to a
 * Thirdweb in-app wallet the platform cannot sign for (eli, sentient).
 *
 * Unlike the buyer mint, the seller agent wallet is DERIVED from
 * AGENT_WALLET_SEED + store id (re-derivable, so the VPS agent can sign x402
 * micro-fees with it). This script:
 *   1. Looks up the store id from app_sellers by --slug.
 *   2. Derives the agent wallet (deriveAgentWallet HMAC, same as the app).
 *   3. Funds it ~0.00005 ETH from DEPLOYER (idempotent: skips if already funded).
 *   4. From the derived wallet, register(agentURI) -> mints the token to it.
 *      Idempotent: if the derived wallet already owns a token, links not remints.
 *   5. Prints the agent ADDRESS + new token id (NEVER the private key).
 *
 * The DB UPDATE (agent_wallet_address + erc8004_agent_id) and the roster-literal
 * edits are done by the caller. The old token orphans (expected).
 *
 * Usage: node scripts/mint-seller-identity.mjs --slug eli-s-artisan-bakery [--dry-run]
 * Requires .env.local: AGENT_WALLET_SEED, DEPLOYER_PRIVATE_KEY,
 * NEXT_PUBLIC_BASE_RPC_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { ethers } from 'ethers';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) { const k = m[1].trim(); if (!process.env[k]) process.env[k] = m[2].trim().replace(/^["']|["']$/g, ''); }
}

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || true) : null; };
const SLUG = flag('--slug');
const DRY = args.includes('--dry-run');
if (!SLUG || typeof SLUG !== 'string') { console.error('Usage: node scripts/mint-seller-identity.mjs --slug <slug> [--dry-run]'); process.exit(1); }

const SEED = process.env.AGENT_WALLET_SEED;
const RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL;
const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SEED) { console.error('FATAL: AGENT_WALLET_SEED required'); process.exit(1); }
if (!RPC || !DEPLOYER_PK) { console.error('FATAL: NEXT_PUBLIC_BASE_RPC_URL / DEPLOYER_PRIVATE_KEY required'); process.exit(1); }
if (!SB_URL || !SB_KEY) { console.error('FATAL: Supabase URL / service key required'); process.exit(1); }

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const IDENTITY_ABI = [
  'function register(string calldata agentURI) external returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
];
const FUND_ETH = '0.00005';

function deriveAgentWallet(id) {
  for (let i = 0; i < 8; i++) {
    const pk = '0x' + crypto.createHmac('sha256', SEED).update(`agent-wallet|${id}|${i}`).digest('hex');
    try { return new ethers.Wallet(pk); } catch { /* out of curve order */ }
  }
  return null;
}

const provider = new ethers.JsonRpcProvider(RPC);
const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

(async () => {
  console.log(`──── Seller Identity Mint: ${SLUG} ────  (dry-run: ${DRY ? 'YES' : 'no'})`);

  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, agent_wallet_address, erc8004_agent_id')
    .eq('slug', SLUG)
    .single();
  if (error || !seller) { console.error(`FATAL: seller "${SLUG}" not found: ${error?.message}`); process.exit(1); }

  const wallet = deriveAgentWallet(seller.id).connect(provider);
  console.log(`[1] store id ${seller.id}`);
  console.log(`    derived agent wallet ${wallet.address}`);
  console.log(`    on-record agent wallet ${seller.agent_wallet_address ?? '-'} (erc8004 ${seller.erc8004_agent_id ?? '-'})`);

  if (DRY) { console.log('    DRY RUN — stopping before any on-chain action.'); return; }

  // Fund the derived wallet for the self-register, unless it already has gas.
  const fundWei = ethers.parseEther(FUND_ETH);
  const wBal0 = await provider.getBalance(wallet.address);
  if (wBal0 >= fundWei / 2n) {
    console.log(`[2] derived wallet already funded (${ethers.formatEther(wBal0)} ETH), skipping fund`);
  } else {
    const depBal = await provider.getBalance(deployer.address);
    console.log(`[2] deployer ${deployer.address} balance ${ethers.formatEther(depBal)} ETH`);
    if (depBal < fundWei * 2n) { console.error('FATAL: deployer balance too low'); process.exit(1); }
    const tx1 = await deployer.sendTransaction({ to: wallet.address, value: fundWei });
    console.log(`    fund tx ${tx1.hash} …`);
    await tx1.wait(2);
    for (let i = 0; i < 30; i++) {
      const b = await provider.getBalance(wallet.address);
      if (b > 0n) { console.log(`    derived wallet balance ${ethers.formatEther(b)} ETH`); break; }
      if (i === 29) { console.error('FATAL: derived wallet still shows 0 after polling'); process.exit(1); }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const agentUri = JSON.stringify({
    name: `${seller.name || seller.slug} Sales Agent`,
    description: `Sales agent on VIA for ${seller.name || seller.slug}.`,
    agentWallet: wallet.address.toLowerCase(),
    endpoint: `https://app.getvia.xyz/sellers/${seller.slug}/mcp`,
    protocols: ['mcp', 'erc8004', 'x402'],
    capabilities: ['offer', 'sell', 'reputation'],
    platform: 'VIA',
    tier: 'sales_agent',
    slug: seller.slug,
  });
  console.log(`[3] register(agentURI) on ${IDENTITY_REGISTRY}`);

  const identity = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, wallet);
  let agentId = null, registerTx = null;
  const bal0 = await identity.balanceOf(wallet.address);
  if (bal0 > 0n) {
    agentId = (await identity.tokenOfOwnerByIndex(wallet.address, 0)).toString();
    console.log(`    ✓ derived wallet already registered, agent ID ${agentId} (linking, not minting)`);
  } else {
    let lastErr = null;
    for (let attempt = 1; attempt <= 4 && agentId === null; attempt++) {
      try {
        const nonce = await provider.getTransactionCount(wallet.address, 'latest');
        const tx2 = await identity.register(agentUri, { nonce });
        console.log(`    register tx ${tx2.hash} (attempt ${attempt}) …`);
        const r2 = await tx2.wait(1);
        registerTx = r2.hash;
        const transfer = r2.logs.find(l => l.topics[0] === ethers.id('Transfer(address,address,uint256)'));
        agentId = transfer && transfer.topics[3]
          ? BigInt(transfer.topics[3]).toString()
          : (await identity.tokenOfOwnerByIndex(wallet.address, 0)).toString();
        console.log(`    ✓ minted agent ID ${agentId} (owner ${wallet.address})`);
      } catch (e) {
        lastErr = e;
        console.log(`    attempt ${attempt} failed: ${e.shortMessage || e.message}; retrying in 3s`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    if (agentId === null) throw lastErr;
  }

  console.log('\n──── RESULT (JSON, no private key) ────');
  console.log(JSON.stringify({
    slug: seller.slug,
    store_id: seller.id,
    agent_wallet_address: wallet.address.toLowerCase(),
    erc8004_agent_id: agentId,
    register_tx: registerTx,
    old_agent_wallet: (seller.agent_wallet_address || '').toLowerCase() || null,
    old_erc8004: seller.erc8004_agent_id ?? null,
  }, null, 2));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
