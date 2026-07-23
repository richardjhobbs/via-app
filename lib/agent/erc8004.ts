/**
 * ERC-8004 Trustless Agents: Identity & Reputation Registry integration.
 *
 * Identity Registry:  0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 * Reputation Registry: 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
 */

import { ethers } from 'ethers';
import { getBaseProvider, getPlatformSigner } from './contract';
import { deriveAgentWallet } from '@/lib/app/agent-wallet';

// ── Constants ────────────────────────────────────────────────────────

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.getvia.xyz'
).replace(/\/$/, '');

// ── ABIs ─────────────────────────────────────────────────────────────

const IDENTITY_ABI = [
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function setAgentURI(uint256 agentId, string calldata newURI) external',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function register(string calldata agentURI) external returns (uint256)',
] as const;

// Standard ERC-721 Transfer event signature
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const REPUTATION_ABI = [
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string calldata endpoint, string calldata feedbackURI, bytes32 feedbackHash) external',
] as const;

// ── Identity Registry ────────────────────────────────────────────────

function getIdentityContract(signerOrProvider?: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(
    IDENTITY_REGISTRY,
    IDENTITY_ABI,
    signerOrProvider ?? getBaseProvider()
  );
}

function getReputationContract(signerOrProvider?: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(
    REPUTATION_REGISTRY,
    REPUTATION_ABI,
    signerOrProvider ?? getBaseProvider()
  );
}

/** Read the tokenURI for an agent ID. */
export async function getAgentUri(agentId: bigint): Promise<string> {
  const contract = getIdentityContract();
  return contract.tokenURI(agentId) as Promise<string>;
}

/**
 * Check if a wallet has an ERC-8004 identity token. Returns the first
 * currently-owned tokenId, or null if the wallet has no identity.
 *
 * NOTE: The Identity Registry does NOT implement ERC-721 enumeration.
 * tokenOfOwnerByIndex reverts with require(false) on the live chain contract
 * (verified live 2026-05-06). The previous implementation called it directly
 * and threw on every wallet with balance > 0, silently failing the auto-link
 * step in agent creation flows.
 *
 * Fix: scan Transfer events with topics[2]=padded(wallet) in 9999-block
 * chunks (mainnet.base.org caps eth_getLogs at 10k), then verify current
 * ownership via ownerOf. Scans backward from latest with early termination
 * once balanceOf is satisfied. Default depth: 50 chunks (~500k blocks).
 */
export async function getAgentIdForWallet(
  walletAddress: string,
  opts: { maxChunks?: number; concurrency?: number } = {},
): Promise<bigint | null> {
  const contract = getIdentityContract();
  const balance: bigint = await contract.balanceOf(walletAddress);
  if (balance === 0n) return null;

  const provider = getBaseProvider();
  const CHUNK = 9999;
  const MAX_CHUNKS = opts.maxChunks ?? 50;
  const CONCURRENCY = opts.concurrency ?? 5;

  const latest = await provider.getBlockNumber();
  const toTopic = ethers.zeroPadValue(walletAddress.toLowerCase(), 32);
  const baseFilter = {
    address: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    topics: [TRANSFER_TOPIC, null, toTopic] as (string | null)[],
  };

  // Build chunk ranges, scanning backward from latest
  const ranges: Array<{ from: number; to: number }> = [];
  for (let to = latest; to > 0 && ranges.length < MAX_CHUNKS; to -= (CHUNK + 1)) {
    ranges.push({ from: Math.max(0, to - CHUNK), to });
    if (to - CHUNK <= 0) break;
  }

  const candidateIds = new Set<string>();
  const verifiedIds = new Set<bigint>();

  async function verifyCandidates(): Promise<void> {
    const unchecked = Array.from(candidateIds).filter(id => !Array.from(verifiedIds).some(v => v === BigInt(id)));
    if (unchecked.length === 0) return;
    await Promise.all(unchecked.map(async (idStr) => {
      try {
        const owner: string = await contract.ownerOf(BigInt(idStr));
        if (owner.toLowerCase() === walletAddress.toLowerCase()) {
          verifiedIds.add(BigInt(idStr));
        }
      } catch {
        // burned or unreadable
      }
    }));
  }

  // Parallel rounds with early termination
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const round = ranges.slice(i, i + CONCURRENCY);
    await Promise.all(round.map(async ({ from, to }) => {
      try {
        const logs = await provider.getLogs({ ...baseFilter, fromBlock: from, toBlock: to });
        for (const log of logs) {
          if (log.topics[3]) candidateIds.add(BigInt(log.topics[3]).toString());
        }
      } catch {
        // chunk failed; continue
      }
    }));
    if (candidateIds.size >= Number(balance)) {
      await verifyCandidates();
      if (verifiedIds.size >= Number(balance)) break;
    }
  }

  await verifyCandidates();

  if (verifiedIds.size === 0) return null;
  // Return the smallest verified tokenId for deterministic behaviour
  return Array.from(verifiedIds).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
}

