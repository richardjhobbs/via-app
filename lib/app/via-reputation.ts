/**
 * VIA agent-to-agent reputation signals on the ERC-8004 Reputation Registry.
 *
 * Every settled VIA purchase improves BOTH agents' on-chain trust scores:
 * the VIA platform attests one positive signal about the buyer's Buying
 * Agent and one about the seller's Sales Agent. The Reputation Registry
 * blocks self-feedback, so the platform (which owns neither counterparty
 * agent) is the correct attester for both sides.
 *
 * Signed by the deployer/gas wallet so signal nonces chain off the
 * operatorMint nonce in the same sequence, avoiding RPC-lag collisions
 * when several deployer transactions fire back to back.
 *
 * Reputation Registry: 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63 (Base mainnet)
 */

import { ethers } from 'ethers';
import { getRpcProvider } from '@/lib/app/contract';

const REPUTATION_REGISTRY_ADDR = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';

const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_BASE_URL ?? 'https://app.getvia.xyz'
).replace(/\/$/, '');

const AGENT_ENDPOINT = `${SITE_URL}/mcp`;

// selector 0x3c036a7e, int128 value, string tags (confirmed against the
// deployed registry; same ABI the identity-mint client targets)
const REPUTATION_ABI = [
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string calldata endpoint, string calldata feedbackURI, bytes32 feedbackHash) external',
] as const;

function getSignalSigner(): ethers.Wallet {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error('DEPLOYER_PRIVATE_KEY not set');
  return new ethers.Wallet(key, getRpcProvider());
}

function hashTx(txHash: string): string {
  return txHash.startsWith('0x') && txHash.length === 66
    ? ethers.keccak256(ethers.toUtf8Bytes(txHash))
    : ethers.ZeroHash;
}

/**
 * Parse a stored ERC-8004 agent ID (text column or tool argument) into a
 * positive bigint. Returns null for empty / non-numeric values so callers
 * can skip that side's signal gracefully.
 */
export function parseAgentId(raw: string | null | undefined): bigint | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = BigInt(trimmed);
  return id > 0n ? id : null;
}

export interface ViaSignalParams {
  /** ERC-8004 agent ID the signal is ABOUT (buyer agent or seller agent). */
  agentId:  bigint;
  /** Order ref the signal is evidence for, used in the feedbackURI. */
  orderRef: string;
  /** Settlement tx hash, hashed into feedbackHash to tie signal to the sale. */
  txHash:   string;
  /** tag2 on the signal: which side of the trade this agent played. */
  role:     'buyer' | 'seller';
  /** Explicit deployer nonce. Chain from the operatorMint nonce + 1. */
  nonce?:   number;
}

/**
 * Post one positive verified-trade reputation signal (value=100) about a
 * single agent. The platform wallet is msg.sender; the agentId is the
 * counterparty being attested. Returns the signal tx hash.
 */
export async function postViaReputationSignal(p: ViaSignalParams): Promise<string> {
  const signer   = getSignalSigner();
  const contract = new ethers.Contract(REPUTATION_REGISTRY_ADDR, REPUTATION_ABI, signer);

  const feedbackURI  = `${SITE_URL}/orders/${p.orderRef}`;
  const feedbackHash = hashTx(p.txHash);
  const overrides    = p.nonce !== undefined ? { nonce: p.nonce } : {};

  const tx = await (contract.giveFeedback as (
    agentId:       bigint,
    value:         bigint,
    valueDecimals: number,
    tag1:          string,
    tag2:          string,
    endpoint:      string,
    feedbackURI:   string,
    feedbackHash:  string,
    overrides?:    object,
  ) => Promise<ethers.ContractTransactionResponse>)(
    p.agentId,
    100n,         // maximum positive rating
    0,            // valueDecimals (0-100 scale)
    'purchase',   // tag1
    p.role,       // tag2: 'buyer' | 'seller'
    AGENT_ENDPOINT,
    feedbackURI,
    feedbackHash,
    overrides,
  );

  const receipt = await tx.wait(1);
  return receipt!.hash;
}
