/**
 * lib/app/erc8004.ts
 * ERC-8004 Trustless Agents — Identity & Reputation Registry integration.
 *
 * Both registries are deployed at the same addresses across 30+ chains,
 * including Base mainnet. We use the Base mainnet deployment so the
 * platform wallet (which already holds Base ETH for RRG gas) can sign
 * all ERC-8004 transactions without needing a separate network.
 *
 * Identity Registry:  0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 * Reputation Registry: 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
 * DrHobbs Agent ID:   17666
 */

import { ethers } from 'ethers';
import { unstable_cache } from 'next/cache';
import { db } from './db';

// ── Constants ─────────────────────────────────────────────────────────────

const IDENTITY_REGISTRY_ADDR  = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const REPUTATION_REGISTRY_ADDR = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';

export const DRHOBBS_AGENT_ID   = 17666n;

// RRG platform agent — registered on Base mainnet via scripts/register-rrg-agent.mjs
// Registered 2026-03-18, tx: 0xe36778025d2c0b5ad698402ae8a22c3d778a3d5a20667123edb56ca409da4393
export const RRG_AGENT_ID      = 33313n;

const AGENT_ENDPOINT            = 'https://realrealgenuine.com/mcp';
const AGENT_URI                 = 'https://realrealgenuine.com/agent.json';
const SITE_URL                  = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com').replace(/\/$/, '');

// ── Minimal ABIs ──────────────────────────────────────────────────────────

const IDENTITY_ABI = [
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function setAgentURI(uint256 agentId, string calldata newURI) external',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
] as const;

// ABI confirmed from deployed contract bytecode (EIP-1967 proxy impl 0x16e0fa7f...):
// selector 0x3c036a7e — int128 (not int256), string tags (not bytes32)
const REPUTATION_ABI = [
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string calldata endpoint, string calldata feedbackURI, bytes32 feedbackHash) external',
] as const;

// ── Provider / Signer (Base mainnet) ─────────────────────────────────────

function getBaseMainnetProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org'
  );
}

function getPlatformSigner(): ethers.Wallet {
  return new ethers.Wallet(
    process.env.DEPLOYER_PRIVATE_KEY!,
    getBaseMainnetProvider()
  );
}

// ── Identity Registry ─────────────────────────────────────────────────────

/** Read the current tokenURI for a DrHobbs agent ID. */
export async function getAgentUri(agentId = DRHOBBS_AGENT_ID): Promise<string> {
  const provider = getBaseMainnetProvider();
  const contract = new ethers.Contract(IDENTITY_REGISTRY_ADDR, IDENTITY_ABI, provider);
  return contract.tokenURI(agentId) as Promise<string>;
}

/**
 * Update the on-chain tokenURI for the DrHobbs agent identity token.
 * Must be called by the NFT owner (= platform/agent wallet).
 * Returns the tx hash.
 */
export async function updateAgentUri(
  newUri = AGENT_URI,
  agentId = DRHOBBS_AGENT_ID,
): Promise<string> {
  const signer   = getPlatformSigner();
  const contract = new ethers.Contract(IDENTITY_REGISTRY_ADDR, IDENTITY_ABI, signer);
  const tx       = await (contract.setAgentURI as (id: bigint, uri: string) => Promise<ethers.ContractTransactionResponse>)(agentId, newUri);
  const receipt  = await tx.wait(1);
  return receipt!.hash;
}

// ── Identity lookup ───────────────────────────────────────────────────────

// ── In-memory cache: wallet → agentId (populated lazily) ────────────────
const _walletToAgent = new Map<string, bigint>();
let _cachePopulated = false;

// DB-sourced candidate index: wallet (lowercased) → agentId. The Identity
// Registry has no reverse lookup (no ERC-721Enumerable, so tokenOfOwnerByIndex
// is unavailable), so app_buyers and app_sellers ARE the index of which wallet
// holds which agent id. Every candidate is still confirmed on-chain with
// ownerOf before it is trusted, so a stale or wrong DB row can never mint a
// bogus mapping. Cached in-memory for 10 minutes; an empty result (DB error or
// no rows) is never cached so a transient outage can't stick.
let _dbCandidates: Map<string, bigint> | null = null;

/** Parse a stored erc8004_agent_id text column into a positive bigint, or null. */
function parseStoredAgentId(raw: unknown): bigint | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = BigInt(trimmed);
  return id > 0n ? id : null;
}

