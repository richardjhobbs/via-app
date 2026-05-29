import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/app/db';
import { isAdminFromCookies, adminUnauthorized } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

/**
 * Hermes Brand Concierge provisioning queue.
 *
 * Shape mirrors RRG /api/rrg/admin/hermes-concierge so the existing
 * operator-side runner
 *   via-agent-wiki/scripts/via-concierges/process-pending-concierges.ps1
 * retargets at VIA by changing only its base URL.
 *
 * GET  /api/admin/hermes-concierge          (isAdminFromCookies OR x-admin-secret)
 *   → { pending: [{id, slug, name, description, contact_email, status,
 *                 hermes_concierge_status, hermes_concierge_url}, ...] }
 *
 * POST /api/admin/hermes-concierge          (explicit x-admin-secret)
 *   body: { slug, status, url? }
 *     status: 'provisioned' OR starts with 'failed:'
 *     url:    only honoured when status='provisioned'; writes
 *             hermes_concierge_url so the per-seller MCP can delegate
 *             ask_sales_agent to the live process.
 */

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function readerAuthed(req: NextRequest): Promise<boolean> {
  if (await isAdminFromCookies()) return true;
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = req.headers.get('x-admin-secret');
  return Boolean(adminSecret && adminHeader && timingSafeEqual(adminHeader, adminSecret));
}

function writeAuthed(req: NextRequest): boolean {
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = req.headers.get('x-admin-secret');
  return Boolean(adminSecret && adminHeader && timingSafeEqual(adminHeader, adminSecret));
}

export async function GET(req: NextRequest) {
  if (!(await readerAuthed(req))) return adminUnauthorized();

  const { data, error } = await db
    .from('app_sellers')
    .select('id, slug, name, description, contact_email, active, hermes_concierge_status, hermes_concierge_url')
    .eq('active', true)
    .eq('hermes_concierge_status', 'pending')
    .order('slug', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ pending: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!writeAuthed(req)) return adminUnauthorized();

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const slug   = String(body.slug   ?? '').trim().toLowerCase();
  const status = String(body.status ?? '').trim();
  const urlIn  = typeof body.url === 'string' ? body.url.trim() : null;

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
  if (status.length > 150) {
    return NextResponse.json({ error: 'status must be <= 150 characters' }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    hermes_concierge_status: status,
    updated_at:              new Date().toISOString(),
  };
  if (status === 'provisioned' && urlIn) {
    try { new URL(urlIn); } catch {
      return NextResponse.json({ error: 'url must be a full URL (https://…)' }, { status: 400 });
    }
    update.hermes_concierge_url = urlIn;
  }

  const { data, error } = await db
    .from('app_sellers')
    .update(update)
    .eq('slug', slug)
    .select('slug, hermes_concierge_status, hermes_concierge_url')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: `seller "${slug}" not found` }, { status: 404 });

  return NextResponse.json({ ok: true, seller: data });
}
