/**
 * Resolve an RRG member for a VIA Back Room over HTTP.
 *
 * RRG is a separate project; VIA never reads its database, only federates over
 * HTTP (the same rule as network search). Two RRG member kinds map in:
 *   rrg/seller = brand concierge  , identified by brand slug, own EOA wallet.
 *   rrg/buyer  = personal concierge, which already IMPORTS into VIA as a buying
 *                agent via the shared-secret handoff (lib/app/rrg-handoff.ts),
 *                so once linked it is a native via/buyer and is not resolved
 *                here. This module is for brands.
 *
 * Wallet resolution: RRG's public /api/via/search carries a brand's name and
 * per-brand MCP url but NOT its wallet. So we first try a dedicated identity
 * endpoint (which RRG can add later, contract below) and fall back to the
 * search for name only. When the wallet cannot be fetched, the caller supplies
 * it (an admin adding the brand knows it); auth still works because the wallet
 * is cached on the membership row.
 *
 * Intended RRG identity endpoint (to add on the RRG side):
 *   GET {RRG_BASE}/api/via/identity?kind=seller&ref=<slug>
 *   -> { platform:'rrg', kind:'seller', ref:<slug>, name, wallet_address, mcp_url }
 */

const RRG_BASE = (process.env.RRG_BASE_URL || 'https://realrealgenuine.com').replace(/\/$/, '');

export interface RrgMemberIdentity {
  platform: 'rrg';
  kind: 'seller';
  ref: string;
  name: string | null;
  wallet_address: string | null;
  mcp_url: string | null;
}

async function tryIdentityEndpoint(kind: 'seller', ref: string): Promise<RrgMemberIdentity | null> {
  try {
    const url = `${RRG_BASE}/api/via/identity?kind=${encodeURIComponent(kind)}&ref=${encodeURIComponent(ref)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const j = await res.json() as Partial<RrgMemberIdentity>;
    if (!j || j.kind !== 'seller') return null;
    return {
      platform: 'rrg', kind: 'seller', ref,
      name: j.name ?? null,
      wallet_address: (j.wallet_address ?? null) as string | null,
      mcp_url: j.mcp_url ?? `${RRG_BASE}/brand/${ref}/mcp`,
    };
  } catch {
    return null;
  }
}

/**
 * Fall back to the per-brand MCP descriptor for the brand's own name (the
 * /api/via/search ?seller= list returns the brand's PRODUCTS, whose names are
 * product titles, not the brand). A GET on the per-brand MCP without SSE accept
 * headers returns a JSON descriptor carrying the brand name. Wallet is still not
 * exposed, so it is supplied by the caller.
 */
async function tryBrandDescriptor(ref: string): Promise<RrgMemberIdentity | null> {
  const mcpUrl = `${RRG_BASE}/brand/${encodeURIComponent(ref)}/mcp`;
  try {
    const res = await fetch(mcpUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const j = await res.json() as { name?: string; brand?: { name?: string } };
    const name = j.brand?.name ?? j.name ?? null;
    if (!name) return null;
    return { platform: 'rrg', kind: 'seller', ref, name, wallet_address: null, mcp_url: mcpUrl };
  } catch {
    return null;
  }
}

/** Resolve an RRG brand concierge by slug. Wallet may be null (caller supplies). */
export async function resolveRrgBrand(slug: string): Promise<RrgMemberIdentity | null> {
  const ref = slug.trim();
  if (!ref) return null;
  return (await tryIdentityEndpoint('seller', ref)) ?? (await tryBrandDescriptor(ref));
}
