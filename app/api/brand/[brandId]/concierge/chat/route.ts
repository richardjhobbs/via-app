/**
 * POST /api/brand/[brandId]/concierge/chat
 *
 * Admin chat surface for the Brand Concierge. Accessible by:
 *   - super-admin via admin_token cookie (ADMIN_SECRET)
 *   - brand admin via Supabase session + rrg_brand_members membership
 *
 * Writes land in rrg_brand_memories, which the per-brand nanobot on Box
 * reads via the same-name tools. Admin and Telegram see the same memory.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/rrg/auth';
import { getBrandUser, isBrandAdmin } from '@/lib/rrg/brand-auth';
import { db } from '@/lib/rrg/db';
import { runConciergeTurn, type ChatMessage, type BrandConciergeContext } from '@/lib/rrg/brand-concierge';

export const dynamic = 'force-dynamic';

interface ChatRequestBody {
  messages: ChatMessage[];
  sessionId?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> },
) {
  const { brandId } = await params;

  // ── Authenticate: super-admin OR brand admin for this brand ────────
  const superAdmin = await isAdminFromCookies();

  let actorLabel = '';
  let actorUserId: string | null = null;
  let source: 'admin_chat' | 'superadmin_chat' = 'admin_chat';

  if (superAdmin) {
    actorLabel = 'superadmin';
    source = 'superadmin_chat';
  } else {
    const user = await getBrandUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const allowed = await isBrandAdmin(user.id, brandId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not authorized for this brand' }, { status: 403 });
    }
    actorLabel = user.email || user.id;
    actorUserId = user.id;
    source = 'admin_chat';
  }

  // ── Resolve brand slug + name ──────────────────────────────────────
  const { data: brand, error: brandErr } = await db
    .from('rrg_brands')
    .select('id, slug, name')
    .eq('id', brandId)
    .single();
  if (brandErr || !brand) {
    return NextResponse.json({ error: `Brand not found: ${brandErr?.message ?? ''}` }, { status: 404 });
  }

  // ── Parse body ─────────────────────────────────────────────────────
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: '`messages` must be a non-empty array' }, { status: 400 });
  }
  const sessionId = body.sessionId && typeof body.sessionId === 'string' && body.sessionId.length <= 64
    ? body.sessionId
    : crypto.randomUUID();

  const ctx: BrandConciergeContext = {
    brandId: brand.id as string,
    brandSlug: brand.slug as string,
    brandName: brand.name as string,
    sessionId,
    actorLabel,
    actorUserId,
    source,
  };

  const result = await runConciergeTurn(ctx, body.messages);

  return NextResponse.json({
    reply: result.reply,
    toolCalls: result.toolCalls,
    stopReason: result.stopReason,
    tokensUsed: result.tokensUsed,
    sessionId,
  });
}
