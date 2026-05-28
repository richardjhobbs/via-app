/**
 * Guardrail C — invariant test for calculateSplit().onChainCreator.
 *
 * Locks the contract surface the registerDrop-creator bug class depends on:
 * for every via-app sale, onChainCreator MUST be PLATFORM_WALLET so 100% of
 * buyer USDC lands in platform reserves on mint. The off-chain auto-payout
 * then sends the seller their 97.5% share. If anyone flips this (e.g. "let
 * me pass the seller wallet"), this test fails BEFORE production.
 *
 * Reference: lib/app/splits.ts + memory/feedback_register_drop_creator_must_be_platform.md
 *
 * Run via:   npm run test
 * Direct:    node --test --experimental-strip-types lib/app/__tests__/splits.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSplit, PLATFORM_WALLET, applyCardFeeDeduction } from '../splits.ts';

const SELLER_WALLET = '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb';

test('default 97.5/2.5 split: seller gets 97.5%, platform 2.5%', () => {
  const split = calculateSplit({
    totalUsdc:    100,
    sellerWallet: SELLER_WALLET,
  });
  assert.equal(split.splitType, 'seller_product_tiered');
  assert.equal(split.sellerUsdc, 97.5);
  assert.equal(split.platformUsdc, 2.5);
  assert.equal(split.sellerWallet, SELLER_WALLET);
});

test('onChainCreator is ALWAYS PLATFORM_WALLET (Guardrail C)', () => {
  // Across a range of inputs, onChainCreator never deviates from PLATFORM_WALLET.
  const cases = [
    { totalUsdc: 10,    sellerWallet: SELLER_WALLET },
    { totalUsdc: 1000,  sellerWallet: SELLER_WALLET },
    { totalUsdc: 0.01,  sellerWallet: SELLER_WALLET },
    { totalUsdc: 100,   sellerWallet: SELLER_WALLET, sellerPctOverride: 95 },
    { totalUsdc: 100,   sellerWallet: SELLER_WALLET, sellerPctOverride: 0 },
    { totalUsdc: 100,   sellerWallet: SELLER_WALLET, sellerPctOverride: 100 },
  ];
  for (const input of cases) {
    const split = calculateSplit(input);
    assert.equal(
      split.onChainCreator,
      PLATFORM_WALLET,
      `onChainCreator drifted for input ${JSON.stringify(input)}`,
    );
  }
});

test('sellerPctOverride: 95% seller / 5% platform', () => {
  const split = calculateSplit({
    totalUsdc:           100,
    sellerWallet:        SELLER_WALLET,
    sellerPctOverride:   95,
  });
  assert.equal(split.sellerUsdc, 95);
  assert.equal(split.platformUsdc, 5);
});

test('sellerPctOverride out-of-range falls back to default 97.5', () => {
  const tooHigh = calculateSplit({
    totalUsdc:           100,
    sellerWallet:        SELLER_WALLET,
    sellerPctOverride:   101,
  });
  assert.equal(tooHigh.sellerUsdc, 97.5);

  const negative = calculateSplit({
    totalUsdc:           100,
    sellerWallet:        SELLER_WALLET,
    sellerPctOverride:   -1,
  });
  assert.equal(negative.sellerUsdc, 97.5);
});

test('totals sum to input (no penny drift on round numbers)', () => {
  const split = calculateSplit({
    totalUsdc:    100,
    sellerWallet: SELLER_WALLET,
  });
  assert.equal(split.sellerUsdc + split.platformUsdc, split.totalUsdc);
});

test('applyCardFeeDeduction: card fee comes out of seller share', () => {
  const base = calculateSplit({
    totalUsdc:    100,
    sellerWallet: SELLER_WALLET,
  });
  const adjusted = applyCardFeeDeduction(base, 3.5);
  assert.equal(adjusted.sellerUsdc, 94);
  assert.equal(adjusted.platformUsdc, 2.5);
  assert.equal(adjusted.cardFeeUsdc, 3.5);
});

test('applyCardFeeDeduction: never pushes seller share below zero', () => {
  const base = calculateSplit({
    totalUsdc:    1,
    sellerWallet: SELLER_WALLET,
  });
  const adjusted = applyCardFeeDeduction(base, 999);
  assert.equal(adjusted.sellerUsdc, 0);
});
