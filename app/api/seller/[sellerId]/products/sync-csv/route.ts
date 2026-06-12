import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { getUsdcRate } from '@/lib/app/fx';
import { importCatalog } from '@/lib/app/catalog-import';
import { parseFile, validateRows, toShopifyShape, buildCsvStockMap, buildCsvVinylMap } from '@/lib/app/csv-import';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — generous for a 5k-row sheet

/**
 * POST /api/seller/[sellerId]/products/sync-csv
 *
 * Accepts multipart/form-data with a `file` field (CSV / XLSX / XLS).
 * Parses + validates against the 8-column VIA schema (see
 * reference_via_csv_schema.md). On validation failure: 422 with
 * row-level errors. On success: converts native prices to USDC via
 * lib/app/fx.ts and upserts via the shared importCatalog mapper.
 *
 * Inserted rows land as on_chain_status='draft'. The seller still
 * explicitly publishes each one on-chain via the existing
 * /publish endpoint.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const { data: seller, error: sellerErr } = await db
    .from('app_sellers')
    .select('id, slug, source_currency')
    .eq('id', sellerId)
    .single();
  if (sellerErr || !seller) {
    return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Body must be multipart/form-data' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large: ${file.size} bytes. Max ${MAX_BYTES}.` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let rows;
  try {
    rows = parseFile(file.name, buffer);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const validation = validateRows(rows);
  if (!validation.ok) {
    return NextResponse.json({
      ok:         false,
      rowsParsed: rows.length,
      errors:     validation.errors,
    }, { status: 422 });
  }

  // FX conversion based on the seller's source_currency.
  let fx;
  try {
    fx = await getUsdcRate(seller.source_currency);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // Adapter: convert NormalisedCsvProduct[] into the ShopifyProduct[]
  // shape importCatalog consumes. The stock + max_supply + kind that
  // the CSV carries per-row are stashed in a side-channel map so the
  // mapper's totalStockFor / kind-resolution can recover them.
  const stockMap = buildCsvStockMap(validation.products);
  const vinylMap = buildCsvVinylMap(validation.products);
  const shaped   = toShopifyShape(validation.products);

  const result = await importCatalog(shaped, {
    sellerId,
    source:           'csv',
    externalIdPrefix: 'csv',
    productUrlFor: (p) => {
      const idx = shaped.indexOf(p);
      return validation.products[idx]?.url ?? null;
    },
    totalStockFor: (p) => stockMap.get(p.handle)?.stock      ?? null,
    kindFor:       (p) => stockMap.get(p.handle)?.kind       ?? 'physical',
    vinylFor:      (p) => vinylMap.get(p.handle)             ?? null,
    fx,
  });

  return NextResponse.json({
    ok:         true,
    filename:   file.name,
    rowsParsed: rows.length,
    ...result,
  });
}
