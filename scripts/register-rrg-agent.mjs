/**
 * scripts/register-rrg-agent.mjs
 * One-time script: Register a new ERC-8004 agent identity for Real Real Genuine
 * on Base mainnet. Sets tokenURI to https://realrealgenuine.com/agent.json
 *
 * Usage: node scripts/register-rrg-agent.mjs
 *
 * Requires .env.local with:
 *   DEPLOYER_PRIVATE_KEY — wallet that will own the agent NFT
 *   NEXT_PUBLIC_BASE_RPC_URL — Base mainnet RPC (optional, defaults to https://mainnet.base.org)
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local');
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {
  console.error('Could not read .env.local — make sure it exists');
  process.exit(1);
}

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPC_URL           = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org';
const PRIVATE_KEY       = process.env.DEPLOYER_PRIVATE_KEY;
const AGENT_URI         = 'https://realrealgenuine.com/agent.json';

if (!PRIVATE_KEY) {
  console.error('DEPLOYER_PRIVATE_KEY not set in .env.local');
  process.exit(1);
}

// Minimal ABI — just the register function
// ERC-8004 Identity Registry register() mints a new agent NFT and sets its URI
const ABI = [
  'function register(string calldata agentURI) external returns (uint256)',
  'function totalSupply() external view returns (uint256)',
];

async function main() {
  console.log('=== ERC-8004 Agent Registration ===');
  console.log(`Registry: ${IDENTITY_REGISTRY}`);
  console.log(`RPC:      ${RPC_URL}`);
  console.log(`URI:      ${AGENT_URI}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Wallet:   ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error('Wallet has no ETH — fund it first!');
    process.exit(1);
  }

  const registry = new ethers.Contract(IDENTITY_REGISTRY, ABI, wallet);

  // Check current supply for reference
  try {
    const supply = await registry.totalSupply();
    console.log(`Current total supply: ${supply}`);
  } catch {
    console.log('(could not read totalSupply)');
  }

  console.log('\nRegistering agent...');
  const tx = await registry.register(AGENT_URI);
  console.log(`Tx hash: ${tx.hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await tx.wait(1);
  console.log(`Confirmed in block ${receipt.blockNumber}`);

  // Parse the Transfer event to get the new agent ID (token ID)
  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const transferLog = receipt.logs.find(l => l.topics[0] === transferTopic);

  if (transferLog && transferLog.topics.length >= 4) {
    const agentId = BigInt(transferLog.topics[3]);
    console.log(`\n✅ Agent registered!`);
    console.log(`   Agent ID: ${agentId}`);
    console.log(`   Profile:  https://8004scan.io/agents/base/${agentId}`);
    console.log(`\n   Update lib/app/erc8004.ts:`);
    console.log(`   export const RRG_AGENT_ID = ${agentId}n;`);
  } else {
    console.log('\n⚠️  Could not parse agent ID from receipt. Check Basescan:');
    console.log(`   https://basescan.org/tx/${receipt.hash}`);
  }
}

main().catch(err => {
  console.error('Registration failed:', err);
  process.exit(1);
});
