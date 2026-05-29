import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isAdmin, adminUnauthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return adminUnauthorized();

  const { id } = await ctx.params;
  const { public: nextPublic } = (await req.json()) as { public?: boolean };
  if (typeof nextPublic !== 'boolean') {
    return NextResponse.json({ error: 'public boolean is required' }, { status: 400 });
  }

  const { data, error } = await db
    .from('app_buyers')
    .update({ public: nextPublic, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, public')
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Buyer not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, public: data.public });
}
