import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

interface AgentRow {
  id: string;
  email: string;
  name: string;
  tier: 'basic' | 'pro';
  status: string;
  wallet_address: string;
  wallet_type: string;
  llm_provider: string;
  credit_balance_usdc: number;
  budget_ceiling_usdc: number | null;
  erc8004_agent_id: number | null;
  erc8004_linked: boolean;
  style_tags: string[];
  free_instructions: string | null;
  bid_aggression: string;
  persona_bio: string | null;
  avatar_path: string | null;
  avatar_source: string | null;
  created_at: string;
}

/**
 * GET /api/rrg/admin/agents
 *
 * Returns the hydrated list of personal agents (Personal Shopper + Concierge)
 * for the superadmin Agents tab. Joins lightweight aggregates from
 * agent_chat_messages, agent_evaluations, agent_credit_transactions,
 * and agent_activity_log so each row carries the full operating picture.
 *
 * Cost note: at current scale (<100 agents) parallel table-wide selects are
 * fine. If this grows, replace with a SQL view or materialised aggregate.
 */
export async function GET() {
  const jar = await cookies();
  const token = jar.get('rrg_admin_token')?.value;
  if (token !== process.env.RRG_ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [
      agentsRes,
      chatsRes,
      evalsRes,
      creditsRes,
      activityRes,
    ] = await Promise.all([
      db
        .from('agent_agents')
        .select('id, email, name, tier, status, wallet_address, wallet_type, llm_provider, credit_balance_usdc, budget_ceiling_usdc, erc8004_agent_id, erc8004_linked, style_tags, free_instructions, bid_aggression, persona_bio, avatar_path, avatar_source, created_at')
        .order('created_at', { ascending: false }),
      db.from('agent_chat_messages').select('agent_id, session_id, role, tokens_used, cost_usdc, created_at'),
      db.from('agent_evaluations').select('agent_id, decision, owner_approved, suggested_bid_usdc, created_at'),
      db.from('agent_credit_transactions').select('agent_id, type, amount_usdc, created_at'),
      db
        .from('agent_activity_log')
        .select('agent_id, action, created_at')
        .order('created_at', { ascending: false }),
    ]);

    if (agentsRes.error) throw agentsRes.error;

    const agents = (agentsRes.data ?? []) as AgentRow[];

    // ── Aggregate by agent_id ──────────────────────────────────────────
    const chatByAgent = new Map<string, {
      messages: number;
      userMessages: number;
      sessions: Set<string>;
      tokens: number;
      cost: number;
      lastChatAt: string | null;
    }>();
    for (const row of chatsRes.data ?? []) {
      const id = row.agent_id as string;
      const bucket = chatByAgent.get(id) ?? {
        messages: 0,
        userMessages: 0,
        sessions: new Set<string>(),
        tokens: 0,
        cost: 0,
        lastChatAt: null,
      };
      bucket.messages += 1;
      if (row.role === 'user') bucket.userMessages += 1;
      if (row.session_id) bucket.sessions.add(row.session_id as string);
      bucket.tokens += Number(row.tokens_used ?? 0);
      bucket.cost += Number(row.cost_usdc ?? 0);
      const ts = row.created_at as string | null;
      if (ts && (!bucket.lastChatAt || ts > bucket.lastChatAt)) bucket.lastChatAt = ts;
      chatByAgent.set(id, bucket);
    }

    const evalByAgent = new Map<string, {
      evaluations: number;
      bids: number;
      skips: number;
      approvals: number;
    }>();
    for (const row of evalsRes.data ?? []) {
      const id = row.agent_id as string;
      const bucket = evalByAgent.get(id) ?? { evaluations: 0, bids: 0, skips: 0, approvals: 0 };
      bucket.evaluations += 1;
      if (row.decision === 'bid') bucket.bids += 1;
      if (row.decision === 'skip') bucket.skips += 1;
      if (row.owner_approved === true) bucket.approvals += 1;
      evalByAgent.set(id, bucket);
    }

    const creditByAgent = new Map<string, {
      topupTotal: number;
      deductionTotal: number;
      refundTotal: number;
      txCount: number;
    }>();
    for (const row of creditsRes.data ?? []) {
      const id = row.agent_id as string;
      const bucket = creditByAgent.get(id) ?? {
        topupTotal: 0,
        deductionTotal: 0,
        refundTotal: 0,
        txCount: 0,
      };
      const amount = Number(row.amount_usdc ?? 0);
      if (row.type === 'topup') bucket.topupTotal += amount;
      else if (row.type === 'deduction') bucket.deductionTotal += amount;
      else if (row.type === 'refund') bucket.refundTotal += amount;
      bucket.txCount += 1;
      creditByAgent.set(id, bucket);
    }

    // activity is already sorted desc; first hit per agent is its latest
    const activityByAgent = new Map<string, { lastAt: string; lastAction: string; total: number }>();
    for (const row of activityRes.data ?? []) {
      const id = row.agent_id as string;
      const existing = activityByAgent.get(id);
      if (existing) {
        existing.total += 1;
      } else {
        activityByAgent.set(id, {
          lastAt: row.created_at as string,
          lastAction: row.action as string,
          total: 1,
        });
      }
    }

    const hydrated = agents.map((a) => {
      const chat = chatByAgent.get(a.id);
      const ev = evalByAgent.get(a.id);
      const cr = creditByAgent.get(a.id);
      const act = activityByAgent.get(a.id);

      return {
        ...a,
        credit_balance_usdc: Number(a.credit_balance_usdc ?? 0),
        budget_ceiling_usdc: a.budget_ceiling_usdc !== null ? Number(a.budget_ceiling_usdc) : null,
        chat_messages: chat?.messages ?? 0,
        chat_user_messages: chat?.userMessages ?? 0,
        chat_sessions: chat?.sessions.size ?? 0,
        chat_tokens: chat?.tokens ?? 0,
        chat_cost_usdc: chat?.cost ?? 0,
        last_chat_at: chat?.lastChatAt ?? null,
        evaluations: ev?.evaluations ?? 0,
        bids: ev?.bids ?? 0,
        skips: ev?.skips ?? 0,
        owner_approvals: ev?.approvals ?? 0,
        credit_topup_total_usdc: cr?.topupTotal ?? 0,
        credit_deduction_total_usdc: cr?.deductionTotal ?? 0,
        credit_refund_total_usdc: cr?.refundTotal ?? 0,
        credit_tx_count: cr?.txCount ?? 0,
        last_activity_at: act?.lastAt ?? null,
        last_action: act?.lastAction ?? null,
        activity_count: act?.total ?? 0,
      };
    });

    const stats = {
      total: hydrated.length,
      basic: hydrated.filter((a) => a.tier === 'basic').length,
      pro: hydrated.filter((a) => a.tier === 'pro').length,
      linked: hydrated.filter((a) => a.erc8004_linked).length,
      pending_via: hydrated.filter((a) => !a.erc8004_linked).length,
      total_credit_balance_usdc: hydrated.reduce((s, a) => s + a.credit_balance_usdc, 0),
      total_chat_messages: hydrated.reduce((s, a) => s + a.chat_messages, 0),
    };

    return NextResponse.json({ agents: hydrated, stats });
  } catch (err) {
    console.error('[/api/rrg/admin/agents]', err);
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}
