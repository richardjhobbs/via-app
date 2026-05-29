import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();

  const { id } = await ctx.params;

  const { data: existing, error: countErr } = await db
    .from('app_buyer_memories')
    .select('id')
    .eq('buyer_id', id);
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  const deleted = (existing ?? []).length;

  const { error } = await db
    .from('app_buyer_memories')
    .delete()
    .eq('buyer_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted });
}
