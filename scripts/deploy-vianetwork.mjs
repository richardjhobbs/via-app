/**
 * deploy-vianetwork.mjs — Deploy VIAnetwork.sol to a Base network.
 *
 * Usage:
 *   node scripts/deploy-vianetwork.mjs --network sepolia
 *   node scripts/deploy-vianetwork.mjs --network mainnet
 *
 * Requires (in .env.local, gitignored):
 *   DEPLOYER_PRIVATE_KEY            — pays gas
 *   NEXT_PUBLIC_BASE_RPC_URL        — Base mainnet RPC
 *   NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL — Base Sepolia RPC
 *   NEXT_PUBLIC_USDC_CONTRACT_MAINNET — Base mainnet USDC address
 *   NEXT_PUBLIC_USDC_CONTRACT_TESTNET — Base Sepolia USDC address
 *   NEXT_PUBLIC_PLATFORM_WALLET     — the VIA platform wallet (receives 100% USDC on mint;
 *                                     off-chain auto-payout sends seller's 97.5%)
 *
 * Run hardhat compile first to populate ./artifacts.
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const argv = process.argv.slice(2);
const networkIdx = argv.indexOf('--network');
const network = networkIdx >= 0 ? argv[networkIdx + 1] : 'sepolia';
if (!['sepolia', 'mainnet'].includes(network)) {
  console.error('--network must be sepolia or mainnet');
  process.exit(1);
}

const RPC_URL = network === 'sepolia'
  ? (process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
  : (process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org');

const USDC = network === 'sepolia'
  ? process.env.NEXT_PUBLIC_USDC_CONTRACT_TESTNET
  : process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET;

const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET;
const DEPLOYER_KEY    = process.env.DEPLOYER_PRIVATE_KEY;
const BASE_URI        = process.env.NEXT_PUBLIC_LISTING_BASE_URI || 'https://app.getvia.xyz/api/listings/';

if (!DEPLOYER_KEY)    { console.error('DEPLOYER_PRIVATE_KEY not set'); process.exit(1); }
if (!USDC)            { console.error(`USDC address not set for ${network}`); process.exit(1); }
if (!PLATFORM_WALLET) { console.error('NEXT_PUBLIC_PLATFORM_WALLET not set'); process.exit(1); }

const artifactPath = './artifacts/contracts/VIAnetwork.sol/VIAnetwork.json';
let artifact;
try {
  artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
} catch {
  console.error(`Missing artifact at ${artifactPath}. Run: npx hardhat compile`);
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(DEPLOYER_KEY, provider);

console.log(`Network:        Base ${network} (${RPC_URL})`);
console.log(`Deployer:       ${wallet.address}`);
console.log(`USDC:           ${USDC}`);
console.log(`PlatformWallet: ${PLATFORM_WALLET}`);
console.log(`BaseURI:        ${BASE_URI}`);

const balance = await provider.getBalance(wallet.address);
console.log(`Balance:        ${ethers.formatEther(balance)} ETH`);

if (balance === 0n) {
  console.error(`\nDeployer wallet has zero ETH on Base ${network}. Fund it before deploying.`);
  console.error(`Sepolia faucet: https://www.alchemy.com/faucets/base-sepolia`);
  process.exit(1);
}

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
console.log('\nDeploying VIAnetwork...');
const contract = await factory.deploy(USDC, PLATFORM_WALLET, BASE_URI);
const tx = contract.deploymentTransaction();
console.log(`Tx hash:        ${tx.hash}`);
console.log('Waiting for confirmation...');

await contract.waitForDeployment();
const address = await contract.getAddress();

console.log(`\nVIAnetwork deployed to: ${address}`);
console.log(`\nNext steps:`);
console.log(`  1. vercel env add NEXT_PUBLIC_VIA_CONTRACT_ADDRESS production`);
console.log(`     -> ${address}`);
console.log(`  2. vercel env add NEXT_PUBLIC_VIA_CONTRACT_ADDRESS preview`);
console.log(`     -> ${address}`);
console.log(`  3. Verify on BaseScan: https://${network === 'sepolia' ? 'sepolia.basescan.org' : 'basescan.org'}/address/${address}`);
