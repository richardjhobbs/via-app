/**
 * Toggle a Buying Agent's discoverability.
 *
 * `public = true` is what makes a buyer's briefs reach seller agents: the demand
 * feed, the per-buyer MCP endpoint, and the offer door all gate on it. A private
 * buyer can still create briefs, but no seller can see or offer on them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  let body: { public?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const isPublic = Boolean(body.public);

  const { error } = await db
    .from('app_buyers')
    .update({ public: isPublic, updated_at: new Date().toISOString() })
    .eq('id', buyerId);
  if (error) {
    console.error('[buyer/visibility]', error.message);
    return NextResponse.json({ error: 'Could not update visibility' }, { status: 500 });
  }
  return NextResponse.json({ public: isPublic });
}
