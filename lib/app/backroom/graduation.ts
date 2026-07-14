/**
 * The exit ramp: a Back Room graduates its co-created work into a product for
 * sale on VIA. One action creates (or reuses) a store LINKED to the room,
 * creates the digital product, LOCKS the agreed revenue split to each
 * participant's payout wallet, optionally copies a table file into the paid
 * deliverable, and places a "posted for sale" marker on the table.
 *
 * Invariants: the store is pending human approval like any agent store (it
 * cannot sell until approved). Outsiders buy through the existing x402 door;
 * the split pays each locked wallet on every sale (lib/app/splits.ts
 * calculateCoCreationSplit + auto-payout). Members keep the working file on the
 * table for free (they made it) , the deliberate co-creator carve-out.
 */
import { db } from '../db';
import { supabaseAdmin } from '../seller-auth';
import { createRoomStore } from '../store-registration';
import { loadRoom, isMember, getObject, placeObject, type Author } from './rooms';
import { getCardForMember } from './taste-cards';
import { digitalFileStoragePath, DIGITAL_BUCKET } from '../digital-delivery';

const APP_BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.getvia.xyz').replace(/\/$/, '');

export interface CoCreatorInput {
  member: Author;
  /** Share of the seller take (after platform 2.5%). Shares sum to 100. */
  pct:    number;
  role?:  string;
}

export interface GraduateInput {
  title:       string;
  description?: string;
  priceUsd:    number;
  cocreators:  CoCreatorInput[];
  /** Optional room table object (a placed file) to copy into the paid deliverable. */
  deliverableObjectId?: string;
}

export type GraduateResult =
  | { ok: true; store_slug: string; product_id: string; card_url: string }
  | { ok: false; error: string };

/** The founder's VIA account (owns the store) and contact email. Room stores
 *  must be founded by a VIA member; RRG-only members cannot own the store. */
async function resolveFounderAccount(founder: Author): Promise<{ ownerUserId: string; email: string } | null> {
  if (founder.member_platform !== 'via') return null;
  if (founder.member_type === 'seller') {
    const { data } = await db.from('app_sellers').select('owner_user_id, contact_email').eq('slug', founder.member_ref).maybeSingle();
    const d = data as { owner_user_id: string; contact_email: string } | null;
    return d ? { ownerUserId: d.owner_user_id, email: d.contact_email } : null;
  }
  const { data } = await db.from('app_buyers').select('owner_user_id').eq('handle', founder.member_ref).maybeSingle();
  const ownerUserId = (data as { owner_user_id: string } | null)?.owner_user_id;
  if (!ownerUserId) return null;
  const { data: u } = await supabaseAdmin.auth.admin.getUserById(ownerUserId);
  return { ownerUserId, email: u?.user?.email ?? '' };
}

/** Each co-creator's real USDC payout wallet (NOT the room identity wallet). */
async function resolvePayoutWallet(member: Author): Promise<string | null> {
  if (member.member_platform === 'via' && member.member_type === 'buyer') {
    const { data } = await db.from('app_buyers').select('wallet_address').eq('handle', member.member_ref).maybeSingle();
    return (data as { wallet_address: string | null } | null)?.wallet_address ?? null;
  }
  if (member.member_platform === 'via' && member.member_type === 'seller') {
    const { data } = await db.from('app_sellers').select('wallet_address').eq('slug', member.member_ref).maybeSingle();
    return (data as { wallet_address: string | null } | null)?.wallet_address ?? null;
  }
  // RRG member: the wallet snapshotted on their published card, else the cached
  // room membership wallet.
  const card = await getCardForMember(member.member_platform, member.member_type, member.member_ref);
  return card?.agent_identity.agent_wallet ?? null;
}

