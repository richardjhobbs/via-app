/**
 * The taste matcher (roadmap Phase B): sensibility overlap between two
 * PUBLISHED taste cards, not product relevance. A second matcher, deliberately
 * separate from the intent -> product judge in lib/app/buyer-matching.ts.
 *
 * Design rules, enforced here in code rather than trusted to the model:
 *   - Judges only the published card subsets (the public tier), never the
 *     full private profile.
 *   - Cross-discipline by design: same-discipline pairs need a HIGHER score
 *     (threshold bump), because category matching is the named failure mode.
 *   - `shared` citations are filtered to entries literally present on both
 *     cards; the judge cannot invent common ground.
 *   - Scarcity lives in the cron (threshold + monthly cap), not here.
 *
 * The context pack built from a verdict is the LAST AI artifact: after the
 * introduction, no agent drafts anything.
 */
import type { TasteCard } from './taste-cards';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

export interface SensibilityVerdict {
  score:           number;    // 0-100 after code-side clamping
  same_discipline: boolean;
  shared:          string[];  // validated: present on BOTH cards
  why:             string;    // one sentence
  opening_thread:  string;    // one specific question one could ask the other
}

/** Judge threshold; +SAME_DISCIPLINE_BUMP when the judge flags same discipline. */
export function tasteMatchThreshold(): number {
  return Number(process.env.TASTE_MATCH_THRESHOLD ?? '88');
}
export const SAME_DISCIPLINE_BUMP = 7;

const JUDGE_SYSTEM = `You judge whether two people would genuinely enjoy meeting, from their declared profiles alone. You are given profile A and profile B: what each does or is building (kind, headline and work), where they are based (places), their references, obsessions, aesthetic vocabulary, and anti-references (what they reject).

Score 0-100. Reward SPECIFIC shared references and obsessions over generic vibe words, and reward a genuine professional reason to meet (complementary work, one making what the other needs, a shared city or scene). Reward complementary disciplines: a furniture maker and a label owner who love the same records beat two people with identical adjective lists. Penalise hard: two people making the same kind of thing in the same discipline with nothing else in common (and set same_discipline true); one side's loves appearing in the other's anti-references; overlap that is only mass-market defaults.

Return a JSON object with exactly these keys:
- score: number (0-100)
- same_discipline: boolean
- shared: string[] (entries that appear in BOTH profiles, copied exactly; never invent)
- why: string (one sentence on why these two, in plain words)
- opening_thread: string (one specific question one could ask the other, grounded in the shared entries)

Only JSON. No prose outside it.`;

function cardSide(card: TasteCard): Record<string, unknown> {
  return {
    kind: card.member_type,
    headline: card.headline || null,
    work: card.work,
    places: card.places,
    references: card.references,
    obsessions: card.obsessions,
    aesthetic_vocab: card.vocab,
    anti_references: card.anti_references,
  };
}

function allEntries(card: TasteCard): Set<string> {
  return new Set(
    [...card.references, ...card.obsessions, ...card.vocab, ...card.anti_references, ...card.places, ...card.work]
      .map((s) => s.trim().toLowerCase()),
  );
}

/**
 * One judge call for one pair of published cards. Returns null when the judge
 * is unavailable or answers garbage; the cron records nothing and the pair is
 * retried on a later run. No deterministic fallback on purpose: a fabricated
 * sensibility score would propose introductions between strangers.
 */
export async function judgeSensibility(a: TasteCard, b: TasteCard): Promise<SensibilityVerdict | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: JUDGE_SYSTEM },
          { role: 'user', content: `Profile A:\n${JSON.stringify(cardSide(a))}\n\nProfile B:\n${JSON.stringify(cardSide(b))}` },
        ],
      }),
    });
    if (!res.ok) {
      console.warn(`[taste-match] judge ${res.status}`);
      return null;
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const p = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as Record<string, unknown>;

    const score = typeof p.score === 'number' && isFinite(p.score) ? Math.max(0, Math.min(100, Math.round(p.score))) : 0;
    const aEntries = allEntries(a);
    const bEntries = allEntries(b);
    const shared = (Array.isArray(p.shared) ? p.shared : [])
      .map((s) => String(s).trim())
      .filter((s) => s && aEntries.has(s.toLowerCase()) && bEntries.has(s.toLowerCase()))
      .slice(0, 8);

    return {
      score,
      same_discipline: p.same_discipline === true,
      shared,
      why: typeof p.why === 'string' ? p.why.slice(0, 300) : '',
      opening_thread: typeof p.opening_thread === 'string' ? p.opening_thread.slice(0, 300) : '',
    };
  } catch (e) {
    console.warn('[taste-match] judge failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Does this verdict clear the bar? The same-discipline penalty is applied
 *  here, in code, so the model cannot wave it through. */
export function clearsThreshold(verdict: SensibilityVerdict): boolean {
  const bar = tasteMatchThreshold() + (verdict.same_discipline ? SAME_DISCIPLINE_BUMP : 0);
  return verdict.score >= bar && verdict.shared.length > 0;
}

/**
 * The context pack both humans see at the Door. Symmetric on purpose: one
 * introduction row carries one pack, and the Door already links each side to
 * the OTHER side's published card for the "who they are". THE LAST AI
 * ARTIFACT: nothing past the introduction is drafted by any agent.
 */
export function contextPackFromVerdict(verdict: SensibilityVerdict): Record<string, unknown> {
  return {
    why: verdict.why || 'Your declared tastes overlap where it matters',
    shared_references: verdict.shared,
    opening_thread: verdict.opening_thread,
    source: 'taste-matcher',
  };
}
