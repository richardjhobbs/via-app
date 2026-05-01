import { ethers } from 'ethers';

// ── ABI (minimal — only functions we call server-side) ─────────────────
//
// CRITICAL — registerDrop's `creator` argument:
//   For brand-owned drops (is_brand_product = true), MUST be PLATFORM_WALLET.
//   For co-creation / legacy drops, see lib/rrg/splits.ts which returns
//   the correct address as `onChainCreator` per split type. Always derive
//   it from calculateSplit({...}).onChainCreator instead of passing a
//   hand-picked wallet — passing the brand wallet directly causes a
//   67.5% platform loss per sale because RRG.sol mintWithPermit sends 70%
//   atomically to drop.creator AND auto-payout.ts then sends the brand its
//   negotiated 97.5% from platform reserves.
//
//   Post-mortem: memory/feedback_register_drop_creator_must_be_platform.md
export const RRG_ABI = [
  'function registerDrop(uint256 tokenId, address creator, uint256 priceUsdc6dp, uint256 maxSupply) external',
  'function mintWithPermit(uint256 tokenId, address buyer, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
  'function getDrop(uint256 tokenId) external view returns (tuple(address creator, uint256 priceUsdc, uint256 maxSupply, uint256 minted, bool active))',
  'function pauseDrop(uint256 tokenId) external',
  'function unpauseDrop(uint256 tokenId) external',
  'function setTokenURI(uint256 tokenId, string calldata tokenUri) external',
  'function operatorMint(uint256 tokenId, address buyer) external',
  'event Minted(uint256 indexed tokenId, address indexed buyer, uint256 creatorShare, uint256 platformShare)',
  'event OperatorMinted(uint256 indexed tokenId, address indexed buyer)',
  'event DropRegistered(uint256 indexed tokenId, address indexed creator, uint256 priceUsdc, uint256 maxSupply)',
] as const;

// ── ERC-1155 balance check ─────────────────────────────────────────────
export const ERC1155_ABI = [
  'function balanceOf(address account, uint256 id) external view returns (uint256)',
] as const;

// ── Helpers (Base mainnet) ─────────────────────────────────────────────

export function getRpcProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_BASE_RPC_URL!);
}

export function getDeployerSigner(): ethers.Wallet {
  return new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, getRpcProvider());
}

/**
 * Platform wallet signer (0xe653…) — holds all USDC revenue.
 * Used for distribution payouts. Deployer is gas-only (mints + signals).
 */
export function getPlatformSigner(): ethers.Wallet {
  const key = process.env.PLATFORM_PRIVATE_KEY;
  if (!key) throw new Error('PLATFORM_PRIVATE_KEY not set');
  return new ethers.Wallet(key, getRpcProvider());
}

export function getRRGContract(): ethers.Contract {
  return new ethers.Contract(
    process.env.NEXT_PUBLIC_RRG_CONTRACT_ADDRESS!,
    RRG_ABI,
    getDeployerSigner()
  );
}

export function getRRGReadOnly(): ethers.Contract {
  return new ethers.Contract(
    process.env.NEXT_PUBLIC_RRG_CONTRACT_ADDRESS!,
    RRG_ABI,
    getRpcProvider()
  );
}

// ── Convert USDC decimal (number) → 6dp bigint ────────────────────────
export function toUsdc6dp(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

// ── Convert 6dp bigint → human-readable number ────────────────────────
export function fromUsdc6dp(amount: bigint): number {
  return Number(amount) / 1_000_000;
}

// ── USDC contract helpers ─────────────────────────────────────────

const USDC_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
] as const;

export function getUsdcContract(): ethers.Contract {
  const usdcAddress = process.env.NEXT_PUBLIC_USDC_ADDRESS
    || (process.env.NEXT_PUBLIC_CHAIN_ID === '8453'
      ? process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET
      : process.env.NEXT_PUBLIC_USDC_CONTRACT_TESTNET);
  if (!usdcAddress) throw new Error('USDC contract address not set (need NEXT_PUBLIC_USDC_ADDRESS or NEXT_PUBLIC_USDC_CONTRACT_MAINNET)');
  return new ethers.Contract(usdcAddress, USDC_ABI, getPlatformSigner());
}

/**
 * Transfer USDC from the platform wallet (0xe653…) to a recipient.
 * Revenue flows into this wallet on-chain; payouts go out from here.
 * @param to      Recipient address
 * @param amount  Amount in human-readable USDC (e.g. 3.50)
 * @returns       Transaction hash
 */
export async function transferUsdc(
  to: string,
  amount: number,
  nonce?: number,
): Promise<{ hash: string; nonce: number }> {
  if (amount <= 0) throw new Error('transferUsdc: amount must be positive');
  if (!ethers.isAddress(to)) throw new Error(`transferUsdc: invalid address ${to}`);

  const usdc = getUsdcContract();
  const amount6dp = toUsdc6dp(amount);

  // Use explicit nonce to avoid collisions in sequential transfers
  const signer = getPlatformSigner();
  const txNonce = nonce ?? await signer.getNonce('latest');

  const tx = await usdc.transfer(to, amount6dp, { nonce: txNonce });
  const receipt = await tx.wait(1);
  return { hash: receipt.hash, nonce: txNonce };
}

/**
 * Check the platform wallet's USDC balance.
 * @returns Balance in human-readable USDC
 */
export async function getPlatformUsdcBalance(): Promise<number> {
  const usdc = getUsdcContract();
  const signer = getPlatformSigner();
  const balance = await usdc.balanceOf(await signer.getAddress());
  return fromUsdc6dp(balance);
}

// ── Verify a wallet holds at least 1 of a tokenId ─────────────────────
export async function verifyOwnership(
  wallet: string,
  tokenId: number,
): Promise<boolean> {
  const contract = new ethers.Contract(
    process.env.NEXT_PUBLIC_RRG_CONTRACT_ADDRESS!,
    ERC1155_ABI,
    getRpcProvider()
  );
  const balance = await contract.balanceOf(wallet, tokenId);
  return balance > 0n;
}
