/**
 * The taste matcher cron (weekly; schedule in vercel.json).
 *
 * Corpus: every published card with matching enabled, all four member kinds,
 * read locally. Each unjudged pair gets ONE sensibility judge call ever
 * (app_taste_matches records every outcome, so pairs never re-judge). A pair
 * above the threshold becomes an introduction ONLY under the scarcity rules:
 *
 *   - threshold TASTE_MATCH_THRESHOLD (default 88), +7 when same-discipline
 *   - at most TASTE_MATCH_JUDGE_CAP pairs judged per run (default 40)
 *   - a member receives at most TASTE_MATCH_MONTHLY_CAP matcher-originated
 *     proposals per rolling 30 days (default 2)
 *
 * A match surfaces to both members ONLY as a knock at their Door. No feed, no
 * scores shown, no metrics anywhere. Secured per Vercel's cron contract
 * (Authorization: Bearer CRON_SECRET).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { listMatchableCards, type TasteCard } from '@/lib/app/backroom/taste-cards';
import { judgeSensibility, clearsThreshold, contextPackFromVerdict, type SensibilityVerdict } from '@/lib/app/backroom/taste-match';
import { proposeIntroduction, type Party } from '@/lib/app/backroom/introductions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function judgeCap(): number { return Number(process.env.TASTE_MATCH_JUDGE_CAP ?? '40'); }
function monthlyCap(): number { return Number(process.env.TASTE_MATCH_MONTHLY_CAP ?? '2'); }

function memberKey(platform: string, type: string, ref: string): string {
  return `${platform}/${type}/${ref}`;
}
function pairKey(a: TasteCard, b: TasteCard): string {
  const ka = memberKey(a.member_platform, a.member_type, a.member_ref);
  const kb = memberKey(b.member_platform, b.member_type, b.member_ref);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}
function party(c: TasteCard): Party {
  return { member_platform: c.member_platform, member_type: c.member_type, member_ref: c.member_ref };
}

/** Pairs already settled: every judged pair + every introduction (any state). */
async function loadSettledPairs(): Promise<Set<string>> {
  const settled = new Set<string>();
  const keyOf = (p1: string, t1: string, r1: string, p2: string, t2: string, r2: string) => {
    const ka = memberKey(p1, t1, r1);
    const kb = memberKey(p2, t2, r2);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };

  const { data: judged } = await db
    .from('app_taste_matches')
    .select('a_platform, a_type, a_ref, b_platform, b_type, b_ref');
  for (const r of (judged as Record<string, string>[]) ?? []) {
    settled.add(keyOf(r.a_platform, r.a_type, r.a_ref, r.b_platform, r.b_type, r.b_ref));
  }

  const { data: intros } = await db
    .from('app_introductions')
    .select('a_platform, a_type, a_ref, b_platform, b_type, b_ref');
  for (const r of (intros as Record<string, string>[]) ?? []) {
    settled.add(keyOf(r.a_platform, r.a_type, r.a_ref, r.b_platform, r.b_type, r.b_ref));
  }
  return settled;
}

/** Matcher-originated proposals a member received in the rolling window. */
async function proposalsThisMonth(c: TasteCard): Promise<number> {
  const since = new Date(Date.now() - MONTH_MS).toISOString();
  const sideA = `and(a_platform.eq.${c.member_platform},a_type.eq.${c.member_type},a_ref.eq.${c.member_ref})`;
  const sideB = `and(b_platform.eq.${c.member_platform},b_type.eq.${c.member_type},b_ref.eq.${c.member_ref})`;
  const { count } = await db
    .from('app_taste_matches')
    .select('id', { count: 'exact', head: true })
    .eq('outcome', 'proposed')
    .gte('created_at', since)
    .or(`${sideA},${sideB}`);
  return count ?? 0;
}

async function recordMatch(
  a: TasteCard, b: TasteCard, verdict: SensibilityVerdict,
  outcome: 'below_threshold' | 'rate_limited' | 'proposed' | 'duplicate',
  introId?: string,
): Promise<void> {
  await db.from('app_taste_matches').insert({
    a_platform: a.member_platform, a_type: a.member_type, a_ref: a.member_ref,
    b_platform: b.member_platform, b_type: b.member_type, b_ref: b.member_ref,
    score: verdict.score,
    shared: verdict.shared,
    verdict: verdict as unknown as Record<string, unknown>,
    outcome,
    intro_id: introId ?? null,
  });
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const cards = await listMatchableCards();
  if (cards.length < 2) return NextResponse.json({ ok: true, cards: cards.length, judged: 0 });

  const settled = await loadSettledPairs();
  const cap = judgeCap();
  const summary = { judged: 0, proposed: 0, below_threshold: 0, rate_limited: 0, duplicate: 0, judge_unavailable: 0 };
  // A member proposed to in THIS run counts against the cap immediately.
  const proposedThisRun = new Map<string, number>();

  outer:
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (summary.judged >= cap) break outer;
      const a = cards[i];
      const b = cards[j];
      const key = pairKey(a, b);
      if (settled.has(key)) continue;

      const verdict = await judgeSensibility(a, b);
      if (!verdict) { summary.judge_unavailable++; continue; }
      summary.judged++;
      settled.add(key);

      if (!clearsThreshold(verdict)) {
        await recordMatch(a, b, verdict, 'below_threshold');
        summary.below_threshold++;
        continue;
      }

      const capLimit = monthlyCap();
      const keyA = memberKey(a.member_platform, a.member_type, a.member_ref);
      const keyB = memberKey(b.member_platform, b.member_type, b.member_ref);
      const aCount = (await proposalsThisMonth(a)) + (proposedThisRun.get(keyA) ?? 0);
      const bCount = (await proposalsThisMonth(b)) + (proposedThisRun.get(keyB) ?? 0);
      if (aCount >= capLimit || bCount >= capLimit) {
        await recordMatch(a, b, verdict, 'rate_limited');
        summary.rate_limited++;
        continue;
      }

      const result = await proposeIntroduction(party(a), party(b), contextPackFromVerdict(verdict));
      if (result.outcome === 'exists') {
        await recordMatch(a, b, verdict, 'duplicate', result.id);
        summary.duplicate++;
      } else {
        await recordMatch(a, b, verdict, 'proposed', result.id);
        summary.proposed++;
        proposedThisRun.set(keyA, (proposedThisRun.get(keyA) ?? 0) + 1);
        proposedThisRun.set(keyB, (proposedThisRun.get(keyB) ?? 0) + 1);
      }
    }
  }

  return NextResponse.json({ ok: true, cards: cards.length, ...summary });
}
