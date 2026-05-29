/**
 * Agent-driven in-app notifications.
 *
 * Rows write into app_notifications from server-only paths (per-seller
 * MCP handlers, per-buyer MCP handlers, x402 settlement endpoint when it
 * lands). The dashboard NotificationBell polls /api/notifications every
 * 30s, surfaces unread count + recent rows, and pushes the count into
 * the installed-PWA badge via navigator.setAppBadge().
 *
 * No transactional email. Chain detail (Base, on-chain tx hashes) lives
 * inside metadata for later linking; the headline copy stays clean.
 */

import { db } from './db';

export type NotificationKind = 'enquiry' | 'sale' | 'transfer' | 'system';

export interface InsertNotificationInput {
  /** Supabase auth.users.id of the recipient (seller or buyer owner). */
  ownerUserId: string;
  kind:         NotificationKind;
  title:        string;
  body?:        string | null;
  /** Relative path inside app.getvia.xyz the bell click should open. */
  link?:        string | null;
  /** Free-form context: tool name, agent identity, tx hash, etc. */
  metadata?:    Record<string, unknown>;
}

/**
 * Server-side insert. Never throws — a failed notification must not
 * break the MCP call that triggered it. Returns the new row id on
 * success, null on any failure (the failure is logged).
 */
export async function insertNotification(input: InsertNotificationInput): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('app_notifications')
      .insert({
        owner_user_id: input.ownerUserId,
        kind:          input.kind,
        title:         input.title,
        body:          input.body  ?? null,
        link:          input.link  ?? null,
        metadata:      input.metadata ?? {},
      })
      .select('id')
      .single();

    if (error) {
      console.error('[notifications] insert failed:', error.message, { kind: input.kind, ownerUserId: input.ownerUserId });
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (e) {
    console.error('[notifications] insert threw:', e);
    return null;
  }
}

/**
 * Resolve the seller's owner user id from a slug. Wrapper so MCP
 * handlers don't repeat the query and so a single source of truth
 * exists for the seller → owner mapping.
 */
export async function getSellerOwnerUserIdBySlug(slug: string): Promise<string | null> {
  const { data } = await db
    .from('app_sellers')
    .select('owner_user_id')
    .eq('slug', slug)
    .maybeSingle();
  return (data?.owner_user_id as string | undefined) ?? null;
}

/**
 * Same for buyers (Stage 2).
 */
export async function getBuyerOwnerUserIdByHandle(handle: string): Promise<string | null> {
  const { data } = await db
    .from('app_buyers')
    .select('owner_user_id')
    .eq('handle', handle)
    .maybeSingle();
  return (data?.owner_user_id as string | undefined) ?? null;
}
