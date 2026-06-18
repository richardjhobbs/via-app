/**
 * POST /api/via/match  { q: string }
 *
 * Inbound structured-intent endpoint (submit_intent): an external agent submits
 * a free-text brief and gets back the matched, fully-defined products , the SAME
 * agentic pipeline the buyer sourcing loop uses (extract intent -> recall across
 * the whole network -> AI judge), with NO persistence. Also the surface the eval
 * battery runs against.
 *
 * Public + LLM-backed, so rate-limited per warm instance by client IP.
 */
import { NextRequest, NextResponse } from 'next/server';
import { dryRunMatch } from '@/lib/app/buyer-matching';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'noip').split(',')[0].trim();
  if (rateLimited(ip)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  let body: { q?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const q = String(body.q ?? '').trim();
  if (q.length < 2 || q.length > 2000) {
    return NextResponse.json({ error: 'q must be 2 to 2000 characters' }, { status: 400 });
  }

  const { intent, results } = await dryRunMatch(q);
  return NextResponse.json({ query: q, intent, count: results.length, results });
}