export async function graduateRoomToStore(roomId: string, founder: Author, input: GraduateInput): Promise<GraduateResult> {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, error: 'room not found' };
  if (!room.agent_wallet_address) return { ok: false, error: 'the room has no agent wallet; cannot graduate' };
  if (!(await isMember(roomId, founder.member_platform, founder.member_type, founder.member_ref))) {
    return { ok: false, error: 'only a room member can graduate the room' };
  }

  const title = input.title.trim();
  if (!title) return { ok: false, error: 'a product title is required' };
  if (!(input.priceUsd > 0)) return { ok: false, error: 'a positive price is required' };
  if (!input.cocreators.length) return { ok: false, error: 'at least one co-creator is required' };

  // Every co-creator must be a room member; percentages must sum to 100.
  const pctTotal = input.cocreators.reduce((s, c) => s + Number(c.pct), 0);
  if (Math.abs(pctTotal - 100) > 0.01) return { ok: false, error: `co-creator shares must sum to 100 (got ${pctTotal})` };

  const resolved: { member: Author; pct: number; role: string; wallet: string }[] = [];
  for (const c of input.cocreators) {
    if (!(await isMember(roomId, c.member.member_platform, c.member.member_type, c.member.member_ref))) {
      return { ok: false, error: `co-creator ${c.member.member_ref} is not a member of this room` };
    }
    const wallet = await resolvePayoutWallet(c.member);
    if (!wallet) return { ok: false, error: `could not resolve a payout wallet for ${c.member.member_ref}` };
    resolved.push({ member: c.member, pct: Number(c.pct), role: c.role ?? 'co-creator', wallet });
  }

  const account = await resolveFounderAccount(founder);
  if (!account) return { ok: false, error: 'the graduating member must be a VIA account (buyer or seller) that can own the store' };

  // ── Store: reuse the room's store if it already has one, else create it ──
  let sellerId: string;
  let storeSlug: string;
  const { data: existing } = await db.from('app_sellers').select('id, slug').eq('room_id', roomId).maybeSingle();
  if (existing) {
    sellerId = (existing as { id: string }).id;
    storeSlug = (existing as { slug: string }).slug;
  } else {
    const created = await createRoomStore({
      roomId,
      ownerUserId: account.ownerUserId,
      contactEmail: account.email,
      roomWallet: room.agent_wallet_address,
      storeName: room.name,
      headline: `A room on VIA where ${resolved.length} members make things together.`,
    });
    if (!created.ok) return { ok: false, error: created.error };
    sellerId = created.sellerId;
    storeSlug = created.slug;
  }

  // ── Product (draft; mints at point of sale like every VIA product) ──────
  const { data: product, error: prodErr } = await db
    .from('app_seller_products')
    .insert({
      seller_id:   sellerId,
      kind:        'digital',
      title,
      description: input.description ?? null,
      price_minor: Math.round(input.priceUsd * 1_000_000),
      currency:    'USDC',
      metadata:    { disclaimer: '' },
      active:      true,
    })
    .select('id')
    .single();
  if (prodErr || !product) return { ok: false, error: `could not create the product: ${prodErr?.message ?? 'insert failed'}` };
  const productId = (product as { id: string }).id;

  // ── Lock the split ──────────────────────────────────────────────────────
  const { error: splitErr } = await db.from('app_product_cocreators').insert(
    resolved.map((r) => ({
      product_id: productId,
      member_platform: r.member.member_platform,
      member_type: r.member.member_type,
      member_ref: r.member.member_ref,
      payout_wallet: r.wallet.toLowerCase(),
      pct: r.pct,
      role: r.role,
    })),
  );
  if (splitErr) return { ok: false, error: `could not lock the split: ${splitErr.message}` };

  // ── Deliverable: copy the room table file into the paid product path ────
  if (input.deliverableObjectId) {
    const obj = await getObject(roomId, input.deliverableObjectId);
    if (obj?.storage_path && obj.filename) {
      const dest = digitalFileStoragePath(sellerId, productId, obj.filename);
      const { error: copyErr } = await db.storage.from(DIGITAL_BUCKET).copy(obj.storage_path, dest);
      if (!copyErr) {
        await db.from('app_seller_products')
          .update({
            metadata: { disclaimer: '', digital_files: [{ path: dest, filename: obj.filename, content_type: obj.mime ?? undefined }] },
            image_url: null,
            url: null,
          })
          .eq('id', productId);
      } else {
        console.warn(`[graduation] deliverable copy failed (non-fatal): ${copyErr.message}`);
      }
    }
  }

  // ── Table marker: posted for sale, with the public link ─────────────────
  const cardUrl = `${APP_BASE}/store/${storeSlug}`;
  try {
    await placeObject(roomId, founder, {
      object_type: 'note',
      content: `Posted for sale: "${title}" , ${input.priceUsd} USDC. Split: ${resolved.map((r) => `${r.member.member_ref} ${r.pct}%`).join(', ')} of the seller take. Pending VIA approval before it goes live.`,
    });
    await placeObject(roomId, founder, { object_type: 'link', content: cardUrl });
  } catch (e) {
    console.warn(`[graduation] table marker failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }

  return { ok: true, store_slug: storeSlug, product_id: productId, card_url: cardUrl };
}
