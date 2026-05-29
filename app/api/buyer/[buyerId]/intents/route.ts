/**
 * Buying intents for a buyer profile.
 *
 *   GET    — list this buyer's intents (newest first)
 *   POST   — create an open intent { intent_text, structured? }
 *   DELETE — cancel an intent { id } (sets status='cancelled')
 *
 * Auth: the buyer's owner. Writes go through the service-role db client,
 * so ownership is enforced here, not by RLS.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  const { data, error } = await db
    .from('app_buyer_intents')
    .select('id, intent_text, structured, status, broadcast_at, resolved_at, created_at')
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ intents: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  let body: { intent_text?: unknown; structured?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const intentText = String(body.intent_text ?? '').trim();
  if (intentText.length < 3 || intentText.length > 2000) {
    return NextResponse.json({ error: 'intent_text must be 3 to 2000 characters' }, { status: 400 });
  }
  const structured = body.structured && typeof body.structured === 'object' && !Array.isArray(body.structured)
    ? (body.structured as Record<string, unknown>)
    : {};

  const { data, error } = await db
    .from('app_buyer_intents')
    .insert({ buyer_id: buyerId, intent_text: intentText, structured, status: 'open' })
    .select('id, intent_text, structured, status, broadcast_at, resolved_at, created_at')
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 });
  return NextResponse.json({ intent: data }, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const { data, error } = await db
    .from('app_buyer_intents')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('buyer_id', buyerId)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'intent not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
