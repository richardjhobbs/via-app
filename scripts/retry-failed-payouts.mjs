#!/usr/bin/env node
/**
 * Retry failed distribution payouts.
 */
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RPC_URL      = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !DEPLOYER_KEY) {
  console.error('Missing env vars');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(DEPLOYER_KEY, provider);

const ERC20_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];
const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);

// Get failed distributions
const { data: failed } = await db
  .from('app_distributions')
  .select('id, purchase_id, brand_wallet, creator_wallet, creator_usdc, brand_usdc')
  .eq('status', 'failed')
  .order('created_at', { ascending: true });

if (!failed || failed.length === 0) {
  console.log('No failed distributions');
  process.exit(0);
}

console.log(`Found ${failed.length} failed distributions`);

let nonce = await signer.getNonce('latest');
console.log(`Starting nonce: ${nonce}`);

for (const dist of failed) {
  console.log(`\nRetrying ${dist.id}...`);
  const txHashes = [];

  try {
    // Creator payout
    if (dist.creator_usdc > 0 && dist.creator_wallet) {
      const amount = ethers.parseUnits(dist.creator_usdc.toString(), 6);
      console.log(`  Creator: ${dist.creator_usdc} USDC -> ${dist.creator_wallet}`);
      const tx = await usdc.transfer(dist.creator_wallet, amount, { nonce });
      console.log(`  TX: ${tx.hash}`);
      await tx.wait(1);
      txHashes.push(`creator:${tx.hash}`);
      nonce++;
    }

    // Brand payout
    if (dist.brand_usdc > 0 && dist.brand_wallet) {
      const amount = ethers.parseUnits(dist.brand_usdc.toString(), 6);
      console.log(`  Brand: ${dist.brand_usdc} USDC -> ${dist.brand_wallet}`);
      const tx = await usdc.transfer(dist.brand_wallet, amount, { nonce });
      console.log(`  TX: ${tx.hash}`);
      await tx.wait(1);
      txHashes.push(`brand:${tx.hash}`);
      nonce++;
    }

    const notes = txHashes.join(' | ') || 'No transfers needed';
    await db.from('app_distributions').update({ status: 'completed', notes }).eq('id', dist.id);
    await db.from('app_purchases').update({ payout_tx_hashes: notes }).eq('id', dist.purchase_id);
    console.log(`  ✓ Completed: ${notes}`);

  } catch (err) {
    console.error(`  ✗ Failed:`, err.message);
    await db.from('app_distributions')
      .update({ notes: `Retry failed: ${String(err).slice(0, 500)}` })
      .eq('id', dist.id);
  }
}

console.log('\nDone');
