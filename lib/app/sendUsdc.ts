/**
 * Client-side USDC transfer from a Thirdweb embedded wallet to the platform wallet.
 * Used in the "Buy with Card" flow after the user has on-ramped USDC via Thirdweb Pay.
 */

import { prepareContractCall, sendTransaction, getContract } from 'thirdweb';
import { base } from 'thirdweb/chains';
import { thirdwebClient } from './thirdwebClient';
import type { Account } from 'thirdweb/wallets';

const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET
  ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET
  ?? '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

/**
 * Send USDC from a Thirdweb embedded wallet to the platform wallet.
 * @param account  - The active Thirdweb account (embedded wallet)
 * @param amountUsdc - Amount in USDC (human-readable, e.g. 10.00)
 * @returns Transaction hash
 */
export async function sendUsdcToplatform(
  account: Account,
  amountUsdc: number,
): Promise<string> {
  const usdcContract = getContract({
    client: thirdwebClient,
    chain: base,
    address: USDC_ADDRESS,
  });

  // USDC has 6 decimals
  const amount6dp = BigInt(Math.round(amountUsdc * 1_000_000));

  const tx = prepareContractCall({
    contract: usdcContract,
    method: 'function transfer(address to, uint256 value) returns (bool)',
    params: [PLATFORM_WALLET, amount6dp],
  });

  const result = await sendTransaction({ transaction: tx, account });

  return result.transactionHash;
}
