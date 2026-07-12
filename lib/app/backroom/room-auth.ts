/**
 * Per-room member auth: the same stateless wallet-signature challenge the
 * stores use (lib/app/store-auth.ts), scoped to a room and a member.
 *
 * A member holds their own in-app wallet (app_buyers.wallet_address is the
 * buyer's identity + spend wallet). To act in a room, the member's agent or
 * the member's own UI signs a server-issued challenge with that wallet. On
 * success we mint a short-lived session token (an HMAC over room + member +
 * expiry) that the write tools carry. No nonce store, serverless-friendly.
 *
 * One protocol, two faces: the human UI and the member's agent authenticate
 * the same way and call the same tools. There is no UI-only backdoor write.
 */
import crypto from 'crypto';
import { ethers } from 'ethers';

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 30 * 60_000;

function secret(): string | null {
  return process.env.STORE_AUTH_SECRET || process.env.ADMIN_SECRET || null;
}
function mac(payload: string, key: string): string {
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}
function b64urlEncode(s: string): string { return Buffer.from(s, 'utf8').toString('base64url'); }
function b64urlDecode(s: string): string { return Buffer.from(s, 'base64url').toString('utf8'); }

function buildMessage(roomId: string, walletLc: string, exp: number, challenge: string): string {
  return [
    'VIA Back Room authorization',
    `Room: ${roomId}`,
    `Wallet: ${walletLc}`,
    `Expires: ${new Date(exp).toISOString()}`,
    `Challenge: ${challenge}`,
    '',
    'Sign this with your member wallet to act in the room.',
  ].join('\n');
}

export interface RoomChallenge {
  message:    string;
  challenge:  string;
  expires_at: string;
}

export function issueRoomChallenge(roomId: string, wallet: string): RoomChallenge | null {
  const key = secret();
  if (!key) return null;
  const walletLc = wallet.trim().toLowerCase();
  const exp = Date.now() + CHALLENGE_TTL_MS;
  const payload = `room|${roomId}|${walletLc}|${exp}`;
  const challenge = `${b64urlEncode(payload)}.${mac(payload, key)}`;
  return { message: buildMessage(roomId, walletLc, exp, challenge), challenge, expires_at: new Date(exp).toISOString() };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'malformed' | 'bad_mac' | 'expired' | 'wallet_mismatch' | 'bad_signature' };

export function verifyRoomChallenge(roomId: string, wallet: string, challenge: string, signature: string): VerifyResult {
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
  if (parts.length !== 4 || parts[0] !== 'room') return { ok: false, reason: 'malformed' };
  const [, roomP, walletP, expStr] = parts;
  const exp = Number(expStr);
  const walletLc = wallet.trim().toLowerCase();
  if (roomP !== roomId || walletP !== walletLc) return { ok: false, reason: 'wallet_mismatch' };
  if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false, reason: 'expired' };

  const message = buildMessage(roomId, walletLc, exp, challenge);
  let recovered: string;
  try { recovered = ethers.verifyMessage(message, signature); } catch { return { ok: false, reason: 'bad_signature' }; }
  if (recovered.toLowerCase() !== walletLc) return { ok: false, reason: 'bad_signature' };

  return { ok: true };
}

// ── Session token: the ticket the write tools carry after authenticate ──────

export interface RoomSession {
  room_id:         string;
  member_platform: string;
  member_type:     string;
  member_ref:      string;
}

export function issueSessionToken(roomId: string, memberPlatform: string, memberType: string, memberRef: string): string | null {
  const key = secret();
  if (!key) return null;
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `sess|${roomId}|${memberPlatform}|${memberType}|${memberRef}|${exp}`;
  return `${b64urlEncode(payload)}.${mac(payload, key)}`;
}

export function verifySessionToken(roomId: string, token: string): RoomSession | null {
  const key = secret();
  if (!key) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const providedMac = token.slice(dot + 1);

  let payload: string;
  try { payload = b64urlDecode(payloadB64); } catch { return null; }

  const expectedMac = mac(payload, key);
  const a = Buffer.from(providedMac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const parts = payload.split('|');
  if (parts.length !== 6 || parts[0] !== 'sess') return null;
  const [, roomP, memberPlatform, memberType, memberRef, expStr] = parts;
  const exp = Number(expStr);
  if (roomP !== roomId) return null;
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return { room_id: roomId, member_platform: memberPlatform, member_type: memberType, member_ref: memberRef };
}
