/**
 * scripts/mint-buyer-identity.mjs
 *
 * One-off: mint an ERC-8004 identity for a buying agent on Base mainnet via the
 * PERMISSIONLESS Identity Registry register() (same mechanism RRG uses in
 * register-brand-agent.mjs). No registrar secret required.
 *
 *   1. Generate a fresh EOA = the buyer's dedicated identity wallet (distinct
 *      from the owner's funding wallet, which may also back a seller store).
 *   2. Fund it ~0.00005 ETH from DEPLOYER.
 *   3. From the new wallet, call register(agentURI) -> mints the token to it.
 *   4. Print wallet + private key + token id. The DB row + key custody are
 *      handled by the caller (Supabase MCP update; key saved out-of-repo).
 *
 * The buyer identity wallet is a PASSIVE reputation-token holder; the buying
 * agent never signs x402 payments (sellers pay the microfees), so this wallet
 * never needs to sign. Re-derivability is therefore unnecessary here.
 *
 * Usage: node scripts/mint-buyer-identity.mjs --handle the-real-richard-h
 * Requires .env.local: DEPLOYER_PRIVATE_KEY, NEXT_PUBLIC_BASE_RPC_URL
 */
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) { const k = m[1].trim(); if (!process.env[k]) process.env[k] = m[2].trim().replace(/^["']|["']$/g, ''); }
}

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || true) : null; };
const HANDLE = flag('--handle');
const DRY = args.includes('--dry-run');
if (!HANDLE) { console.error('Usage: node scripts/mint-buyer-identity.mjs --handle <handle>'); process.exit(1); }

const RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL;
const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY;
if (!RPC || !DEPLOYER_PK) { console.error('FATAL: NEXT_PUBLIC_BASE_RPC_URL / DEPLOYER_PRIVATE_KEY required'); process.exit(1); }

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const IDENTITY_ABI = [
  'function register(string calldata agentURI) external returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
];
const FUND_ETH = '0.00005';

const provider = new ethers.JsonRpcProvider(RPC);
const deployer = new ethers.Wallet(DEPLOYER_PK, provider);

const KEY_FILE = resolve(homedir(), '.via-buyer-identity-keys.json');
const REUSE_KEY = flag('--key'); // reuse an already-funded wallet to retry register

(async () => {
  console.log(`──── Buyer Identity Mint: ${HANDLE} ────  (dry-run: ${DRY ? 'YES' : 'no'})`);
  const buyerWallet = (typeof REUSE_KEY === 'string')
    ? new ethers.Wallet(REUSE_KEY, provider)
    : ethers.Wallet.createRandom().connect(provider);
  console.log(`[1] identity EOA: ${buyerWallet.address}${typeof REUSE_KEY === 'string' ? ' (reused)' : ' (fresh)'}`);

  // Persist the key IMMEDIATELY so a mid-run RPC failure never strands the wallet.
  if (!DRY) {
    const store = existsSync(KEY_FILE) ? JSON.parse(readFileSync(KEY_FILE, 'utf8')) : {};
    store[HANDLE] = { agent_wallet_address: buyerWallet.address.toLowerCase(), agent_wallet_private_key: buyerWallet.privateKey, saved_at: new Date().toISOString() };
    writeFileSync(KEY_FILE, JSON.stringify(store, null, 2));
    console.log(`    key persisted to ${KEY_FILE}`);
  }

  const fundWei = ethers.parseEther(FUND_ETH);
  const depBal = await provider.getBalance(deployer.address);
  console.log(`[2] deployer ${deployer.address} balance ${ethers.formatEther(depBal)} ETH`);

  if (!DRY && typeof REUSE_KEY !== 'string') {
    if (depBal < fundWei * 2n) { console.error('FATAL: deployer balance too low'); process.exit(1); }
    const tx1 = await deployer.sendTransaction({ to: buyerWallet.address, value: fundWei });
    console.log(`    fund tx ${tx1.hash} …`);
    await tx1.wait(2);
  }

  // Poll until the funded balance is visible on the read node (mainnet.base.org
  // lags; register() with have-0 means a stale node served the read).
  if (!DRY) {
    for (let i = 0; i < 30; i++) {
      const b = await provider.getBalance(buyerWallet.address);
      if (b > 0n) { console.log(`    identity wallet balance ${ethers.formatEther(b)} ETH`); break; }
      if (i === 29) { console.error('FATAL: identity wallet still shows 0 after polling; rerun with --key', buyerWallet.privateKey); process.exit(1); }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const agentUri = JSON.stringify({
    name: `${HANDLE} Buying Agent`,
    description: `Buying agent on VIA for ${HANDLE}.`,
    agentWallet: buyerWallet.address.toLowerCase(),
    endpoint: `https://app.getvia.xyz/buyers/${HANDLE}/mcp`,
    protocols: ['mcp', 'erc8004', 'x402'],
    capabilities: ['intent', 'broadcast', 'review'],
    platform: 'VIA',
    tier: 'buying_agent',
    handle: HANDLE,
  });
  console.log(`[3] register(agentURI) on ${IDENTITY_REGISTRY}`);

  let agentId = null, registerTx = null;
  if (!DRY) {
    const identity = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, buyerWallet);
    // If the wallet already self-registered on a prior attempt, link not remint.
    const bal0 = await identity.balanceOf(buyerWallet.address);
    if (bal0 > 0n) {
      agentId = (await identity.tokenOfOwnerByIndex(buyerWallet.address, 0)).toString();
      console.log(`    ✓ already registered, agent ID ${agentId}`);
    } else {
      let lastErr = null;
      for (let attempt = 1; attempt <= 4 && agentId === null; attempt++) {
        try {
          const nonce = await provider.getTransactionCount(buyerWallet.address, 'latest');
          const tx2 = await identity.register(agentUri, { nonce });
          console.log(`    register tx ${tx2.hash} (attempt ${attempt}) …`);
          const r2 = await tx2.wait(1);
          registerTx = r2.hash;
          const transfer = r2.logs.find(l => l.topics[0] === ethers.id('Transfer(address,address,uint256)'));
          agentId = transfer && transfer.topics[3]
            ? BigInt(transfer.topics[3]).toString()
            : (await identity.tokenOfOwnerByIndex(buyerWallet.address, 0)).toString();
          console.log(`    ✓ minted agent ID ${agentId} (owner ${buyerWallet.address})`);
        } catch (e) {
          lastErr = e;
          console.log(`    attempt ${attempt} failed: ${e.shortMessage || e.message}; retrying in 3s`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      if (agentId === null) throw lastErr;
    }
  }

  console.log('\n──── RESULT (JSON) ────');
  console.log(JSON.stringify({
    handle: HANDLE,
    agent_wallet_address: buyerWallet.address.toLowerCase(),
    agent_wallet_private_key: buyerWallet.privateKey,
    erc8004_agent_id: agentId,
    register_tx: registerTx,
  }));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
