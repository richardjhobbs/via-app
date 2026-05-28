/**
 * deploy-rrg.mjs — Deploy updated RRG.sol to Base mainnet using ethers v6.
 * Run: node scripts/deploy-rrg.mjs
 */
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const RPC_URL     = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;

if (!DEPLOYER_KEY) throw new Error('DEPLOYER_PRIVATE_KEY not set');

const artifact = JSON.parse(readFileSync('./artifacts/contracts/RRG.sol/RRG.json', 'utf8'));

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(DEPLOYER_KEY, provider);

console.log('Deploying from:', wallet.address);
const balance = await provider.getBalance(wallet.address);
console.log('Balance:', ethers.formatEther(balance), 'ETH');

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
console.log('Deploying RRG...');
// Constructor: usdc, platformWallet, baseUri
const USDC            = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base mainnet USDC
const PLATFORM_WALLET = '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';
const BASE_URI        = 'https://richard-hobbs.com/api/token/';
const contract = await factory.deploy(USDC, PLATFORM_WALLET, BASE_URI);
await contract.waitForDeployment();

const address = await contract.getAddress();
console.log('\n✅ RRG deployed to:', address);
console.log('Update in .env.local and Vercel:');
console.log('  NEXT_PUBLIC_VIA_CONTRACT_ADDRESS=' + address);
