/**
 * Back Room taste interview: one spoken (or typed) answer at a time.
 *
 * POST multipart or JSON with:
 *   ref     , the member whose profile this is (buyer handle, seller slug, or
 *             federated brand slug; `handle` accepted as an alias)
 *   audio   , an optional recorded answer (transcribed server-side), OR
 *   answer  , the answer as text (fallback)
 *
 * Transcribes the answer, merges only what the member said into their profile,
 * saves a new version, and returns the updated profile plus the next question.
 * The member owns and can edit every field; the interview never invents taste.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { resolveOwnedMember } from '@/lib/app/backroom/ui-auth';
import { transcribe, SttError } from '@/lib/app/backroom/voice';
import { getActiveProfile, saveProfile, interviewStep, EMPTY_TASTE } from '@/lib/app/backroom/taste';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface BuyerLlmRow {
  llm_byo_provider:      string | null;
  llm_byo_key_encrypted: string | null;
  llm_byo_model:         string | null;
}

export async function POST(req: Request) {
  let ref = '';
  let answerText = '';
  let audioBytes: ArrayBuffer | null = null;
  let audioType = 'audio/webm';

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    ref = String(form.get('ref') ?? form.get('handle') ?? '').trim();
    answerText = String(form.get('answer') ?? '').trim();
    const audio = form.get('audio');
    if (audio instanceof Blob && audio.size > 0) {
      audioBytes = await audio.arrayBuffer();
      audioType = audio.type || 'audio/webm';
    }
  } else {
    let body: { ref?: string; handle?: string; answer?: string };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
    ref = (body.ref ?? body.handle)?.trim() ?? '';
    answerText = body.answer?.trim() ?? '';
  }

  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
  const auth = await resolveOwnedMember(ref);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const m = auth.member;

  // Only VIA buyers carry a BYO LLM config; every other kind interviews on the
  // platform key (resolveBuyerLlm falls back when the fields are absent).
  let llmFields: BuyerLlmRow = { llm_byo_provider: null, llm_byo_key_encrypted: null, llm_byo_model: null };
  if (m.member_platform === 'via' && m.member_type === 'buyer') {
    const { data } = await db
      .from('app_buyers')
      .select('llm_byo_provider, llm_byo_key_encrypted, llm_byo_model')
      .eq('handle', m.member_ref)
      .maybeSingle();
    if (data) llmFields = data as BuyerLlmRow;
  }

  let transcript = answerText;
  try {
    if (audioBytes) {
      const stt = await transcribe(audioBytes, audioType);
      transcript = stt.text;
    }
  } catch (err) {
    if (err instanceof SttError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[taste/interview] transcription failed:', err);
    return NextResponse.json({ error: 'could not transcribe the answer' }, { status: 500 });
  }

  if (!transcript) {
    const current = (await getActiveProfile(m.member_platform, m.member_type, m.member_ref)) ?? { id: null, version: 0, ...EMPTY_TASTE };
    return NextResponse.json({ ref, handle: ref, transcript: '', profile: current, next_question: 'I did not catch that. Say it again?', complete: false });
  }

  const prior = (await getActiveProfile(m.member_platform, m.member_type, m.member_ref)) ?? { id: null, version: 0, ...EMPTY_TASTE };
  const step = await interviewStep(llmFields, {
    references: prior.references,
    obsessions: prior.obsessions,
    aesthetic_vocab: prior.aesthetic_vocab,
    anti_references: prior.anti_references,
    places: prior.places,
    work: prior.work,
    voice_text: prior.voice_text,
  }, transcript);

  const saved = await saveProfile(m.member_platform, m.member_type, m.member_ref, step.fields);
  return NextResponse.json({ ref, handle: ref, transcript, profile: saved, next_question: step.next_question, complete: step.complete });
}
