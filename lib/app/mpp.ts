/**
 * MPP (Machine Payments Protocol) Server Configuration
 *
 * Configures mppx for accepting machine payments via HTTP 402.
 * Currently supports Tempo (PathUSD stablecoins).
 * Stripe card support can be added when preview API access is granted.
 *
 * Usage: import { mppx } from '@/lib/app/mpp'
 *        export const GET = mppx.charge({ amount: '1.50' })(handler)
 */

import { Mppx, tempo } from 'mppx/server';

const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET
  || '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

/**
 * Shared Mppx instance configured with Tempo (PathUSD) payment method.
 * Payments settle to the RRG platform wallet.
 */
export const mppx = Mppx.create({
  methods: [
    tempo({
      chainId: 4217,  // Tempo mainnet
      currency: '0x20C000000000000000000000b9537d11c60E8b50', // PathUSD
      recipient: PLATFORM_WALLET as `0x${string}`,
    }),
    // Future: add stripe() when Stripe MPP preview access is granted
    // stripe({ apiKey: process.env.STRIPE_SECRET_KEY! }),
  ],
});
