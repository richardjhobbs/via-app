/**
 * Admin endpoints for the Hermes Brand Concierge provisioning queue.
 *
 * GET  /api/rrg/admin/hermes-concierge          (isAdminReader)
 *   → returns brands with hermes_concierge_status='pending' so an operator-
 *     side processor can provision them on the Box. Each row includes the
 *     fields the processor needs to render templates and skip work it has
 *     already done (slug, name, description).
 *
 * POST /api/rrg/admin/hermes-concierge          (explicit ADMIN_SECRET)
 *   body: { slug: string, status: 'provisioned' | string }   // 'failed:<msg>' allowed
 *   → updates that brand's hermes_concierge_status. The processor calls this
 *     after a successful provision (status='provisioned') or after a failed
 *     attempt (status='failed:<short reason>') so the next pass shows the
 *     state. Idempotent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminReader, adminUnauthorized } from '@/lib/rrg/auth';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isAdminReader(req))) return adminUnauthorized();
  const { data, error } = await db
    .from('rrg_brands')
    .select('id, slug, name, description, contact_email, status, hermes_concierge_status')
    .eq('status', 'active')
    .eq('hermes_concierge_status', 'pending')
    .order('slug', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pending: data ?? [] });
}

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  const header = req.headers.get('x-admin-secret');
  if (!adminSecret || !header || header !== adminSecret) return adminUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const slug = String(body.slug ?? '').trim().toLowerCase();
  const status = String(body.status ?? '').trim();
  if (!slug || !status) {
    return NextResponse.json(
      { error: 'slug and status are required (status: "provisioned" or "failed:<msg>")' },
      { status: 400 },
    );
  }
  if (status !== 'provisioned' && !status.startsWith('failed:')) {
    return NextResponse.json(
      { error: 'status must be "provisioned" or "failed:<msg>"' },
      { status: 400 },
    );
  }

  const { data, error } = await db
    .from('rrg_brands')
    .update({ hermes_concierge_status: status })
    .eq('slug', slug)
    .select('slug, hermes_concierge_status')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `brand "${slug}" not found` }, { status: 404 });
  return NextResponse.json({ ok: true, brand: data });
}