/**
 * Build the wallet→agentId candidate map from the DB. Pulls every app_buyers /
 * app_sellers row that has an erc8004_agent_id, keyed by BOTH the agent wallet
 * (which signs and owns the identity token) and the funding/payout wallet, so
 * any onboarded VIA agent is resolvable by wallet without a code edit.
 */
async function getDbAgentCandidates(): Promise<Map<string, bigint>> {
  if (_dbCandidates) return _dbCandidates;

  const map = new Map<string, bigint>();
  for (const table of ['app_buyers', 'app_sellers'] as const) {
    const { data, error } = await db
      .from(table)
      .select('wallet_address, agent_wallet_address, erc8004_agent_id')
      .not('erc8004_agent_id', 'is', null);
    if (error) {
      console.error(`[erc8004] candidate load from ${table} failed:`, error.message);
      continue;
    }
    for (const row of data ?? []) {
      const id = parseStoredAgentId(row.erc8004_agent_id);
      if (id === null) continue;
      for (const w of [row.agent_wallet_address, row.wallet_address]) {
        if (typeof w === 'string' && w) map.set(w.toLowerCase(), id);
      }
    }
  }

  if (map.size > 0) {
    _dbCandidates = map;
    setTimeout(() => { _dbCandidates = null; }, 10 * 60 * 1000);
  }
  return map;
}

/**
 * Populate the wallet→agentId cache by confirming every DB-listed agent id
 * on-chain with ownerOf. Maps by the CURRENT on-chain owner (the source of
 * truth) so a transferred identity token still resolves to the right wallet.
 * Runs once per process lifetime (or until cache expires).
 */
async function populateAgentCache(): Promise<void> {
  if (_cachePopulated) return;
  try {
    const candidates = await getDbAgentCandidates();
    if (candidates.size === 0) return; // nothing to warm; don't mark warm

    const provider = getBaseMainnetProvider();
    const abi = ['function ownerOf(uint256) view returns (address)'];
    const contract = new ethers.Contract(IDENTITY_REGISTRY_ADDR, abi, provider);

    const ids = [...new Set([...candidates.values()].map((id) => id.toString()))].map(BigInt);
    let failures = 0;
    const checks = ids.map(async (id) => {
      try {
        const owner: string = await (contract.ownerOf as (id: bigint) => Promise<string>)(id);
        _walletToAgent.set(owner.toLowerCase(), id);
      } catch { failures++; }
    });

    await Promise.all(checks);

    // Only treat the cache as warm when every id resolved. A partial warm from
    // an RPC hiccup on a serverless cold start must not stick, or wallet
    // lookups return the -1n "unknown id" sentinel for the full 10 minutes and
    // miss a real registration (this skipped a buyer signal once).
    if (failures === 0) {
      _cachePopulated = true;
      setTimeout(() => { _cachePopulated = false; }, 10 * 60 * 1000);
    }
  } catch {
    // non-fatal - lookup falls back to a direct DB-confirmed scan
  }
}

/**
 * Look up the ERC-8004 agentId registered to a given wallet address.
 * Tries the in-memory cache, then the DB candidate index confirmed with a
 * single ownerOf call (so one call still resolves even if the bulk warm
 * partially failed), then a balanceOf sentinel. Returns:
 *   - a positive id → wallet owns that confirmed agent identity
 *   - -1n           → wallet holds an identity token but it is not indexed in
 *                     app_buyers / app_sellers (an erc8004_agent_id backfill gap)
 *   - null          → wallet holds no identity token / unresolvable
 */
export async function lookupAgentIdByWallet(wallet: string): Promise<bigint | null> {
  const lowerWallet = wallet.toLowerCase();
  try {
    await populateAgentCache();

    // Fast path: cache hit (covers known agents on a healthy warm).
    const cached = _walletToAgent.get(lowerWallet);
    if (cached !== undefined) return cached;

    const provider = getBaseMainnetProvider();
    const ownerAbi = ['function ownerOf(uint256) view returns (address)'];
    const idContract = new ethers.Contract(IDENTITY_REGISTRY_ADDR, ownerAbi, provider);

    // Cache miss or partial warm: resolve this one wallet from the DB index and
    // confirm on-chain, so a single call still succeeds even if the bulk warm
    // partially failed.
    const candidateId = (await getDbAgentCandidates()).get(lowerWallet);
    if (candidateId !== undefined) {
      try {
        const owner: string = await (idContract.ownerOf as (id: bigint) => Promise<string>)(candidateId);
        if (owner.toLowerCase() === lowerWallet) {
          _walletToAgent.set(lowerWallet, candidateId);
          return candidateId;
        }
      } catch { /* token doesn't exist or reverted - fall through */ }
    }

    // Not in the DB index. If the wallet still holds an identity token, signal
    // "registered, unknown id" so callers can surface the backfill gap;
    // otherwise unregistered.
    const balAbi = ['function balanceOf(address) view returns (uint256)'];
    const balContract = new ethers.Contract(IDENTITY_REGISTRY_ADDR, balAbi, provider);
    const balance = await (balContract.balanceOf as (a: string) => Promise<bigint>)(wallet);
    if (balance > 0n) return -1n; // indicates "has token, unknown ID"

    return null;
  } catch {
    return null;
  }
}

