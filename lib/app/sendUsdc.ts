/**
 * Gasless human checkout: build a signed EIP-2612 USDC permit the buyer signs
 * (no ETH/gas needed); the server executes it. The buyer never pays gas.
 */

import type { Account } from 'thirdweb/wallets';

const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET
  ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET
  ?? '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed';

const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org';

/**
 * Build a GASLESS x402 payment for the human checkout: the buyer SIGNS an
 * EIP-2612 USDC permit (no gas, no ETH needed) authorising the platform wallet
 * to pull `amountUsdc`. The server (/api/x402/purchase, verifyAndExecutePayment)
 * executes permit() + transferFrom() and pays the gas. Returns the base64
 * X-PAYMENT string to POST as `x_payment`.
 *
 * This replaces the old self-paid ERC-20 transfer, which required the buyer's
 * wallet to hold ETH for gas and failed for USDC-only wallets.
 */
export async function buildUsdcPermitXPayment(account: Account, amountUsdc: number): Promise<string> {
  const owner = account.address;
  const value = BigInt(Math.round(amountUsdc * 1_000_000));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  // EIP-2612 permit nonce is the USDC contract's sequential nonces(owner).
  const data = '0x7ecebe00' + owner.slice(2).toLowerCase().padStart(64, '0');
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: USDC_ADDRESS, data }, 'latest'] }),
  });
  const json = await res.json();
  if (!json?.result) throw new Error('Could not read wallet nonce for payment');
  const nonce = BigInt(json.result);

  const signature = await account.signTypedData({
    domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC_ADDRESS as `0x${string}` },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: { owner: owner as `0x${string}`, spender: PLATFORM_WALLET as `0x${string}`, value, nonce, deadline },
  });

  const payload = {
    scheme: 'exact',
    network: 'base',
    payload: {
      signature,
      authorization: {
        from: owner,
        to: PLATFORM_WALLET,
        value: value.toString(),
        validAfter: '0',
        validBefore: deadline.toString(),
        nonce: nonce.toString(),
      },
    },
  };
  return btoa(JSON.stringify(payload));
}
