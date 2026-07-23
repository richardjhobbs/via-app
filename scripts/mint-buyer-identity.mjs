/**
 * scripts/mint-buyer-identity.mjs
 *
 * Mint (or link) an ERC-8004 identity for a buying agent on Base mainnet via the
 * PERMISSIONLESS Identity Registry register(). The buyer's IDENTITY wallet is
 * PLATFORM-DERIVED from AGENT_WALLET_SEED + buyer id (same scheme as sellers,
 * lib/app/agent-wallet.ts), so it is re-derivable — no private key is ever
 * stored at rest. This is DISTINCT from the buyer's thirdweb spend wallet
 * (app_buyers.wallet_address), which the buyer alone controls and which the
 * platform cannot sign for.
 *
 *   1. Look up the buyer by --handle (id, display_name, wallet_address).
 *   2. Derive the identity wallet from the buyer id.
 *   3. Fund it ~0.00005 ETH from DEPLOYER (idempotent: skips if already funded).
 *   4. From the derived wallet, register(agentURI) -> mints the token to it.
 *      Idempotent: if the derived wallet already owns a token, links not remints.
 *   5. Print the identity ADDRESS + token id (NEVER a private key).
 *
 * The DB UPDATE (agent_wallet_address + erc8004_agent_id) is done by the caller.
 * The buying agent never signs x402 (sellers pay the microfees), so the identity
 * wallet only ever needs gas to register/update its own token.
 *
 * Usage: node scripts/mint-buyer-identity.mjs --handle the-real-richard-h [--dry-run]
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
const HANDLE = flag('--handle');
const DRY = args.includes('--dry-run');
if (!HANDLE || typeof HANDLE !== 'string') { console.error('Usage: node scripts/mint-buyer-identity.mjs --handle <handle> [--dry-run]'); process.exit(1); }

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
  console.log(`──── Buyer Identity Mint: ${HANDLE} ────  (dry-run: ${DRY ? 'YES' : 'no'})`);

  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name, wallet_address, agent_wallet_address, erc8004_agent_id')
    .eq('handle', HANDLE)
    .single();
  if (error || !buyer) { console.error(`FATAL: buyer "${HANDLE}" not found: ${error?.message}`); process.exit(1); }

  const wallet = deriveAgentWallet(buyer.id).connect(provider);
  console.log(`[1] buyer id ${buyer.id}`);
  console.log(`    derived identity wallet ${wallet.address}`);
  console.log(`    spend wallet            ${buyer.wallet_address ?? '-'}`);
  console.log(`    on-record identity ${buyer.agent_wallet_address ?? '-'} (erc8004 ${buyer.erc8004_agent_id ?? '-'})`);

  if (DRY) { console.log('    DRY RUN — stopping before any on-chain action.'); return; }

  // Fund the derived wallet for the self-register, unless it already has gas.
  const fundWei = ethers.parseEther(FUND_ETH);
  const wBal0 = await provider.getBalance(wallet.address);
  if (wBal0 >= fundWei / 2n) {
    console.log(`[2] identity wallet already funded (${ethers.formatEther(wBal0)} ETH), skipping fund`);
  } else {
    const depBal = await provider.getBalance(deployer.address);
    console.log(`[2] deployer ${deployer.address} balance ${ethers.formatEther(depBal)} ETH`);
    if (depBal < fundWei * 2n) { console.error('FATAL: deployer balance too low'); process.exit(1); }
    const tx1 = await deployer.sendTransaction({ to: wallet.address, value: fundWei });
    console.log(`    fund tx ${tx1.hash} …`);
    await tx1.wait(2);
    for (let i = 0; i < 30; i++) {
      const b = await provider.getBalance(wallet.address);
      if (b > 0n) { console.log(`    identity wallet balance ${ethers.formatEther(b)} ETH`); break; }
      if (i === 29) { console.error('FATAL: identity wallet still shows 0 after polling'); process.exit(1); }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const agentUri = JSON.stringify({
    name: `${buyer.display_name || buyer.handle} Buying Agent`,
    description: `Buying agent on VIA for ${buyer.display_name || buyer.handle}.`,
    agentWallet: wallet.address.toLowerCase(),
    endpoint: `https://app.getvia.xyz/buyers/${buyer.handle}/mcp`,
    protocols: ['mcp', 'erc8004', 'x402'],
    capabilities: ['intent', 'broadcast', 'review'],
    platform: 'VIA',
    tier: 'buying_agent',
    handle: buyer.handle,
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
    handle: buyer.handle,
    buyer_id: buyer.id,
    agent_wallet_address: wallet.address.toLowerCase(),
    erc8004_agent_id: agentId,
    register_tx: registerTx,
    old_identity_wallet: (buyer.agent_wallet_address || '').toLowerCase() || null,
    old_erc8004: buyer.erc8004_agent_id ?? null,
  }, null, 2));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