/**
 * Batch lookup ERC-8004 agent IDs for multiple wallets.
 * Returns a Map of lowercased wallet → agentId.
 * Runs lookups in parallel with a 3-second timeout per wallet.
 */
export async function getAgentIdsForWallets(wallets: string[]): Promise<Map<string, number>> {
  if (wallets.length === 0) return new Map();
  const cacheKey = wallets.slice().sort().join('|');
  const fetch = unstable_cache(
    async () => {
      const result = new Map<string, number>();
      const unique = [...new Set(wallets.map(w => w.toLowerCase()))];
      const lookups = unique.map(async (wallet) => {
        try {
          const id = await Promise.race([
            lookupAgentIdByWallet(wallet),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          if (id !== null) result.set(wallet, Number(id));
        } catch {
          // skip failed lookups
        }
      });
      await Promise.all(lookups);
      return Array.from(result.entries());
    },
    [`agent-ids-${cacheKey}`],
    { revalidate: 3600 }, // 1-hour cache — agent IDs are immutable on-chain
  );
  const entries = await fetch();
  return new Map(entries);
}

// ── Reputation Registry ───────────────────────────────────────────────────

export interface ReputationSignalParams {
  buyerAgentId: bigint;  // The buyer's ERC-8004 agent ID — who the signal is ABOUT
  buyerWallet:  string;  // logged in feedbackURI for traceability
  priceUsdc:    string;  // e.g. "1.00"
  tokenId:      number;  // RRG drop token ID → feedbackURI links to drop page
  txHash:       string;  // purchase tx hash → becomes feedbackHash
  nonce?:       number;  // explicit deployer nonce — pass mintTx.nonce+1 to avoid RPC lag collisions
}

/**
 * Post a verified-purchase reputation signal to the ERC-8004 Reputation Registry.
 * The RRG PLATFORM (agent #33313) attests that the BUYER made a verified purchase.
 * Signal: giveFeedback(buyerAgentId, ...) — about the BUYER, signed by DEPLOYER.
 *
 * IMPORTANT: The DEPLOYER wallet owns agent #33313. The contract blocks self-feedback
 * (giveFeedback where caller = owner of agentId). So this MUST use the BUYER's agentId,
 * not the platform's own agentId. The buyer's agentId is resolved before calling this.
 *
 * Returns the tx hash of the reputation signal.
 */
export async function postReputationSignal(p: ReputationSignalParams): Promise<string> {
  const agentId = p.buyerAgentId;
  const signer  = getPlatformSigner();
  const contract = new ethers.Contract(REPUTATION_REGISTRY_ADDR, REPUTATION_ABI, signer);

  // Maximum rating (value=100, scale 0-100)
  const value         = 100n;
  const valueDecimals = 0;

  // Tag the signal as an RRG purchase (plain strings — not bytes32)
  const tag1 = 'purchase';
  const tag2 = 'rrg';

  // Link to the drop page (provides human-readable evidence)
  const feedbackURI = `${SITE_URL}/rrg/drop/${p.tokenId}`;

  // Hash of the purchase tx hash → ties this reputation signal to the on-chain sale
  const feedbackHash = p.txHash.startsWith('0x') && p.txHash.length === 66
    ? ethers.keccak256(ethers.toUtf8Bytes(p.txHash))
    : ethers.ZeroHash;

  const overrides = p.nonce !== undefined ? { nonce: p.nonce } : {};
  const tx = await (contract.giveFeedback as (
    agentId:      bigint,
    value:        bigint,
    valueDecimals: number,
    tag1:          string,
    tag2:          string,
    endpoint:      string,
    feedbackURI:   string,
    feedbackHash:  string,
    overrides?:    object,
  ) => Promise<ethers.ContractTransactionResponse>)(
    agentId,
    value,
    valueDecimals,
    tag1,
    tag2,
    AGENT_ENDPOINT,
    feedbackURI,
    feedbackHash,
    overrides,
  );

  const receipt = await tx.wait(1);
  return receipt!.hash;
}

// ── Voucher Reputation Signals ───────────────────────────────────────────

export interface VoucherSignalParams {
  agentId?:    bigint;
  buyerWallet: string;
  voucherCode: string;
  sellerId:     string;
  tokenId:     number;
  signalType:  'voucher_issued' | 'voucher_redeemed';
}

/**
 * Post a voucher-related reputation signal to the ERC-8004 Reputation Registry.
 * Uses tag1='voucher' and tag2='issued' or 'redeemed'.
 *
 * Called after voucher creation or redemption to build on-chain trust history.
 * Returns the tx hash.
 */
export async function postVoucherSignal(p: VoucherSignalParams): Promise<string> {
  const agentId = p.agentId ?? (RRG_AGENT_ID > 0n ? RRG_AGENT_ID : DRHOBBS_AGENT_ID);
  const signer  = getPlatformSigner();
  const contract = new ethers.Contract(REPUTATION_REGISTRY_ADDR, REPUTATION_ABI, signer);

  // Maximum rating (value=100, scale 0-100)
  const value         = 100n;
  const valueDecimals = 0;

  const tag1 = 'voucher';
  const tag2 = p.signalType === 'voucher_redeemed' ? 'redeemed' : 'issued';

  const feedbackURI = `${SITE_URL}/rrg/drop/${p.tokenId}`;

  // Hash the voucher code as the feedback hash
  const feedbackHash = ethers.keccak256(ethers.toUtf8Bytes(p.voucherCode));

  const tx = await (contract.giveFeedback as (
    agentId:      bigint,
    value:        bigint,
    valueDecimals: number,
    tag1:          string,
    tag2:          string,
    endpoint:      string,
    feedbackURI:   string,
    feedbackHash:  string,
  ) => Promise<ethers.ContractTransactionResponse>)(
    agentId,
    value,
    valueDecimals,
    tag1,
    tag2,
    AGENT_ENDPOINT,
    feedbackURI,
    feedbackHash,
  );

  const receipt = await tx.wait(1);
  return receipt!.hash;
}

// ── Buyer Reputation Signal ───────────────────────────────────────────────

export interface BuyerReputationSignalParams {
  buyerAgentId: bigint;    // e.g. DRHOBBS_AGENT_ID (17666)
  buyerEndpoint?: string;  // buyer's MCP endpoint (defaults to their on-chain registration)
  buyerWallet: string;
  priceUsdc:   string;
  tokenId:     number;
  txHash:      string;
  nonce?:      number;     // explicit deployer nonce — chain from previous signal's nonce+1
}

/**
 * Post a reputation signal for the BUYER agent.
 * Called when a known agent makes a purchase — signals their trustworthiness as a buyer.
 * Complements postReputationSignal (which signals the seller/platform).
 *
 * giveFeedback(agentId=buyerAgentId, tag1='purchase', tag2='buyer') means:
 * "Platform (deployer) attests buyerAgentId completed a verified on-chain purchase."
 */
export async function postBuyerReputationSignal(p: BuyerReputationSignalParams): Promise<string> {
  const signer   = getPlatformSigner();
  const contract = new ethers.Contract(REPUTATION_REGISTRY_ADDR, REPUTATION_ABI, signer);

  const value         = 100n;
  const valueDecimals = 0;
  const tag1          = 'purchase';
  const tag2          = 'buyer';

  const feedbackURI  = `${SITE_URL}/rrg/drop/${p.tokenId}?buyer=${p.buyerWallet.toLowerCase()}`;
  const feedbackHash = p.txHash.startsWith('0x') && p.txHash.length === 66
    ? ethers.keccak256(ethers.toUtf8Bytes(p.txHash))
    : ethers.ZeroHash;

  // Use the buyer's endpoint if provided, otherwise RRG's (platform is the attester)
  const endpoint = p.buyerEndpoint ?? AGENT_ENDPOINT;

  const overrides = p.nonce !== undefined ? { nonce: p.nonce } : {};
  const tx = await (contract.giveFeedback as (
    agentId:      bigint,
    value:        bigint,
    valueDecimals: number,
    tag1:          string,
    tag2:          string,
    endpoint:      string,
    feedbackURI:   string,
    feedbackHash:  string,
    overrides?:    object,
  ) => Promise<ethers.ContractTransactionResponse>)(
    p.buyerAgentId,
    value,
    valueDecimals,
    tag1,
    tag2,
    endpoint,
    feedbackURI,
    feedbackHash,
    overrides,
  );

  const receipt = await tx.wait(1);
  return receipt!.hash;
}

// ── Public fire-and-forget wrappers ──────────────────────────────────────

/**
 * Non-blocking wrapper — call after a confirmed purchase.
 * Looks up buyerAgentId from the Identity Registry, then posts both
 * the platform→buyer reputation signal and the buyer signal.
 * Skips gracefully if buyer has no ERC-8004 registration.
 */
export function fireReputationSignal(
  params: Omit<ReputationSignalParams, 'buyerAgentId'>,
): void {
  lookupAgentIdByWallet(params.buyerWallet).then(async (buyerAgentId) => {
    if (!buyerAgentId) {
      console.log('[erc8004] buyer has no ERC-8004 registration — skipping reputation signal');
      return;
    }
    const hash = await postReputationSignal({ ...params, buyerAgentId });
    console.log('[erc8004] reputation signal posted:', hash);
  }).catch((err) => {
    console.error('[erc8004] reputation signal failed:', err);
  });
}

// ── Brand Sale Reputation Signal ─────────────────────────────────────────

export interface BrandSaleSignalParams {
  sellerWallet: string;   // wallet address of the brand agent
  priceUsdc:   string;
  tokenId:     number;
  txHash:      string;
  nonce?:      number;   // explicit deployer nonce — chain from previous signal's nonce+1
}

/**
 * Post a verified-sale reputation signal for the BRAND AGENT.
 * The RRG platform attests that the brand completed a verified on-chain sale.
 * Tag: sale/brand — distinct from the buyer-side purchase/rrg signal.
 *
 * Looks up the brand's ERC-8004 agentId from their wallet.
 * Skips gracefully if the brand wallet has no ERC-8004 registration.
 * Returns the tx hash, or null if skipped/failed.
 */
export async function postBrandSaleSignal(p: BrandSaleSignalParams): Promise<string | null> {
  const brandAgentId = await lookupAgentIdByWallet(p.sellerWallet.toLowerCase());
  if (!brandAgentId || brandAgentId < 0n) {
    console.log('[erc8004] brand wallet has no ERC-8004 registration — skipping brand sale signal');
    return null;
  }

  const signer   = getPlatformSigner();
  const contract = new ethers.Contract(REPUTATION_REGISTRY_ADDR, REPUTATION_ABI, signer);

  const value         = 100n;
  const valueDecimals = 0;
  const tag1          = 'sale';
  const tag2          = 'brand';

  const feedbackURI  = `${SITE_URL}/rrg/drop/${p.tokenId}`;
  const feedbackHash = p.txHash.startsWith('0x') && p.txHash.length === 66
    ? ethers.keccak256(ethers.toUtf8Bytes(p.txHash))
    : ethers.ZeroHash;

  const overrides = p.nonce !== undefined ? { nonce: p.nonce } : {};
  const tx = await (contract.giveFeedback as (
    agentId:      bigint,
    value:        bigint,
    valueDecimals: number,
    tag1:          string,
    tag2:          string,
    endpoint:      string,
    feedbackURI:   string,
    feedbackHash:  string,
    overrides?:    object,
  ) => Promise<ethers.ContractTransactionResponse>)(
    brandAgentId,
    value,
    valueDecimals,
    tag1,
    tag2,
    AGENT_ENDPOINT,
    feedbackURI,
    feedbackHash,
    overrides,
  );

  const receipt = await tx.wait(1);
  return receipt!.hash;
}

/**
 * Non-blocking wrapper — call after voucher issuance or redemption.
 * Posts a voucher signal to the ERC-8004 Reputation Registry.
 */
export async function fireVoucherSignal(
  params: Omit<VoucherSignalParams, 'agentId'>,
): Promise<string | null> {
  try {
    const hash = await postVoucherSignal(params);
    console.log(`[erc8004] voucher ${params.signalType} signal posted:`, hash);
    return hash;
  } catch (err) {
    console.error(`[erc8004] voucher ${params.signalType} signal failed:`, err);
    return null;
  }
}
