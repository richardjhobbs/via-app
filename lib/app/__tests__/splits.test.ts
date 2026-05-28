/**
 * Guardrail C — invariant test for calculateSplit().onChainCreator.
 *
 * Locks the contract surface that the entire registerDrop-creator bug class
 * depends on. If anyone ever flips one of these by accident (e.g. "let me
 * just pass the brand wallet for tiered drops"), this test fails BEFORE the
 * code reaches production.
 *
 * Reference: lib/app/splits.ts:130-194 + memory/feedback_register_drop_creator_must_be_platform.md
 *
 * Run via:   npm run test
 * Direct:    node --test --experimental-strip-types lib/app/__tests__/splits.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSplit, PLATFORM_WALLET, RRG_BRAND_ID } from '../splits.ts';

const CREATOR_WALLET = '0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc';
const BRAND_WALLET   = '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb';
const EXTERNAL_BRAND_ID = '11111111-2222-3333-4444-555555555555';

test('legacy_70_30: onChainCreator is the creator wallet (atomic 70% on-chain)', () => {
  const split = calculateSplit({
    totalUsdc:      10,
    sellerId:        null,
    creatorWallet:  CREATOR_WALLET,
    sellerWallet:    null,
    isSellerProduct: false,
    isLegacy:       true,
  });
  assert.equal(split.splitType, 'legacy_70_30');
  assert.equal(split.onChainCreator, CREATOR_WALLET);
});

test('seller_product_tiered: onChainCreator MUST be PLATFORM_WALLET', () => {
  const split = calculateSplit({
    totalUsdc:      10,
    sellerId:        EXTERNAL_BRAND_ID,
    creatorWallet:  CREATOR_WALLET,
    sellerWallet:    BRAND_WALLET,
    isSellerProduct: true,
    isLegacy:       false,
  });
  assert.equal(split.splitType, 'seller_product_tiered');
  assert.equal(split.onChainCreator, PLATFORM_WALLET,
    'CRITICAL: brand-product drops must register PLATFORM_WALLET as on-chain creator. ' +
    'A regression here causes 67.5% platform loss per mintWithPermit sale.');
  // Settlement is 97.5% brand / 2.5% platform off-chain
  assert.equal(split.sellerUsdc,    9.75);
  assert.equal(split.platformUsdc, 0.25);
  assert.equal(split.creatorUsdc,  0);
});

test('rrg_challenge_35_65: onChainCreator is PLATFORM_WALLET', () => {
  const split = calculateSplit({
    totalUsdc:      10,
    sellerId:        RRG_BRAND_ID,
    creatorWallet:  CREATOR_WALLET,
    sellerWallet:    null,
    isSellerProduct: false,
    isLegacy:       false,
  });
  assert.equal(split.splitType, 'rrg_challenge_35_65');
  assert.equal(split.onChainCreator, PLATFORM_WALLET);
  assert.equal(split.creatorUsdc, 3.5);
});

test('challenge_35_35_30: onChainCreator is PLATFORM_WALLET', () => {
  const split = calculateSplit({
    totalUsdc:      10,
    sellerId:        EXTERNAL_BRAND_ID,
    creatorWallet:  CREATOR_WALLET,
    sellerWallet:    BRAND_WALLET,
    isSellerProduct: false,
    isLegacy:       false,
  });
  assert.equal(split.splitType, 'challenge_35_35_30');
  assert.equal(split.onChainCreator, PLATFORM_WALLET);
  assert.equal(split.creatorUsdc, 3.5);
  assert.equal(split.sellerUsdc,   3.5);
  assert.equal(split.platformUsdc, 3.0);
});

test('seller_product_tiered with sellerPctOverride respects override', () => {
  const split = calculateSplit({
    totalUsdc:        100,
    sellerId:          EXTERNAL_BRAND_ID,
    creatorWallet:    CREATOR_WALLET,
    sellerWallet:      BRAND_WALLET,
    isSellerProduct:   true,
    isLegacy:         false,
    sellerPctOverride: 90,
  });
  assert.equal(split.splitType, 'seller_product_tiered');
  assert.equal(split.onChainCreator, PLATFORM_WALLET, 'override must not change on-chain creator');
  assert.equal(split.sellerUsdc,    90);
  assert.equal(split.platformUsdc, 10);
});

test('PLATFORM_WALLET sourced from env (or default) is non-zero', () => {
  assert.ok(PLATFORM_WALLET);
  assert.ok(PLATFORM_WALLET.startsWith('0x'));
  assert.equal(PLATFORM_WALLET.length, 42);
});
