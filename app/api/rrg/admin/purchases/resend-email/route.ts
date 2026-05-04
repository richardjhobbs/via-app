import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { isAdminFromCookies, adminUnauthorized } from '@/lib/rrg/auth';
import { sendPhysicalOrderToBrand, sendPhysicalPurchaseToBuyer } from '@/lib/rrg/email';
import { getSignedUrl } from '@/lib/rrg/storage';

export const dynamic = 'force-dynamic';

// POST /api/rrg/admin/purchases/resend-email
// Body: { purchaseId, to: 'brand' | 'buyer' | 'both' }
// Resends physical product emails for a completed purchase
export async function POST(req: NextRequest) {
  if (!(await isAdminFromCookies())) return adminUnauthorized();

  let purchaseId: string;
  let to: 'brand' | 'buyer' | 'both';

  try {
    const body = await req.json();
    purchaseId = body.purchaseId;
    to = body.to ?? 'both';
    if (!purchaseId) return NextResponse.json({ error: 'purchaseId required' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Fetch purchase with joined submission
  const { data: purchase, error: pErr } = await db
    .from('rrg_purchases')
    .select(`
      id, token_id, buyer_email, amount_usdc, tx_hash, download_token,
      shipping_name, shipping_address_line1, shipping_address_line2,
      shipping_city, shipping_state, shipping_postal_code, shipping_country,
      shipping_phone, selected_size, selected_color, brand_id, submission_id,
      rrg_submissions ( title, is_physical_product, price_usdc, brand_id, jpeg_storage_path,
        rrg_brands ( name, contact_email, wallet_address, brand_pct_override )
      )
    `)
    .eq('id', purchaseId)
    .single();

  if (pErr || !purchase) {
    return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = (purchase.rrg_submissions as unknown as Record<string, any> | null);
  if (!sub?.is_physical_product) {
    return NextResponse.json({ error: 'Not a physical product purchase' }, { status: 400 });
  }

  if (!purchase.shipping_name) {
    return NextResponse.json({ error: 'No shipping address on record for this purchase' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brandRow = (sub.rrg_brands as Record<string, any> | null);
  const brandName         = (brandRow?.name as string) ?? 'RRG';
  const brandContactEmail = (brandRow?.contact_email as string) ?? '';
  const brandPct          = typeof brandRow?.brand_pct_override === 'number' ? brandRow.brand_pct_override : 97.5;
  const priceUsdc         = parseFloat((sub.price_usdc as string) ?? purchase.amount_usdc ?? '0');
  const brandRevenueUsdc  = Math.round(priceUsdc * (brandPct / 100) * 100) / 100;

  // Fetch distribution notes to extract brand payout tx hash
  const { data: distRow } = await db
    .from('rrg_distributions')
    .select('notes')
    .eq('purchase_id', purchaseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  const brandPayoutTxHash = (() => {
    if (!distRow?.notes) return null;
    const brandEntry = distRow.notes.split(' | ').find((p: string) => p.startsWith('brand:'));
    return brandEntry ? brandEntry.slice('brand:'.length) : null;
  })();

  const siteUrl    = process.env.NEXT_PUBLIC_SITE_URL!;
  const downloadUrl = `${siteUrl}/rrg/download?token=${purchase.download_token}`;

  const shippingAddress = [
    purchase.shipping_address_line1,
    purchase.shipping_address_line2,
    [purchase.shipping_city, purchase.shipping_state, purchase.shipping_postal_code].filter(Boolean).join(', '),
    purchase.shipping_country,
  ].filter(Boolean).join('\n');

  const imageUrl = (sub.jpeg_storage_path as string | null)
    ? await getSignedUrl(sub.jpeg_storage_path as string, 604800).catch(() => null)
    : null;

  const emailData = {
    title:             sub.title as string,
    tokenId:           purchase.token_id,
    txHash:            purchase.tx_hash,
    brandPayoutTxHash,
    buyerEmail:        purchase.buyer_email ?? null,
    brandContactEmail,
    brandName,
    shippingName:      purchase.shipping_name,
    shippingAddress,
    shippingPhone:     purchase.shipping_phone ?? null,
    downloadUrl,
    ipfsMetadataUrl:   null,
    imageUrl,
    selectedSize:      purchase.selected_size  ?? null,
    selectedColor:     purchase.selected_color ?? null,
    priceUsdc,
    brandRevenueUsdc,
  };

  const sent: string[] = [];
  const errors: string[] = [];

  if ((to === 'brand' || to === 'both') && brandContactEmail) {
    try {
      await sendPhysicalOrderToBrand(emailData);
      sent.push(`brand (${brandContactEmail})`);
    } catch (e) {
      errors.push(`brand: ${String(e)}`);
    }
  }

  if ((to === 'buyer' || to === 'both') && purchase.buyer_email) {
    try {
      await sendPhysicalPurchaseToBuyer(emailData);
      sent.push(`buyer (${purchase.buyer_email})`);
    } catch (e) {
      errors.push(`buyer: ${String(e)}`);
    }
  }

  if (errors.length > 0 && sent.length === 0) {
    return NextResponse.json({ error: errors.join('; ') }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    sent,
    errors: errors.length > 0 ? errors : undefined,
    note: !purchase.buyer_email && (to === 'buyer' || to === 'both')
      ? 'No buyer email on record — buyer email not sent'
      : undefined,
  });
}
