import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/app/db';
import { isAdminFromCookies, adminUnauthorized } from '@/lib/app/auth';
import { approveAgentStore, rejectAgentStore } from '@/lib/app/store-registration';

export const dynamic = 'force-dynamic';

/**
 * Agent-store moderation queue.
 *
 * Agent self-registered stores (register_store on app.getvia.xyz/mcp) land in
 * approval_status='pending' and stay invisible until a human approves them
 * inside the 24-hour window. This endpoint is the operator surface.
 *
 * GET  /api/admin/store-approvals     (admin cookie OR x-admin-secret)
 *   → { pending: [{ slug, name, kind, contact_email, wallet_address,
 *                   agent_wallet_address, description, website_url,
 *                   submitted_at, approval_eligible_at }, ...] }
 *
 * POST /api/admin/store-approvals     (admin cookie OR x-admin-secret)
 *   body: { slug, decision: 'approve' | 'reject', reason? }
 *     approve → store goes active, ERC-8004 minted to its agent_wallet
 *     reject  → store stays offline, reason recorded (reason required)
 */

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function adminAuthed(req: NextRequest): Promise<boolean> {
  if (await isAdminFromCookies()) return true;
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = req.headers.get('x-admin-secret');
  return Boolean(adminSecret && adminHeader && timingSafeEqual(adminHeader, adminSecret));
}

export async function GET(req: NextRequest) {
  if (!(await adminAuthed(req))) return adminUnauthorized();

  const { data, error } = await db
    .from('app_sellers')
    .select('slug, name, kind, contact_email, wallet_address, agent_wallet_address, description, headline, website_url, submitted_at, approval_eligible_at')
    .eq('approval_status', 'pending')
    .order('submitted_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ pending: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await adminAuthed(req))) return adminUnauthorized();

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const slug     = String(body.slug ?? '').trim().toLowerCase();
  const decision = String(body.decision ?? '').trim();
  const reason   = typeof body.reason === 'string' ? body.reason : '';

  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }

  if (decision === 'approve') {
    const result = await approveAgentStore(slug, 'superadmin');
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json(result);
  }

  // reject
  if (!reason.trim()) {
    return NextResponse.json({ error: 'reason is required when rejecting a store' }, { status: 400 });
  }
  const result = await rejectAgentStore(slug, reason, 'superadmin');
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}
