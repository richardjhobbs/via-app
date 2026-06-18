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
import { hasCredits, deductCredits } from '@/lib/app/buyer-credits';
import { resolveBuyerLlm } from '@/lib/app/buyer-llm';

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
    .select('id, handle, display_name, llm_byo_provider, llm_byo_key_encrypted, llm_byo_model')
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

  // BYO key runs on the owner's own provider (billed by them), so it bypasses
  // platform credits entirely. Platform (DeepSeek) usage is metered.
  const llm = resolveBuyerLlm(buyer);

  // Credit gate , owner chat on the PLATFORM model is metered against the
  // buyer's balance. Superadmin chat and BYO are free of platform credits.
  // Block cleanly (402) when the balance is spent.
  if (source === 'owner_chat' && !llm.isByo) {
    const ok = await hasCredits(buyerId);
    if (!ok) {
      return NextResponse.json(
        { error: 'Out of credits. Top up, or connect your own LLM key, to keep training your agent.', code: 'insufficient_credits' },
        { status: 402 },
      );
    }
  }

  const result = await runBuyingAgentTurn(ctx, body.messages, llm);

  // Deduct after the call against exact token usage (incl. 25% margin). Skipped
  // for BYO (owner is billed directly by their provider).
  let creditBalance: number | undefined;
  if (source === 'owner_chat' && !result.isByo && result.tokensUsed > 0) {
    try {
      creditBalance = await deductCredits(buyerId, result.tokensUsed);
    } catch (err) {
      console.error('[buyer/chat] credit deduction failed:', err);
    }
  }

  return NextResponse.json({
    reply: result.reply,
    toolCalls: result.toolCalls,
    stopReason: result.stopReason,
    tokensUsed: result.tokensUsed,
    creditBalance,
    sessionId,
  });
}