// ── VIA protocol MCP client ──────────────────────────────────────────
//
// Identity minting runs through the VIA protocol-level registrar at
// getvia.xyz/mcp. This app is a CALLER of via_register_agent rather than
// directly signing register() on chain.

const VIA_MCP_URL = process.env.VIA_MCP_URL ?? 'https://www.getvia.xyz/mcp';

/**
 * Call a tool on the VIA MCP server (stateless single-shot JSON-RPC).
 * Throws on transport errors, RPC errors, or tool-level isError responses.
 */
async function callViaTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(VIA_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(60_000), // register tx + Supabase insert can run long
  });

  if (!res.ok) {
    throw new Error(`VIA MCP HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const raw = await res.text();
  // Server may emit Server-Sent-Events ("event: message\ndata: {...}\n\n") or plain JSON
  const dataLine = raw.split('\n').find(l => l.startsWith('data: '));
  const json = dataLine ? dataLine.slice(6) : raw;
  const parsed = JSON.parse(json) as { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };

  if (parsed.error) {
    throw new Error(`VIA MCP RPC error: ${parsed.error.message}`);
  }
  const text = parsed.result?.content?.[0]?.text;
  if (!text) {
    throw new Error(`VIA MCP returned no content: ${json.slice(0, 300)}`);
  }
  if (parsed.result?.isError) {
    throw new Error(`VIA MCP tool error: ${text}`);
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`VIA MCP returned non-JSON content: ${text.slice(0, 300)}`);
  }
}

/**
 * Register a new agent identity via the VIA protocol registrar at
 * getvia.xyz/mcp. The VIA Registrar wallet (custodied by VIA Labs) signs
 * the on-chain register() tx; the agent's payment wallet is recorded as
 * agentWallet inside the registration JSON. Returns the new token ID
 * and tx hash for callers.
 */
export async function registerAgentIdentity(
  agentId: string,
  agentName: string,
  walletAddress: string,
  tier: string,
  /**
   * The agent's real MCP path on this app, e.g. "/sellers/<slug>/mcp" or
   * "/buyers/<handle>/mcp". Recorded on-chain as the agent's MCP service
   * endpoint. MUST be a path that actually serves; the old "/api/agent/<id>/mcp"
   * shape (copied from RRG) does not exist on via-app and 404s on 8004scan.
   */
  mcpPath: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  // Auth to the registrar (www.getvia.xyz/mcp), which gates via_register_agent:
  // it matches the secret WE send against its own server-side map
  // VIA_PLATFORM_SECRETS[source_platform]. As a CALLER, this app holds only the
  // single secret it presents — VIA_PLATFORM_SECRET (the same value RRG uses).
  // (Do not set the plural VIA_PLATFORM_SECRETS here; that is the registrar's
  // map and belongs only on the registrar project.)
  // source_platform must be a key in the registrar's map; the registered one is
  // 'rrg' (override via VIA_SOURCE_PLATFORM only if another slug is registered).
  const sourcePlatform = process.env.VIA_SOURCE_PLATFORM || 'rrg';
  const platformSecret = process.env.VIA_PLATFORM_SECRET;
  if (!platformSecret) {
    console.warn(`[erc8004] VIA_PLATFORM_SECRET not set; the registrar will reject the mint for source_platform="${sourcePlatform}".`);
  }

  const result = await callViaTool('via_register_agent', {
    wallet_address: walletAddress,
    name: agentName,
    description: `Shopping agent on VIA (${tier})`,
    services: [
      {
        name: 'MCP',
        endpoint: `${SITE_URL}${mcpPath.startsWith('/') ? mcpPath : `/${mcpPath}`}`,
        description: `VIA ${tier} concierge agent`,
      },
    ],
    source_platform: sourcePlatform,
    platform_secret: platformSecret,
    chain: 'base',
  });

  const viaAgentId = result.via_agent_id;
  const txHash = result.tx_hash;

  if (typeof viaAgentId !== 'number' || typeof txHash !== 'string') {
    throw new Error(`via_register_agent returned unexpected shape: ${JSON.stringify(result).slice(0, 300)}`);
  }

  return {
    tokenId: BigInt(viaAgentId),
    txHash,
  };
}

// Gas seeded onto a fresh identity wallet so it can pay for its own register().
// Base register() costs a small fraction of this; the remainder stays in the
// wallet for future setAgentURI updates. Identity wallets never hold USDC.
const IDENTITY_GAS_ETH = '0.00005';

/**
 * Mint an ERC-8004 identity directly from the agent's OWN platform-derived
 * wallet, so the identity token is owned by that wallet rather than a shared
 * registrar. This is the mint path onboarding uses: register() awards the token
 * to msg.sender, so signing from the derived wallet makes it self-custodied.
 *
 * The derived wallet is re-derivable from AGENT_WALLET_SEED + id (never stored),
 * so the platform can always operate it. The platform signer seeds it a little
 * Base ETH for gas first (skipped if already funded). Returns the new token id
 * plus the wallet that owns it, so the caller can persist agent_wallet_address.
 */
export async function selfMintAgentIdentity(
  id: string,
  name: string,
  description: string,
  tier: string,
  mcpPath: string,
  extra: Record<string, unknown> = {},
): Promise<{ tokenId: bigint; wallet: string; txHash: string }> {
  const identityWallet = deriveAgentWallet(id);
  if (!identityWallet) throw new Error('AGENT_WALLET_SEED not set; cannot derive identity wallet');

  const provider = getBaseProvider();
  const wallet = identityWallet.connect(provider);

  // Seed gas from the platform signer unless the wallet already has enough.
  const fundWei = ethers.parseEther(IDENTITY_GAS_ETH);
  const bal = await provider.getBalance(wallet.address);
  if (bal < fundWei / 2n) {
    const signer = getPlatformSigner();
    const fundTx = await signer.sendTransaction({ to: wallet.address, value: fundWei });
    await fundTx.wait(1);
  }

  const endpoint = `${SITE_URL}${mcpPath.startsWith('/') ? mcpPath : `/${mcpPath}`}`;
  const agentUri = JSON.stringify({
    name,
    description,
    agentWallet: wallet.address.toLowerCase(),
    endpoint,
    protocols: ['mcp', 'erc8004', 'x402'],
    platform: 'VIA',
    tier,
    ...extra,
  });

  const identity = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, wallet);

  // Idempotent: if this wallet already owns a token, link it instead of minting.
  const owned: bigint = await identity.balanceOf(wallet.address);
  if (owned > 0n) {
    const existing = await getAgentIdForWallet(wallet.address);
    if (existing != null) return { tokenId: existing, wallet: wallet.address.toLowerCase(), txHash: '' };
  }

  const tx = await (identity.register as (uri: string) => Promise<ethers.ContractTransactionResponse>)(agentUri);
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error('register() produced no receipt');
  const transfer = receipt.logs.find((l) => l.topics[0] === TRANSFER_TOPIC);
  if (!transfer?.topics[3]) throw new Error('register() emitted no Transfer log; cannot read token id');
  const tokenId = BigInt(transfer.topics[3]);
  return { tokenId, wallet: wallet.address.toLowerCase(), txHash: receipt.hash };
}

/** Post a reputation feedback signal for an agent. */
export async function postReputationSignal(
  agentId: bigint,
  value: number,
  tag1: string,
  tag2: string,
  feedbackUri: string
): Promise<string> {
  const signer = getPlatformSigner();
  const contract = getReputationContract(signer);

  const feedbackHash = ethers.keccak256(ethers.toUtf8Bytes(feedbackUri));

  const tx = await contract.giveFeedback(
    agentId,
    value,
    2, // 2 decimal places
    tag1,
    tag2,
    `${SITE_URL}/api/agent/${agentId}/mcp`,
    feedbackUri,
    feedbackHash
  );

  const receipt = await tx.wait();
  return receipt.hash;
}
