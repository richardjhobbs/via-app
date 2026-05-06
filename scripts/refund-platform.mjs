#!/usr/bin/env node
/**
 * One-shot refund from PLATFORM_WALLET (signed by PLATFORM_PRIVATE_KEY).
 *
 * Usage:
 *   node scripts/refund-platform.mjs <destination> <amountUsdc> [reason]
 *
 * Example (refund 2 USDC):
 *   node scripts/refund-platform.mjs 0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75 2 "topup misroute"
 *
 * Requires PLATFORM_PRIVATE_KEY in env (VPS .env.local).
 */
import { ethers } from 'ethers';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RPC_URL      = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org';
const PK           = process.env.PLATFORM_PRIVATE_KEY;

const [, , dest, amountStr, ...reasonParts] = process.argv;
const reason = reasonParts.join(' ') || '(no reason given)';

if (!PK) {
  console.error('FATAL: PLATFORM_PRIVATE_KEY not set');
  process.exit(1);
}
if (!dest || !ethers.isAddress(dest)) {
  console.error(`FATAL: invalid destination address: ${dest}`);
  process.exit(1);
}
const amountUsdc = Number(amountStr);
if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
  console.error(`FATAL: invalid amount: ${amountStr}`);
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(PK, provider);
const ERC20    = ['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address a) view returns (uint256)'];
const usdc     = new ethers.Contract(USDC_ADDRESS, ERC20, signer);

const amount6dp = BigInt(Math.round(amountUsdc * 1_000_000));

console.log('— Refund from PLATFORM_WALLET —');
console.log(`  signer       : ${await signer.getAddress()}`);
console.log(`  destination  : ${dest}`);
console.log(`  amount       : ${amountUsdc} USDC (${amount6dp.toString()} units)`);
console.log(`  reason       : ${reason}`);

const balBefore = await usdc.balanceOf(await signer.getAddress());
console.log(`  balance pre  : ${Number(balBefore) / 1_000_000} USDC`);

if (balBefore < amount6dp) {
  console.error(`FATAL: insufficient platform balance`);
  process.exit(1);
}

const tx = await usdc.transfer(dest, amount6dp);
console.log(`  tx submitted : ${tx.hash}`);
const receipt = await tx.wait(1);
console.log(`  tx confirmed : block ${receipt.blockNumber}, status ${receipt.status}`);
console.log(`  basescan     : https://basescan.org/tx/${tx.hash}`);

const balAfter = await usdc.balanceOf(await signer.getAddress());
console.log(`  balance post : ${Number(balAfter) / 1_000_000} USDC`);
