/**
 * In-room co-creation suggestion (a deliberate, scoped carve-out to the
 * no-AI-past-introduction invariant).
 *
 * A member EXPLICITLY asks a matched agent for one idea of something to make
 * and sell together. The suggestion is generated in that agent's voice from its
 * published taste card, ATTRIBUTED to it, and returned as an ephemeral proposal.
 * It is NEVER posted to the room on its own initiative: the human must accept it
 * before it lands on the table (as an attributed note). Everything else in the
 * room stays human-authored.
 */
import { getCardForMember } from './taste-cards';
import { resolveBuyerLlm } from '../buyer-llm';
import type { Author } from './rooms';

export interface CollabSuggestion {
  from:               string;   // the agent the idea is attributed to
  title:              string;
  pitch:              string;   // one line
  format:             string;   // e.g. "PDF zine", "audio + liner notes"
  suggested_price_usd: number;
}

/** Remove em/en dashes from model output (house style: none in user-facing copy). */
function noDashes(s: string): string {
  return s.replace(/[—–]/g, ', ').replace(/\s+,/g, ',').trim();
}

const SYSTEM = `You are a member of a private room on VIA, suggesting ONE specific DIGITAL thing you could make together with another member and sell. You are given your own declared taste and theirs. Ground the idea in what you actually share. It must be digital (a PDF, a zine, an audio piece, a mix, a template, a small guide), deliverable as a file. Keep it small and real, something two people could actually make.

Return a JSON object with exactly these keys:
- title: string (a short, specific name)
- pitch: string (one sentence on what it is and why it fits you both)
- format: string (the digital format it ships as)
- suggested_price_usd: number (a fair small price, 2 to 20)

British English. No em dashes. Only JSON.`;

function persona(card: Awaited<ReturnType<typeof getCardForMember>>, fallbackRef: string): string {
  if (!card) return fallbackRef;
  const parts = [
    `Name: ${card.display_name || fallbackRef}`,
    card.headline ? `In their words: ${card.headline}` : '',
    card.work.length ? `Work: ${card.work.join(', ')}` : '',
    card.references.length ? `References: ${card.references.join(', ')}` : '',
    card.obsessions.length ? `Obsessions: ${card.obsessions.join(', ')}` : '',
    card.vocab.length ? `Aesthetic: ${card.vocab.join(', ')}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

/**
 * Generate one attributed collaboration suggestion from `from` to `to`. Uses the
 * platform LLM (federated agents have no BYO key in via-app). Returns null if the
 * model is unavailable or answers unusably.
 */
export async function suggestCollab(from: Author, to: Author, prompt?: string): Promise<CollabSuggestion | null> {
  const [fromCard, toCard] = await Promise.all([
    getCardForMember(from.member_platform, from.member_type, from.member_ref),
    getCardForMember(to.member_platform, to.member_type, to.member_ref),
  ]);
  const fromName = fromCard?.display_name || from.member_ref;

  const llm = resolveBuyerLlm({});
  if (!llm.apiKey) return null;

  const user = [
    `You are ${fromName}.`,
    `Your taste:\n${persona(fromCard, from.member_ref)}`,
    `\nThe other member:\n${persona(toCard, to.member_ref)}`,
    prompt ? `\nThey asked: ${prompt.slice(0, 400)}` : '',
  ].join('\n');

  try {
    const res = await fetch(`${llm.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify({
        model: llm.model,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 300,
      }),
    });
    if (!res.ok) { console.warn(`[suggest] LLM ${res.status}`); return null; }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const p = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as Record<string, unknown>;
    const title = typeof p.title === 'string' ? noDashes(p.title).slice(0, 120) : '';
    const pitch = typeof p.pitch === 'string' ? noDashes(p.pitch).slice(0, 300) : '';
    const format = typeof p.format === 'string' ? noDashes(p.format).slice(0, 80) : 'digital file';
    const price = typeof p.suggested_price_usd === 'number' && isFinite(p.suggested_price_usd)
      ? Math.max(1, Math.min(50, Math.round(p.suggested_price_usd * 100) / 100)) : 4;
    if (!title || !pitch) return null;
    return { from: fromName, title, pitch, format, suggested_price_usd: price };
  } catch (e) {
    console.warn('[suggest] failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** The one-line, attributed form placed on the table when the human accepts. */
export function suggestionNote(s: CollabSuggestion): string {
  return `${s.from} suggested: "${s.title}" , ${s.pitch} (${s.format}, about ${s.suggested_price_usd} USDC).`;
}
