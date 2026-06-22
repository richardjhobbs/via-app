/**
 * Agent-native store management auth: wallet-signature challenge/response.
 *
 * An agent that owns a store already holds the store's identity wallet
 * (app_sellers.agent_wallet_address, the ERC-8004 holder). Instead of a human
 * email + password, the owning agent authenticates by signing a server-issued
 * challenge with that wallet. Everything happens over MCP tool calls, by URL,
 * with no custom headers and no secret to leak.
 *
 * The challenge is STATELESS: it is an HMAC-bound payload (slug | wallet | exp),
 * so no nonce store is needed on the serverless runtime. verifyChallenge
 * recomputes the MAC, checks expiry, reconstructs the exact signed message, and
 * recovers the signer with ethers.verifyMessage.
 */

import crypto from 'crypto';
import { ethers } from 'ethers';

const CHALLENGE_TTL_MS = 5 * 60_000; // 5 minutes to sign + return

function secret(): string | null {
  return process.env.STORE_AUTH_SECRET || process.env.ADMIN_SECRET || null;
}

function mac(payload: string, key: string): string {
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}
function b64urlDecode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

/** The exact human/agent-readable message bound to a challenge. */
function buildMessage(slug: string, walletLc: string, exp: number, challenge: string): string {
  return [
    'VIA store management authorization',
    `Store: ${slug}`,
    `Wallet: ${walletLc}`,
    `Expires: ${new Date(exp).toISOString()}`,
    `Challenge: ${challenge}`,
    '',
    "Sign this message with the store's agent wallet to prove control.",
  ].join('\n');
}

export interface StoreChallenge {
  message:    string; // the agent signs THIS exact string
  challenge:  string; // opaque token echoed back to authenticate
  expires_at: string;
}

/** Issue a challenge for (slug, wallet). Returns null if no server secret is configured. */
export function issueChallenge(slug: string, wallet: string): StoreChallenge | null {
  const key = secret();
  if (!key) return null;
  const slugLc   = slug.trim().toLowerCase();
  const walletLc = wallet.trim().toLowerCase();
  const exp      = Date.now() + CHALLENGE_TTL_MS;
  const payload  = `${slugLc}|${walletLc}|${exp}`;
  const challenge = `${b64urlEncode(payload)}.${mac(payload, key)}`;
  return { message: buildMessage(slug, walletLc, exp, challenge), challenge, expires_at: new Date(exp).toISOString() };
}

export type VerifyChallengeResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'malformed' | 'bad_mac' | 'expired' | 'wallet_mismatch' | 'bad_signature' };

// ── Digital-download authorization ──────────────────────────────────────
// Same stateless HMAC challenge, scoped to (seller, buyer wallet, product), so
// the buyer's agent proves CONTROL of the wallet that paid before download
// links are issued , not merely that it can name a (public) payer address.

/** The exact message a buyer's agent signs to claim a download. */
function buildDownloadMessage(slug: string, walletLc: string, productId: string, exp: number, challenge: string): string {
  return [
    'VIA digital delivery authorization',
    `Store: ${slug}`,
    `Product: ${productId}`,
    `Wallet: ${walletLc}`,
    `Expires: ${new Date(exp).toISOString()}`,
    `Challenge: ${challenge}`,
    '',
    'Sign this with the wallet that paid for this product to receive the download links.',
  ].join('\n');
}

/** Issue a download challenge for (slug, wallet, productId). Null if no secret. */
export function issueDownloadChallenge(slug: string, wallet: string, productId: string): StoreChallenge | null {
  const key = secret();
  if (!key) return null;
  const slugLc   = slug.trim().toLowerCase();
  const walletLc = wallet.trim().toLowerCase();
  const pid      = productId.trim().toLowerCase();
  const exp      = Date.now() + CHALLENGE_TTL_MS;
  const payload  = `dl|${slugLc}|${walletLc}|${pid}|${exp}`;
  const challenge = `${b64urlEncode(payload)}.${mac(payload, key)}`;
  return { message: buildDownloadMessage(slug, walletLc, pid, exp, challenge), challenge, expires_at: new Date(exp).toISOString() };
}

/**
 * Verify a signed download challenge: server-issued (MAC), unexpired, bound to
 * this slug + wallet + product, and the signature recovers `wallet`.
 */
export function verifyDownloadChallenge(slug: string, wallet: string, productId: string, challenge: string, signature: string): VerifyChallengeResult {
  const key = secret();
  if (!key) return { ok: false, reason: 'not_configured' };

  const dot = challenge.lastIndexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed' };
  const payloadB64  = challenge.slice(0, dot);
  const providedMac = challenge.slice(dot + 1);

  let payload: string;
  try { payload = b64urlDecode(payloadB64); } catch { return { ok: false, reason: 'malformed' }; }

  const expectedMac = mac(payload, key);
  const a = Buffer.from(providedMac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_mac' };

  const parts = payload.split('|');
  if (parts.length !== 5 || parts[0] !== 'dl') return { ok: false, reason: 'malformed' };
  const [, slugP, walletP, pidP, expStr] = parts;
  const exp = Number(expStr);
  const slugLc   = slug.trim().toLowerCase();
  const walletLc = wallet.trim().toLowerCase();
  const pid      = productId.trim().toLowerCase();
  if (slugP !== slugLc || walletP !== walletLc || pidP !== pid) return { ok: false, reason: 'wallet_mismatch' };
  if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false, reason: 'expired' };

  const message = buildDownloadMessage(slug, walletLc, pid, exp, challenge);
  let recovered: string;
  try { recovered = ethers.verifyMessage(message, signature); } catch { return { ok: false, reason: 'bad_signature' }; }
  if (recovered.toLowerCase() !== walletLc) return { ok: false, reason: 'bad_signature' };

  return { ok: true };
}

/**
 * Verify a signed challenge. Confirms the challenge is server-issued (MAC),
 * unexpired, bound to this slug + wallet, and that `signature` over the
 * reconstructed message recovers `wallet`.
 */
export function verifyChallenge(slug: string, wallet: string, challenge: string, signature: string): VerifyChallengeResult {
  const key = secret();
  if (!key) return { ok: false, reason: 'not_configured' };

  const dot = challenge.lastIndexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed' };
  const payloadB64 = challenge.slice(0, dot);
  const providedMac = challenge.slice(dot + 1);

  let payload: string;
  try { payload = b64urlDecode(payloadB64); } catch { return { ok: false, reason: 'malformed' }; }

  const expectedMac = mac(payload, key);
  const a = Buffer.from(providedMac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_mac' };

  const parts = payload.split('|');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [slugP, walletP, expStr] = parts;
  const exp = Number(expStr);
  const slugLc   = slug.trim().toLowerCase();
  const walletLc = wallet.trim().toLowerCase();
  if (slugP !== slugLc || walletP !== walletLc) return { ok: false, reason: 'wallet_mismatch' };
  if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false, reason: 'expired' };

  const message = buildMessage(slug, walletLc, exp, challenge);
  let recovered: string;
  try { recovered = ethers.verifyMessage(message, signature); } catch { return { ok: false, reason: 'bad_signature' }; }
  if (recovered.toLowerCase() !== walletLc) return { ok: false, reason: 'bad_signature' };

  return { ok: true };
}
