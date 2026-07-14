/**
 * Draft a taste profile from an RRG brand's own story (roadmap Phase A, path 3).
 *
 * POST { ref } , brand session only: the federated rrg/seller drafts for
 * itself, nobody drafts for anyone else. Pulls the brand identity and a small
 * product sample over the existing HTTP federation (never RRG's database),
 * asks DeepSeek to sketch TasteFields from that corpus, and stores the result
 * as a DRAFT (is_draft=true, never active). Nothing an agent drafted goes live
 * until the human edits and saves it, which promotes and deletes the draft.
 */
import { NextResponse } from 'next/server';
import { getBrandSession } from '@/lib/app/backroom/brand-session';
import { resolveRrgBrand } from '@/lib/app/backroom/rrg-federation';
import { saveDraftProfile, type TasteFields } from '@/lib/app/backroom/taste';
import { resolveBuyerLlm } from '@/lib/app/buyer-llm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RRG_BASE = (process.env.RRG_BASE_URL || 'https://realrealgenuine.com').replace(/\/$/, '');

interface RrgSearchResult { name?: string; detail?: string; kind?: string; }

async function brandProductSample(slug: string): Promise<string[]> {
  try {
    const res = await fetch(`${RRG_BASE}/api/via/search?seller=${encodeURIComponent(slug)}&limit=12`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const j = await res.json() as { results?: RrgSearchResult[] };
    return (j.results ?? [])
      .map((r) => [r.name, r.detail].filter(Boolean).join(': ').slice(0, 200))
      .filter(Boolean)
      .slice(0, 12);
  } catch {
    return [];
  }
}

const SEED_SYSTEM = `You are drafting a FIRST-PERSON taste profile for a fashion or culture brand, from its own story and a sample of what it sells. This is a starting point the brand's human will edit; write nothing you cannot ground in the material given. Prefer specific references (eras, scenes, cities, materials, records, films) over adjectives. Include anti-references only when the material clearly implies what the brand rejects.

Return a JSON object with exactly these keys:
- references: string[]  (up to 10: eras, scenes, places, records, films, designers the material points to)
- obsessions: string[]  (up to 6: what the brand keeps returning to)
- aesthetic_vocab: string[]  (up to 8: words for how their things should feel)
- anti_references: string[]  (up to 5: what the material implies they reject; empty if unclear)
- voice_text: string  (2 or 3 sentences in the brand's voice, first person plural)

Only JSON. No prose outside it.`;

export async function POST(req: Request) {
  const brand = await getBrandSession();
  if (!brand) return NextResponse.json({ error: 'brand session required' }, { status: 401 });

  let body: { ref?: string } = {};
  try { body = await req.json(); } catch { /* ref defaults to the session brand */ }
  const ref = (body.ref ?? brand.slug).trim();
  if (ref !== brand.slug) return NextResponse.json({ error: 'a brand can only draft for itself' }, { status: 403 });

  const identity = await resolveRrgBrand(ref);
  const products = await brandProductSample(ref);
  const corpus = [
    `Brand: ${identity?.name ?? brand.name ?? ref}`,
    products.length ? `What they sell (sample):\n${products.map((p) => `- ${p}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const llm = resolveBuyerLlm({});
  if (!llm.apiKey) return NextResponse.json({ error: 'no platform LLM configured' }, { status: 503 });

  const res = await fetch(`${llm.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: 'system', content: SEED_SYSTEM },
        { role: 'user', content: corpus },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 700,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn(`[taste/seed-brand] LLM ${res.status}: ${detail.slice(0, 160)}`);
    return NextResponse.json({ error: 'could not draft from the brand story' }, { status: 502 });
  }
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as Record<string, unknown>; }
  catch { parsed = {}; }

  const toArr = (v: unknown, cap: number) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, cap) : [];
  const fields: TasteFields = {
    references: toArr(parsed.references, 10),
    obsessions: toArr(parsed.obsessions, 6),
    aesthetic_vocab: toArr(parsed.aesthetic_vocab, 8),
    anti_references: toArr(parsed.anti_references, 5),
    voice_text: typeof parsed.voice_text === 'string' ? parsed.voice_text.slice(0, 4000) : '',
  };
  const hasContent = fields.references.length || fields.obsessions.length || fields.aesthetic_vocab.length;
  if (!hasContent) return NextResponse.json({ error: 'the brand story gave nothing to draft from' }, { status: 422 });

  await saveDraftProfile('rrg', 'seller', ref, fields);
  return NextResponse.json({ ref, draft: true, fields });
}
