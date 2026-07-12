/**
 * Back Room taste profiles (roadmap Phase A).
 *
 * The member's agent has to genuinely know its principal. A profile is the
 * member's declared taste: references, obsessions, aesthetic vocabulary, the
 * things they are NOT, and free-text voice. Structured, human-owned, agent-read.
 * Taste is declared, never inferred and imposed: the interview only ever writes
 * back what the member said, and the member can edit every field in plain text.
 *
 * Profiles are versioned. Saving writes a new active version and retires the
 * previous one, so history is kept and exactly one active profile exists per
 * member (enforced by a partial unique index).
 */
import { db } from '../db';
import { resolveBuyerLlm } from '../buyer-llm';

export type MemberPlatform = 'via' | 'rrg';
export type MemberType = 'buyer' | 'seller';

export interface TasteFields {
  references:      string[];
  obsessions:      string[];
  aesthetic_vocab: string[];
  anti_references: string[];
  voice_text:      string;
}

export interface TasteProfile extends TasteFields {
  id:      string;
  version: number;
}

const EMPTY: TasteFields = { references: [], obsessions: [], aesthetic_vocab: [], anti_references: [], voice_text: '' };

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
}

export async function getActiveProfile(platform: MemberPlatform, memberType: MemberType, memberRef: string): Promise<TasteProfile | null> {
  const { data } = await db
    .from('app_taste_profiles')
    .select('id, version, "references", obsessions, aesthetic_vocab, anti_references, voice_text')
    .eq('member_platform', platform)
    .eq('member_type', memberType)
    .eq('member_ref', memberRef)
    .eq('is_active', true)
    .maybeSingle();
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return {
    id: String(d.id),
    version: Number(d.version),
    references: asStringArray(d.references),
    obsessions: asStringArray(d.obsessions),
    aesthetic_vocab: asStringArray(d.aesthetic_vocab),
    anti_references: asStringArray(d.anti_references),
    voice_text: String(d.voice_text ?? ''),
  };
}

/** Write a new active version, retiring the previous active row. */
export async function saveProfile(platform: MemberPlatform, memberType: MemberType, memberRef: string, fields: TasteFields): Promise<TasteProfile> {
  const { data: prior } = await db
    .from('app_taste_profiles')
    .select('version')
    .eq('member_platform', platform)
    .eq('member_type', memberType)
    .eq('member_ref', memberRef)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((prior as { version: number } | null)?.version ?? 0) + 1;

  // Retire the current active row first so the partial unique index holds.
  await db
    .from('app_taste_profiles')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('member_platform', platform)
    .eq('member_type', memberType)
    .eq('member_ref', memberRef)
    .eq('is_active', true);

  const { data, error } = await db
    .from('app_taste_profiles')
    .insert({
      member_platform: platform,
      member_type: memberType,
      member_ref: memberRef,
      version: nextVersion,
      is_active: true,
      references: asStringArray(fields.references),
      obsessions: asStringArray(fields.obsessions),
      aesthetic_vocab: asStringArray(fields.aesthetic_vocab),
      anti_references: asStringArray(fields.anti_references),
      voice_text: (fields.voice_text ?? '').slice(0, 4000),
    })
    .select('id, version')
    .single();
  if (error) throw error;
  return { id: String((data as { id: string }).id), version: nextVersion, ...normalise(fields) };
}

function normalise(f: TasteFields): TasteFields {
  return {
    references: asStringArray(f.references),
    obsessions: asStringArray(f.obsessions),
    aesthetic_vocab: asStringArray(f.aesthetic_vocab),
    anti_references: asStringArray(f.anti_references),
    voice_text: (f.voice_text ?? '').slice(0, 4000),
  };
}

export interface InterviewStep {
  fields:        TasteFields;   // the merged profile after this answer
  next_question: string;        // what VIA asks next, one line
  complete:      boolean;       // the member has covered enough to stop
}

interface MemberLlmFields {
  llm_byo_provider?:      string | null;
  llm_byo_key_encrypted?: string | null;
  llm_byo_model?:         string | null;
}

const INTERVIEW_SYSTEM = `You are conducting a warm, spoken taste interview for a member of a private room. It is a conversation, not a form. You are collecting the member's DECLARED taste so their VIA can genuinely know them.

You are given the profile so far and the member's latest answer. Merge only what the member actually said into the structured fields. Never invent taste the member did not state. Keep existing entries unless the member changes them.

Return a JSON object with exactly these keys:
- references: string[]  (records, films, designers, eras, places they love)
- obsessions: string[]  (what they keep returning to)
- aesthetic_vocab: string[]  (words for how things should feel)
- anti_references: string[]  (what they are NOT, what they reject)
- voice_text: string  (a short paragraph in the member's own words, updated)
- next_question: string  (one short, specific question to ask next; British English; no em dashes)
- complete: boolean  (true once references, obsessions, aesthetic and anti-references each have a few entries)

Only JSON. No prose outside it.`;

export async function interviewStep(
  member: MemberLlmFields,
  prior: TasteFields,
  answer: string,
): Promise<InterviewStep> {
  const llm = resolveBuyerLlm(member ?? {});
  const fallbackQ = 'What are three things you keep coming back to, in any medium?';
  if (!llm.apiKey) {
    return { fields: normalise(prior), next_question: fallbackQ, complete: false };
  }

  const res = await fetch(`${llm.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: 'system', content: INTERVIEW_SYSTEM },
        { role: 'user', content: `Profile so far:\n${JSON.stringify(prior)}\n\nMember's latest answer:\n${answer}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 800,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[taste/interview] LLM ${res.status}: ${body.slice(0, 160)}`);
    return { fields: normalise(prior), next_question: fallbackQ, complete: false };
  }
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as Record<string, unknown>; }
  catch { parsed = {}; }

  const fields = normalise({
    references: asStringArray(parsed.references ?? prior.references),
    obsessions: asStringArray(parsed.obsessions ?? prior.obsessions),
    aesthetic_vocab: asStringArray(parsed.aesthetic_vocab ?? prior.aesthetic_vocab),
    anti_references: asStringArray(parsed.anti_references ?? prior.anti_references),
    voice_text: typeof parsed.voice_text === 'string' ? parsed.voice_text : prior.voice_text,
  });
  return {
    fields,
    next_question: typeof parsed.next_question === 'string' && parsed.next_question.trim() ? parsed.next_question.trim() : fallbackQ,
    complete: parsed.complete === true,
  };
}

export const EMPTY_TASTE = EMPTY;
