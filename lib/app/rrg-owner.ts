/**
 * Provision the Supabase auth owner for an imported/migrated RRG buyer agent.
 *
 * app_buyers.owner_user_id is NOT NULL, so importing a buyer requires a real
 * auth user for its human owner. Shared by the interactive link-rrg handoff and
 * the bulk migration importer, so both create owners identically.
 */
import { supabaseAdmin } from './seller-auth';

/** Find-or-create the Supabase auth user for an email. Returns the user id, or null. */
export async function findOrCreateUser(email: string, walletAddress: string, source: string): Promise<string | null> {
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { source, wallet_address: walletAddress.toLowerCase() },
  });
  if (!createErr) return created.user.id;
  const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
  const found = list?.users?.find((u: { email?: string | null; id: string }) => u.email?.toLowerCase() === email.toLowerCase());
  return found?.id ?? null;
}
