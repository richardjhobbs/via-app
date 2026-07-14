/**
 * The marketing card for a room-graduated store: the shareable face of a
 * co-created product, for humans (a page + image) and agents (JSON + an MCP
 * tool). Mirrors the taste-card pattern. Shows the product, its price, and the
 * co-creators with their verifiable ERC-8004 identity and payout wallet, plus
 * the buy pointer (the existing per-seller x402 door). Never exposes the paid
 * deliverable key.
 */
import { db } from '../db';
import { getPublishedCardForMember } from './taste-cards';
import type { MemberPlatform, MemberType } from './rooms';

const APP_BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.getvia.xyz').replace(/\/$/, '');

export interface StoreCardCoCreator {
  ref:              string;
  name:             string;
  pct:              number;
  wallet:           string;
  erc8004_agent_id: string | null;
  card_slug:        string | null;
}

export interface StoreCardProduct {
  id:          string;
  title:       string;
  description: string | null;
  price_usd:   number;
  kind:        string;
  disclaimer:  string;
  buyable:     boolean;
  cocreators:  StoreCardCoCreator[];
}

export interface StoreCard {
  slug:         string;
  store_name:   string;
  headline:     string | null;
  status:       'live' | 'pending';
  seller_mcp_url: string;
  page_url:     string;
  products:     StoreCardProduct[];
}

async function resolveCoCreatorIdentity(platform: MemberPlatform, type: MemberType, ref: string, pct: number, wallet: string): Promise<StoreCardCoCreator> {
  const card = await getPublishedCardForMember(platform, type, ref);
  let name = card?.display_name || ref;
  let erc8004 = card?.agent_identity.erc8004_agent_id ?? null;
  if (!card) {
    // Fall back to the account record for name + erc8004.
    if (platform === 'via' && type === 'buyer') {
      const { data } = await db.from('app_buyers').select('display_name, erc8004_agent_id').eq('handle', ref).maybeSingle();
      const d = data as { display_name: string | null; erc8004_agent_id: string | null } | null;
      if (d) { name = d.display_name || ref; erc8004 = d.erc8004_agent_id; }
    } else if (platform === 'via' && type === 'seller') {
      const { data } = await db.from('app_sellers').select('name, erc8004_agent_id').eq('slug', ref).maybeSingle();
      const d = data as { name: string | null; erc8004_agent_id: string | null } | null;
      if (d) { name = d.name || ref; erc8004 = d.erc8004_agent_id; }
    }
  }
  return { ref, name, pct, wallet, erc8004_agent_id: erc8004, card_slug: card?.slug ?? null };
}

/** The card for a room-graduated store, or null. Only stores born from a room. */
export async function getStoreCardBySlug(slug: string): Promise<StoreCard | null> {
  const s = slug.trim().toLowerCase();
  const { data: seller } = await db
    .from('app_sellers')
    .select('id, slug, name, headline, active, room_id')
    .eq('slug', s)
    .maybeSingle();
  const sellerRow = seller as { id: string; slug: string; name: string; headline: string | null; active: boolean; room_id: string | null } | null;
  if (!sellerRow || !sellerRow.room_id) return null;  // only room-graduated stores get this card

  const { data: prods } = await db
    .from('app_seller_products')
    .select('id, title, description, price_minor, kind, metadata, active, on_chain_status')
    .eq('seller_id', sellerRow.id)
    .eq('active', true)
    .order('created_at', { ascending: true });

  const products: StoreCardProduct[] = [];
  for (const p of (prods as Record<string, unknown>[]) ?? []) {
    const { data: cc } = await db
      .from('app_product_cocreators')
      .select('member_platform, member_type, member_ref, payout_wallet, pct')
      .eq('product_id', p.id as string);
    const rows = (cc as { member_platform: MemberPlatform; member_type: MemberType; member_ref: string; payout_wallet: string; pct: number }[] | null) ?? [];
    if (!rows.length) continue;  // the card is for co-created products
    const cocreators = await Promise.all(
      rows.map((r) => resolveCoCreatorIdentity(r.member_platform, r.member_type, r.member_ref, Number(r.pct), r.payout_wallet)),
    );
    const metadata = (p.metadata ?? {}) as Record<string, unknown>;
    products.push({
      id: String(p.id),
      title: String(p.title),
      description: (p.description as string | null) ?? null,
      price_usd: Number(p.price_minor) / 1_000_000,
      kind: String(p.kind),
      disclaimer: typeof metadata.disclaimer === 'string' ? metadata.disclaimer : '',
      buyable: sellerRow.active && p.on_chain_status !== 'draft',
      cocreators,
    });
  }
  if (!products.length) return null;

  return {
    slug: sellerRow.slug,
    store_name: sellerRow.name,
    headline: sellerRow.headline,
    status: sellerRow.active ? 'live' : 'pending',
    seller_mcp_url: `${APP_BASE}/sellers/${sellerRow.slug}/mcp`,
    page_url: `${APP_BASE}/store/${sellerRow.slug}`,
    products,
  };
}

export function storeCardUrl(slug: string): string {
  return `${APP_BASE}/store/${slug}`;
}

/** Agent-readable shape served at /api/store/[slug] and by get_store_card. */
export function storeCardJson(card: StoreCard): Record<string, unknown> {
  return {
    v: 'via-store-card-1',
    slug: card.slug,
    store_name: card.store_name,
    headline: card.headline,
    status: card.status,
    products: card.products.map((p) => ({
      product_id: p.id,
      title: p.title,
      description: p.description,
      price_usd: p.price_usd,
      kind: p.kind,
      disclaimer: p.disclaimer || null,
      buyable: p.buyable,
      cocreators: p.cocreators.map((c) => ({
        name: c.name,
        share_pct: c.pct,
        payout_wallet: c.wallet,
        erc8004_agent_id: c.erc8004_agent_id,
        card_url: c.card_slug ? `${APP_BASE}/taste/${c.card_slug}` : null,
      })),
      buy: { seller_mcp_url: card.seller_mcp_url, product_id: p.id, note: 'Buy through the seller MCP buy_product tool; settles over the x402 door.' },
    })),
  };
}
