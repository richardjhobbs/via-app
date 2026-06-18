/**
 * One-off: seed the 2 RRG demo signer wallets with a USDC float so they can pay
 * the x402 door micro-fee (EIP-3009). Sends from the platform treasury
 * (PLATFORM_PRIVATE_KEY). Prints balances + tx hashes only.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ethers } from 'ethers';

const env = {};
for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const RPC = env.NEXT_PUBLIC_BASE_RPC_URL;
const KEY = env.PLATFORM_PRIVATE_KEY;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ABI = ['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
const FLOAT = Number(env.VIA_AGENT_FLOAT_USDC ?? '0.1');

const TARGETS = [
  { slug: 'americanrag',          addr: '0xF88723e81CFd736Dea44a09E5987a5eeb2A57070' },
  { slug: 'standard-and-strange', addr: '0x60de520F64Af4F16c00C5a5158895A878DfD2D9c' },
];

const p = new ethers.JsonRpcProvider(RPC);
const treasury = new ethers.Wallet(KEY, p);
const usdc = new ethers.Contract(USDC, ABI, treasury);
const amount6 = BigInt(Math.round(FLOAT * 1_000_000));

console.log('treasury', treasury.address);
console.log('treasury ETH', ethers.formatEther(await p.getBalance(treasury.address)));
console.log('treasury USDC', ethers.formatUnits(await usdc.balanceOf(treasury.address), 6));

for (const t of TARGETS) {
  const bal = await usdc.balanceOf(t.addr);
  if (bal >= amount6) { console.log(`\n${t.slug} already has ${ethers.formatUnits(bal, 6)} USDC, skip`); continue; }
  const tx = await usdc.transfer(t.addr, amount6);
  console.log(`\n${t.slug} ${t.addr} -> ${FLOAT} USDC tx ${tx.hash} waiting...`);
  await tx.wait(1);
  console.log(`  balance now ${ethers.formatUnits(await usdc.balanceOf(t.addr), 6)} USDC`);
}
