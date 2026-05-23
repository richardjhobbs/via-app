/**
 * POST /api/rrg/admin/credits/settle
 *
 * Settlement cron entry point. Iterates over pro agents and pulls the
 * accumulated post-margin LLM cost back from each agent's on-chain
 * USDC wallet into the platform wallet, capped at:
 *   - per agent: weekly_cap_usdc minus already-settled this window
 *   - per agent: live on-chain USDC balance
 *   - per agent: on-chain allowance the agent has granted the platform
 *
 * Skips agents that have not run the one-time approve(). Skips amounts
 * below SETTLE_MIN_USDC to avoid wasting gas on dust.
 *
 * Auth: x-cron-secret (CRON_SECRET env) or x-admin-secret (ADMIN_SECRET)
 * or admin cookie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/rrg/auth';
import { db } from '@/lib/rrg/db';
import {
  PLATFORM_WALLET,
  getUsdcAllowance,
  getUsdcBalance,
  transferUsdcFromAgent,
} from '@/lib/agent/contract';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SETTLE_MIN_USDC = 0.10; // skip amounts below this to keep gas/USDC ratio sane
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function checkAuth(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header =
      req.headers.get('x-cron-secret') ||
      req.headers.get('authorization')?.replace('Bearer ', '');
    if (header === cronSecret) return true;
  }
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = req.headers.get('x-admin-secret');
  if (adminSecret && adminHeader === adminSecret) return true;
  return isAdminFromCookies();
}

interface AgentRow {
  id: string;
  name: string | null;
  wallet_address: string;
  weekly_cap_usdc: number | string | null;
  weekly_window_start: string | null;
  weekly_spent_usdc: number | string | null;
  approval_spender: string | null;
  settled_total_usdc: number | string | null;
}

interface SettleOutcome {
  agent_id: string;
  name: string | null;
  status:
    | 'settled'
    | 'skipped_no_approval'
    | 'skipped_no_spend'
    | 'skipped_below_threshold'
    | 'skipped_no_allowance'
    | 'skipped_no_balance'
    | 'error';
  owed?: number;
  paid?: number;
  tx_hash?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const outcomes: SettleOutcome[] = [];

  const { data: agents, error: listErr } = await db
    .from('agent_agents')
    .select(
      'id, name, wallet_address, weekly_cap_usdc, weekly_window_start, weekly_spent_usdc, approval_spender, settled_total_usdc',
    )
    .eq('tier', 'pro')
    .eq('status', 'active');

  if (listErr || !agents) {
    return NextResponse.json({ error: `list failed: ${listErr?.message ?? 'no rows'}` }, { status: 500 });
  }

  for (const a of agents as AgentRow[]) {
    const name = a.name;
    const out: SettleOutcome = { agent_id: a.id, name, status: 'skipped_no_spend' };

    try {
      // Compute settled-this-window from the ledger so we don't double-
      // pull in the same 7-day period.
      const windowStartIso = a.weekly_window_start ?? null;
      const windowExpired =
        !!windowStartIso &&
        Date.now() - new Date(windowStartIso).getTime() >= WEEKLY_WINDOW_MS;
      const weeklySpent = windowExpired ? 0 : Number(a.weekly_spent_usdc ?? 0);
      const weeklyCap = Number(a.weekly_cap_usdc ?? 1.0);

      let settledThisWindow = 0;
      if (windowStartIso && !windowExpired) {
        const { data: prior } = await db
          .from('agent_credit_transactions')
          .select('amount_usdc')
          .eq('agent_id', a.id)
          .eq('type', 'settlement')
          .gte('created_at', windowStartIso);
        for (const r of prior ?? []) {
          settledThisWindow += Math.abs(Number(r.amount_usdc ?? 0));
        }
      }

      const owed = Math.max(0, weeklySpent - settledThisWindow);
      out.owed = owed;
      if (owed <= 0) {
        out.status = 'skipped_no_spend';
        outcomes.push(out);
        continue;
      }

      // Enforce weekly cap on settlement amount.
      const capRoom = Math.max(0, weeklyCap - settledThisWindow);
      const recoverable = Math.min(owed, capRoom);

      if (!a.approval_spender) {
        out.status = 'skipped_no_approval';
        outcomes.push(out);
        continue;
      }

      const allowance = await getUsdcAllowance(a.wallet_address, a.approval_spender);
      if (allowance < SETTLE_MIN_USDC) {
        out.status = 'skipped_no_allowance';
        outcomes.push(out);
        continue;
      }
      const onChainBalance = await getUsdcBalance(a.wallet_address);
      if (onChainBalance < SETTLE_MIN_USDC) {
        out.status = 'skipped_no_balance';
        outcomes.push(out);
        continue;
      }

      const finalAmount = Math.min(recoverable, allowance, onChainBalance);
      if (finalAmount < SETTLE_MIN_USDC) {
        out.status = 'skipped_below_threshold';
        outcomes.push(out);
        continue;
      }

      const txHash = await transferUsdcFromAgent(
        a.wallet_address,
        PLATFORM_WALLET,
        finalAmount,
      );

      const newSettledTotal = Number(a.settled_total_usdc ?? 0) + finalAmount;
      await db
        .from('agent_agents')
        .update({ settled_total_usdc: newSettledTotal })
        .eq('id', a.id);

      await db.from('agent_credit_transactions').insert({
        agent_id: a.id,
        type: 'settlement',
        amount_usdc: -finalAmount, // negative = leaving the agent
        balance_after: null,
        description: `Settlement to platform (${PLATFORM_WALLET}): $${finalAmount.toFixed(6)} USDC`,
        tx_hash: txHash,
      });

      await db.from('agent_activity_log').insert({
        agent_id: a.id,
        action: 'credit_settlement',
        details: {
          amount_usdc: finalAmount,
          recipient: PLATFORM_WALLET,
          weekly_cap_usdc: weeklyCap,
          settled_this_window_after: settledThisWindow + finalAmount,
        },
        tx_hash: txHash,
      });

      out.status = 'settled';
      out.paid = finalAmount;
      out.tx_hash = txHash;
    } catch (err) {
      out.status = 'error';
      out.error = (err as Error).message;
    }

    outcomes.push(out);
  }

  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - started,
    platform_wallet: PLATFORM_WALLET,
    agents_processed: outcomes.length,
    settled_count: outcomes.filter(o => o.status === 'settled').length,
    settled_total_usdc: outcomes.reduce((s, o) => s + (o.paid ?? 0), 0),
    outcomes,
  });
}
