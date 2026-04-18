/**
 * POST /api/rrg/admin/erc8004-test
 * Admin-only endpoint to test ERC-8004 integration.
 *
 * Performs:
 *   1. Reads current on-chain tokenURI (identity check)
 *   2. Dry-runs a giveFeedback gas estimate (confirms operator wallet can call it)
 *   3. Optionally fires a REAL reputation signal if ?live=true is passed
 *
 * The operator wallet (DEPLOYER_PRIVATE_KEY) needs Base mainnet ETH for live mode.
 * In dry-run mode no gas is spent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminFromCookies, adminUnauthorized } from '@/lib/rrg/auth';
import { getAgentUri, postReputationSignal, DRHOBBS_AGENT_ID } from '@/lib/rrg/erc8004';
import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const REPUTATION_ADDR = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
// ABI confirmed from deployed contract bytecode (EIP-1967 proxy, selector 0x3c036a7e):
// int128 (not int256), string tags (not bytes32)
const REPUTATION_ABI  = [
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string calldata endpoint, string calldata feedbackURI, bytes32 feedbackHash) external',
];

export async function POST(req: NextRequest) {
  if (!(await isAdminFromCookies())) return adminUnauthorized();

  const { searchParams } = new URL(req.url);
  const live = searchParams.get('live') === 'true';

  const results: Record<string, unknown> = {};

  // ── 1. Identity check ─────────────────────────────────────────────────
  try {
    const tokenUri = await getAgentUri();
    results.identity = {
      ok:       true,
      agentId:  DRHOBBS_AGENT_ID.toString(),
      tokenUri,
      profileUrl: `https://8004scan.io/agents/base/${DRHOBBS_AGENT_ID}`,
    };
  } catch (err) {
    results.identity = { ok: false, error: String(err) };
  }

  // ── 2. Operator wallet check ──────────────────────────────────────────
  try {
    const provider  = new ethers.JsonRpcProvider(
      process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org'
    );
    const signer    = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
    const balance   = await provider.getBalance(signer.address);
    const feeData   = await provider.getFeeData();

    results.operatorWallet = {
      address:    signer.address,
      balanceEth: ethers.formatEther(balance),
      gasPriceGwei: ethers.formatUnits(feeData.gasPrice ?? 0n, 'gwei'),
      hasFunds:   balance > 0n,
    };

    // Dry-run gas estimate
    const contract = new ethers.Contract(REPUTATION_ADDR, REPUTATION_ABI, signer);
    const testHash = ethers.keccak256(ethers.toUtf8Bytes('test-' + Date.now()));
    try {
      const gasEst = await contract.giveFeedback.estimateGas(
        DRHOBBS_AGENT_ID,
        5n, 0,
        'purchase',
        'rrg',
        'https://realrealgenuine.com/mcp',
        'https://realrealgenuine.com/rrg/drop/1',
        testHash,
      );
      const estCostEth = ethers.formatEther(gasEst * (feeData.gasPrice ?? 1000000n));
      results.dryRun = { ok: true, gasUnits: gasEst.toString(), estimatedCostEth: estCostEth };
    } catch (gasErr) {
      results.dryRun = { ok: false, error: String(gasErr) };
    }
  } catch (err) {
    results.operatorWallet = { ok: false, error: String(err) };
  }

  // ── 3. Live signal (only if ?live=true and funded) ────────────────────
  if (live) {
    try {
      const testTxHash = '0x' + '0'.repeat(62) + 'test'; // dummy hash for test
      const signalHash = await postReputationSignal({
        buyerAgentId: DRHOBBS_AGENT_ID,
        buyerWallet:  '0x0000000000000000000000000000000000000001',
        priceUsdc:    '1.00',
        tokenId:      1,
        txHash:       testTxHash,
      });
      results.liveSignal = { ok: true, signalTxHash: signalHash };
    } catch (err) {
      results.liveSignal = { ok: false, error: String(err) };
    }
  }

  return NextResponse.json({ timestamp: new Date().toISOString(), ...results });
}
