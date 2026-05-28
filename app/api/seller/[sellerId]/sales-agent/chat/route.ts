/**
 * POST /api/seller/[sellerId]/concierge/chat
 *
 * Admin chat surface for the Brand Concierge. Accessible by:
 *   - super-admin via admin_token cookie (ADMIN_SECRET)
 *   - brand admin via Supabase session + app_seller_members membership
 *
 * Writes land in app_seller_memories, which the per-brand nanobot on Box
 * reads via the same-name tools. Admin and Telegram see the same memory.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/app/auth';
import { getSellerUser, isBrandAdmin } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';
import { runConciergeTurn, type ChatMessage, type SalesAgentContext } from '@/lib/app/sales-agent';

export const dynamic = 'force-dynamic';

interface ChatRequestBody {
  messages: ChatMessage[];
  sessionId?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;

  // ── Authenticate: super-admin OR brand admin for this brand ────────
  const superAdmin = await isAdminFromCookies();

  let actorLabel = '';
  let actorUserId: string | null = null;
  let source: 'admin_chat' | 'superadmin_chat' = 'admin_chat';

  if (superAdmin) {
    actorLabel = 'superadmin';
    source = 'superadmin_chat';
  } else {
    const user = await getSellerUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const allowed = await isBrandAdmin(user.id, sellerId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not authorized for this brand' }, { status: 403 });
    }
    actorLabel = user.email || user.id;
    actorUserId = user.id;
    source = 'admin_chat';
  }

  // ── Resolve brand slug + name ──────────────────────────────────────
  const { data: brand, error: brandErr } = await db
    .from('app_sellers')
    .select('id, slug, name')
    .eq('id', sellerId)
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

  const ctx: SalesAgentContext = {
    sellerId: brand.id as string,
    sellerSlug: brand.slug as string,
    sellerName: brand.name as string,
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
