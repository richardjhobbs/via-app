/**
 * app/api/rrg/signal/route.ts
 *
 * ERC-8004 compliant off-chain feedback JSON endpoint.
 * Spec: https://eips.ethereum.org/EIPS/eip-8004
 *
 * The on-chain giveFeedback() call sets feedbackURI to this URL and
 * feedbackHash to keccak256(JSON.stringify(doc)) for verifiable integrity.
 *
 * Anyone can verify a signal by:
 *   1. Fetching this URL with the same query params as the on-chain signal
 *   2. Computing keccak256(JSON.stringify(response_body))
 *   3. Comparing to the feedbackHash emitted in the on-chain event
 *
 * Query params:
 *   to     – agentId being rated (uint256 as string)
 *   tx     – sourceTxHash (0x-prefixed, 66 chars)
 *   token  – RRG drop tokenId (uint as string)
 *   from   – (optional) clientAddress wallet (0x-prefixed, 42 chars)
 */

import { NextRequest, NextResponse } from 'next/server';

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const CHAIN             = 'eip155:8453';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const agentId  = searchParams.get('to');
  const tx_hash  = searchParams.get('tx');
  const token_id = searchParams.get('token');
  const from     = searchParams.get('from'); // optional buyer wallet

  if (!agentId || !tx_hash) {
    return NextResponse.json(
      { error: 'Missing required params: to (agentId), tx (sourceTxHash)' },
      { status: 400 },
    );
  }

  // Validate formats
  if (!/^\d+$/.test(agentId)) {
    return NextResponse.json({ error: 'Invalid agentId — must be a positive integer' }, { status: 400 });
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx_hash)) {
    return NextResponse.json({ error: 'Invalid tx — must be a 0x-prefixed 32-byte hex hash' }, { status: 400 });
  }
  if (from && !/^0x[0-9a-fA-F]{40}$/.test(from)) {
    return NextResponse.json({ error: 'Invalid from — must be a 0x-prefixed 20-byte EVM address' }, { status: 400 });
  }

  // Build the canonical ERC-8004 feedback JSON.
  // IMPORTANT: field order must exactly match the MCP tool that computed feedbackHash,
  // so that keccak256(JSON.stringify(this)) == on-chain feedbackHash.
  const doc: Record<string, unknown> = {
    agentRegistry: `${CHAIN}:${IDENTITY_REGISTRY}`,
    agentId:       Number(agentId),
    ...(from ? { clientAddress: `${CHAIN}:${from.toLowerCase()}` } : {}),
    value:         5,
    valueDecimals: 0,
    tag1:          'purchase',
    tag2:          'rrg',
    endpoint:      'https://realrealgenuine.com/mcp',
    sourceTxHash:  tx_hash,
    ...(token_id ? { tokenId: Number(token_id) } : {}),
    ...(token_id ? { dropUrl: `https://realrealgenuine.com/rrg/drop/${token_id}` } : {}),
  };

  // Return exactly JSON.stringify(doc) — no pretty-printing — so hashes match.
  return new NextResponse(JSON.stringify(doc), {
    status:  200,
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=31536000, immutable', // content-addressed by tx_hash
    },
  });
}
