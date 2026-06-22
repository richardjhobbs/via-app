/**
 * Digital-product delivery for VIA-app sellers.
 *
 * Mirrors the RRG model (lib/rrg/storage.ts + get_download_links in
 * app/mcp/route.ts): the deliverable file(s) live in a PRIVATE Supabase
 * storage bucket, and a buyer receives a time-limited signed URL only after a
 * settled purchase. The gate is an app_purchases row for (seller, product,
 * buyer_wallet) that has reached a paid status.
 *
 * A product's files are recorded on its row as metadata.digital_files: an
 * array of { path, filename, content_type? }. `path` is the object key inside
 * DIGITAL_BUCKET. The db client uses the service-role key, so signing and
 * upload bypass storage RLS; the bucket stays private and is never world
 * readable.
 */
import { db } from './db';

/** Private bucket for paid digital deliverables. Never public. */
export const DIGITAL_BUCKET = 'app-digital-assets';

/** Purchase statuses that entitle a buyer to the deliverable. 'paid' = USDC
 * captured (mint may still be pending); 'minted'/'paid_out' = fully settled. */
export const ENTITLING_STATUSES = ['paid', 'minted', 'paid_out'];

const DEFAULT_TTL_SECONDS = 86_400; // 24h, matches RRG getSignedUrl default

export interface DigitalFileRef {
  path:          string;
  filename:      string;
  content_type?: string;
}

export interface Deliverable {
  filename:      string;
  url:           string;
  content_type?: string;
}

/** Deterministic object key for a product's deliverable file. */
export function digitalFileStoragePath(sellerId: string, productId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `sellers/${sellerId}/products/${productId}/${safe}`;
}

/** Read the digital_files array off a product's metadata jsonb. */
export function getDigitalFiles(metadata: unknown): DigitalFileRef[] {
  const files = (metadata as Record<string, unknown> | null | undefined)?.digital_files;
  if (!Array.isArray(files)) return [];
  return files.filter(
    (f): f is DigitalFileRef => !!f && typeof (f as DigitalFileRef).path === 'string' && typeof (f as DigitalFileRef).filename === 'string',
  );
}

/** Sign a single object key in the private digital bucket. */
export async function signDigitalUrl(path: string, expiresInSeconds = DEFAULT_TTL_SECONDS): Promise<string> {
  const { data, error } = await db.storage.from(DIGITAL_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) throw new Error(`signed url failed for ${path}: ${error?.message ?? 'no url'}`);
  return data.signedUrl;
}

/**
 * True when buyerWallet has an entitling purchase of this product from this
 * seller. The wallet is the identity that settled on VIA (recorded lowercased
 * on app_purchases.buyer_wallet).
 */
export async function buyerHasPaidFor(sellerId: string, productId: string, buyerWallet: string): Promise<boolean> {
  const { data, error } = await db
    .from('app_purchases')
    .select('id')
    .eq('seller_id', sellerId)
    .eq('product_id', productId)
    .eq('buyer_wallet', buyerWallet.toLowerCase())
    .in('status', ENTITLING_STATUSES)
    .limit(1);
  if (error) {
    console.error('[digital-delivery] buyerHasPaidFor query failed:', error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** Sign download URLs for a product's deliverable files. */
export async function buildDeliverables(files: DigitalFileRef[], ttlSeconds = DEFAULT_TTL_SECONDS): Promise<Deliverable[]> {
  return Promise.all(
    files.map(async (f) => ({
      filename:     f.filename,
      content_type: f.content_type,
      url:          await signDigitalUrl(f.path, ttlSeconds),
    })),
  );
}

export const DIGITAL_TTL_SECONDS = DEFAULT_TTL_SECONDS;
