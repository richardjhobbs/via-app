/**
 * POST /api/buyer/[buyerId]/buying-agent/chat
 *
 * Buying Agent training chat. Accessible by:
 *   - super-admin via admin_token cookie (ADMIN_SECRET), OR
 *   - the buyer's owner (app_buyers.owner_user_id === auth.users.id)
 *
 * Writes land in app_buyer_memories via app_buyer_memory_upsert RPC. The
 * per-buyer MCP route at /buyers/[handle]/mcp reads the same store when a
 * seller agent calls get_buyer_preferences or negotiate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/app/auth';
import { getBuyerUser, isBuyerOwner } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';
import { runBuyingAgentTurn, type ChatMessage, type BuyingAgentContext } from '@/lib/app/buying-agent';

export const dynamic = 'force-dynamic';

interface ChatRequestBody {
  messages: ChatMessage[];
  sessionId?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;

  const superAdmin = await isAdminFromCookies();

  let actorLabel = '';
  let actorUserId: string | null = null;
  let source: 'owner_chat' | 'superadmin_chat' = 'owner_chat';

  if (superAdmin) {
    actorLabel = 'superadmin';
    source = 'superadmin_chat';
  } else {
    const user = await getBuyerUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const allowed = await isBuyerOwner(user.id, buyerId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not authorized for this buyer' }, { status: 403 });
    }
    actorLabel = user.email || user.id;
    actorUserId = user.id;
    source = 'owner_chat';
  }

  const { data: buyer, error: buyerErr } = await db
    .from('app_buyers')
    .select('id, handle, display_name')
    .eq('id', buyerId)
    .single();
  if (buyerErr || !buyer) {
    return NextResponse.json({ error: `Buyer not found: ${buyerErr?.message ?? ''}` }, { status: 404 });
  }

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

  const ctx: BuyingAgentContext = {
    buyerId:     buyer.id as string,
    handle:      buyer.handle as string,
    displayName: (buyer.display_name as string | null) ?? (buyer.handle as string),
    sessionId,
    actorLabel,
    actorUserId,
    source,
  };

  const result = await runBuyingAgentTurn(ctx, body.messages);

  return NextResponse.json({
    reply: result.reply,
    toolCalls: result.toolCalls,
    stopReason: result.stopReason,
    tokensUsed: result.tokensUsed,
    sessionId,
  });
}
