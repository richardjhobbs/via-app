/**
 * Seed a seller's platform-derived agent wallet with a small USDC float.
 *
 * The seller agent pays the x402 door micro-fee (FEE_OFFER_USDC, ~$0.01) by
 * signing an EIP-3009 transferWithAuthorization FROM its own agent wallet; the
 * CDP facilitator sponsors the gas. So the agent wallet needs a USDC balance to
 * spend, but no ETH. This tops it up from the platform treasury.
 *
 * Funded from PLATFORM_PRIVATE_KEY (the treasury wallet 0xbfd71e, which already
 * holds the platform's USDC). The transfer is a plain ERC-20 transfer paid for
 * with the treasury's own gas.
 *
 * Non-fatal by contract: if the key/RPC is unconfigured, or the transfer fails,
 * the caller logs and continues. An unfunded agent simply skips the door until a
 * float lands; it never blocks store activation.
 */

import { ethers } from 'ethers';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DEFAULT_FLOAT_USDC = Number(process.env.VIA_AGENT_FLOAT_USDC ?? '0.1');

const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

export interface FundAgentFloatResult {
  ok:          boolean;
  skipped?:    boolean;   // key/RPC not configured , non-fatal no-op
  txHash?:     string;
  amountUsdc?: number;
  error?:      string;
}

/**
 * Transfer `amountUsdc` USDC from the platform treasury to `toAddress`.
 * Returns { ok:false, skipped:true } when unconfigured (a no-op, never throws on
 * config absence). On-chain failures are caught and returned as { ok:false }.
 */
export async function fundAgentFloat(
  toAddress: string,
  amountUsdc: number = DEFAULT_FLOAT_USDC,
): Promise<FundAgentFloatResult> {
  const rpc = process.env.NEXT_PUBLIC_BASE_RPC_URL;
  const key = process.env.PLATFORM_PRIVATE_KEY;
  if (!rpc || !key) return { ok: false, skipped: true };
  if (!ethers.isAddress(toAddress)) return { ok: false, error: `invalid agent wallet ${toAddress}` };

  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    const treasury = new ethers.Wallet(key, provider);
    const usdc = new ethers.Contract(USDC_BASE, ERC20_ABI, treasury);
    const amount6 = BigInt(Math.round(amountUsdc * 1_000_000));

    const bal = await usdc.balanceOf(treasury.address);
    if (bal < amount6) return { ok: false, error: `treasury USDC ${ethers.formatUnits(bal, 6)} < float ${amountUsdc}` };

    const tx = await usdc.transfer(toAddress, amount6);
    await tx.wait(1);
    return { ok: true, txHash: tx.hash, amountUsdc };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
