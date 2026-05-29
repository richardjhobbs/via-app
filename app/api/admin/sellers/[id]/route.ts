import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

interface PatchBody {
  name?:           string;
  headline?:       string | null;
  description?:    string | null;
  website_url?:    string | null;
  wallet_address?: string;
}

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();

  const { id } = await ctx.params;
  const body = (await req.json()) as PatchBody;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
  if (body.headline !== undefined)    update.headline    = body.headline?.toString().trim() || null;
  if (body.description !== undefined) update.description = body.description?.toString().trim() || null;
  if (body.website_url !== undefined) update.website_url = body.website_url?.toString().trim() || null;
  if (typeof body.wallet_address === 'string') {
    if (!ADDR_RE.test(body.wallet_address.trim())) {
      return NextResponse.json({ error: 'wallet_address must be a 42-char 0x… address' }, { status: 400 });
    }
    update.wallet_address = body.wallet_address.trim();
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
  }

  const { data, error } = await db
    .from('app_sellers')
    .update(update)
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Seller not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
