/**
 * Back Room taste interview: one spoken (or typed) answer at a time.
 *
 * POST multipart or JSON with:
 *   handle  , the member (buyer) whose profile this is
 *   audio   , an optional recorded answer (transcribed server-side), OR
 *   answer  , the answer as text (fallback)
 *
 * Transcribes the answer, merges only what the member said into their profile,
 * saves a new version, and returns the updated profile plus the next question.
 * The member owns and can edit every field; the interview never invents taste.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { transcribe, SttError } from '@/lib/app/backroom/voice';
import { getActiveProfile, saveProfile, interviewStep, EMPTY_TASTE } from '@/lib/app/backroom/taste';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface BuyerRow {
  owner_user_id:         string;
  llm_byo_provider:      string | null;
  llm_byo_key_encrypted: string | null;
  llm_byo_model:         string | null;
}

export async function POST(req: Request) {
  const user = await getBuyerUser();
  if (!user) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let handle = '';
  let answerText = '';
  let audioBytes: ArrayBuffer | null = null;
  let audioType = 'audio/webm';

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    handle = String(form.get('handle') ?? '').trim();
    answerText = String(form.get('answer') ?? '').trim();
    const audio = form.get('audio');
    if (audio instanceof Blob && audio.size > 0) {
      audioBytes = await audio.arrayBuffer();
      audioType = audio.type || 'audio/webm';
    }
  } else {
    let body: { handle?: string; answer?: string };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
    handle = body.handle?.trim() ?? '';
    answerText = body.answer?.trim() ?? '';
  }

  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });

  const { data } = await db
    .from('app_buyers')
    .select('owner_user_id, llm_byo_provider, llm_byo_key_encrypted, llm_byo_model')
    .eq('handle', handle)
    .maybeSingle();
  const buyer = data as BuyerRow | null;
  if (!buyer || buyer.owner_user_id !== user.id) {
    return NextResponse.json({ error: 'not authorized for this member' }, { status: 403 });
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
    const current = (await getActiveProfile('via', 'buyer', handle)) ?? { id: null, version: 0, ...EMPTY_TASTE };
    return NextResponse.json({ handle, transcript: '', profile: current, next_question: 'I did not catch that. Say it again?', complete: false });
  }

  const prior = (await getActiveProfile('via', 'buyer', handle)) ?? { id: null, version: 0, ...EMPTY_TASTE };
  const step = await interviewStep(buyer, {
    references: prior.references,
    obsessions: prior.obsessions,
    aesthetic_vocab: prior.aesthetic_vocab,
    anti_references: prior.anti_references,
    voice_text: prior.voice_text,
  }, transcript);

  const saved = await saveProfile('via', 'buyer', handle, step.fields);
  return NextResponse.json({ handle, transcript, profile: saved, next_question: step.next_question, complete: step.complete });
}
