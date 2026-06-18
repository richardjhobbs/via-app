/**
 * Encrypt/decrypt a buyer's bring-your-own LLM API key at rest.
 * Mirrors RRG's lib/agent/byo-key-crypt.ts: AES-256-GCM with a 32-byte master
 * key from BYO_KEY_ENCRYPTION_KEY (base64). On-disk format is versioned so the
 * scheme can rotate: `v1:<iv_b64>:<tag_b64>:<cipher_b64>`.
 *
 * Generate a master key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

function masterKey(): Buffer {
  const raw = process.env.BYO_KEY_ENCRYPTION_KEY;
  if (!raw) throw new Error('BYO_KEY_ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('BYO_KEY_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }
  return key;
}

export function encryptByoKey(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptByoKey(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('unrecognised BYO key blob format');
  }
  const [, ivB64, tagB64, cipherB64] = parts;
  const decipher = crypto.createDecipheriv(ALGO, masterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(cipherB64, 'base64')), decipher.final()]).toString('utf8');
}

export function lastFour(plain: string): string {
  return plain.length <= 4 ? plain : plain.slice(-4);
}
