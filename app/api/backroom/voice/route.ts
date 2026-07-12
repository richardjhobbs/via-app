/**
 * Back Room voice endpoint (milestone-1 spike).
 *
 * Accepts a captured utterance (audio bytes), transcribes it server-side,
 * and resolves it through the member's agent into one room tool call. Returns
 * the transcript, the resolved action, and end-to-end latency so we can log
 * real numbers against the sub-2s release-to-action target.
 *
 * POST body: multipart/form-data with:
 *   audio  - the recorded blob (audio/webm, audio/mp4, ...)
 *   member - optional buyer handle whose agent resolves the utterance
 */
import { transcribe, SttError } from '@/lib/app/backroom/voice';
import { resolveUtterance } from '@/lib/app/backroom/resolve';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface MemberLlm {
  llm_byo_provider:      string | null;
  llm_byo_key_encrypted: string | null;
  llm_byo_model:         string | null;
}

async function loadMemberLlm(handle: string): Promise<MemberLlm | undefined> {
  const { data } = await db
    .from('app_buyers')
    .select('llm_byo_provider, llm_byo_key_encrypted, llm_byo_model')
    .eq('handle', handle)
    .maybeSingle();
  return (data as MemberLlm) ?? undefined;
}

export async function POST(req: Request) {
  const started = Date.now();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'expected multipart/form-data with an audio field' }, { status: 400 });
  }

  const audio = form.get('audio');
  if (!(audio instanceof Blob)) {
    return Response.json({ error: 'missing audio blob' }, { status: 400 });
  }
  if (audio.size === 0) {
    return Response.json({ error: 'empty audio' }, { status: 400 });
  }

  const memberHandle = typeof form.get('member') === 'string' ? String(form.get('member')).trim() : '';
  const bytes = await audio.arrayBuffer();

  try {
    const stt = await transcribe(bytes, audio.type || 'audio/webm');
    if (!stt.text) {
      return Response.json({
        transcript: '',
        action: null,
        stt: { provider: stt.provider, model: stt.model, latency_ms: stt.latencyMs },
        total_ms: Date.now() - started,
        note: 'no speech detected',
      });
    }

    const member = memberHandle ? await loadMemberLlm(memberHandle) : undefined;
    const resolveStart = Date.now();
    const action = await resolveUtterance(stt.text, member);
    const resolveMs = Date.now() - resolveStart;

    return Response.json({
      transcript: stt.text,
      action,
      stt: { provider: stt.provider, model: stt.model, latency_ms: stt.latencyMs },
      resolve_ms: resolveMs,
      total_ms: Date.now() - started,
    });
  } catch (err) {
    if (err instanceof SttError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error('[backroom/voice] failed:', err);
    return Response.json({ error: 'voice pipeline failed' }, { status: 500 });
  }
}
