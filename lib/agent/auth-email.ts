/**
 * Magic-link email auth for agent owners.
 *
 * Why this exists: the previous /api/agent/session?email= and ?wallet=
 * paths minted a session cookie from an unauthenticated lookup, so anyone
 * who knew the email or wallet address could impersonate any agent owner.
 * This module replaces that with a verified-by-email handshake:
 *
 *   1. POST /api/agent/auth/email/request { email }
 *      Server looks up the agent, generates a 32-byte random token, stores
 *      the SHA-256 hash with a 15-minute expiry, and emails the raw token
 *      as a one-shot sign-in link. The endpoint returns 200 regardless of
 *      whether the email exists, so an attacker cannot enumerate accounts.
 *
 *   2. GET /agents/auth/email/verify?token=<raw>
 *      Server hashes the raw token, looks it up, validates expiry + unused,
 *      atomically marks it used, mints the session cookie, redirects to
 *      the dashboard. Single-use, time-bound, server-side state.
 *
 * Tokens are random 32-byte strings; the hash (not the raw token) is what
 * lives in the DB, so a DB compromise does not yield a usable token. Used
 * tokens are kept in the table for audit but cannot be replayed.
 */

import crypto from 'crypto';
import { db } from '@/lib/rrg/db';

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 15 * 60 * 1000;
// Rate limit: at most N outstanding (unused, unexpired) tokens per agent.
// Protects against an attacker flooding a victim's inbox by repeatedly
// hitting the request endpoint. The 15-min TTL means stale tokens age
// out without manual cleanup.
const MAX_OUTSTANDING_PER_AGENT = 5;

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export interface IssueLinkResult {
  /** True when a token was issued and an email send should follow. False
   *  when the email did not match a known agent, OR the rate cap was hit. */
  issued: boolean;
  rawToken: string | null;
  agent: { id: string; name: string; email: string } | null;
}

/**
 * Issue a new sign-in token for the agent that owns `email`. Returns the
 * raw token to the caller (the caller is responsible for the email send
 * and MUST NOT log or persist it). If no agent matches, returns
 * { issued: false } so the route handler can still return a 200 to the
 * client and avoid leaking which emails are registered.
 */
export async function issueSignInLink(
  email: string,
  ctx: { ip?: string | null; userAgent?: string | null } = {},
): Promise<IssueLinkResult> {
  const normalised = email.toLowerCase().trim();
  if (!normalised || !normalised.includes('@')) {
    return { issued: false, rawToken: null, agent: null };
  }

  const { data: agent } = await db
    .from('agent_agents')
    .select('id, name, email')
    .eq('email', normalised)
    .maybeSingle();

  if (!agent) {
    return { issued: false, rawToken: null, agent: null };
  }

  // Cap outstanding tokens per agent so the request endpoint cannot be
  // weaponised as an inbox flood.
  const { count } = await db
    .from('agent_login_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agent.id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString());
  if ((count ?? 0) >= MAX_OUTSTANDING_PER_AGENT) {
    return { issued: false, rawToken: null, agent: null };
  }

  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const hash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const { error } = await db.from('agent_login_tokens').insert({
    agent_id: agent.id,
    token_hash: hash,
    expires_at: expiresAt,
    ip_requested: ctx.ip ?? null,
    user_agent_requested: ctx.userAgent ?? null,
  });
  if (error) {
    throw new Error(`issueSignInLink: failed to persist token: ${error.message}`);
  }

  return { issued: true, rawToken, agent };
}

export interface ConsumeResult {
  ok: boolean;
  agentId: string | null;
  reason: 'ok' | 'invalid' | 'expired' | 'used' | 'missing';
}

/**
 * Verify and consume a raw sign-in token. Atomic via the used_at update,
 * so a token cannot be redeemed twice even under a concurrent click. The
 * window between SELECT and UPDATE is small but non-zero; the UNIQUE
 * constraint on token_hash gives us idempotency for the hash itself, and
 * the used_at check is gated by `is null` so a double-click resolves to
 * one ok + one 'used' rather than two oks.
 */
export async function consumeSignInToken(rawToken: string): Promise<ConsumeResult> {
  if (!rawToken || rawToken.length < 16) {
    return { ok: false, agentId: null, reason: 'missing' };
  }
  const hash = sha256Hex(rawToken);

  const { data: row } = await db
    .from('agent_login_tokens')
    .select('id, agent_id, expires_at, used_at')
    .eq('token_hash', hash)
    .maybeSingle();

  if (!row) return { ok: false, agentId: null, reason: 'invalid' };
  if (row.used_at) return { ok: false, agentId: null, reason: 'used' };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, agentId: null, reason: 'expired' };
  }

  const { data: updated, error } = await db
    .from('agent_login_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .select('id')
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, agentId: null, reason: 'used' };
  }

  return { ok: true, agentId: row.agent_id, reason: 'ok' };
}
