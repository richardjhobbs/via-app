import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();

  const { id } = await ctx.params;
  const { active } = (await req.json()) as { active?: boolean };
  if (typeof active !== 'boolean') {
    return NextResponse.json({ error: 'active boolean is required' }, { status: 400 });
  }

  const { data, error } = await db
    .from('app_sellers')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, active')
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Seller not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, active: data.active });
}
