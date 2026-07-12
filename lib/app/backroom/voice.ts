/**
 * Back Room server-side speech to text.
 *
 * Milestone-1 spike: a thin provider interface so we can trial more than one
 * transcriber and keep the winner behind one call site. On-device browser
 * speech APIs are NOT the primary path (Safari reliability); capture happens
 * on the phone, bytes are POSTed here, transcription runs server-side.
 *
 * Two adapters, selected by BACKROOM_STT_PROVIDER (default 'deepgram'):
 *   - deepgram: streaming-grade REST, lowest latency for short utterances.
 *   - openai:   gpt-4o-transcribe, high accuracy.
 *
 * Both are called with plain fetch (no new dependency). transcribe() returns
 * the text plus the latency and provider label so the spike can log real
 * numbers against the sub-2s release-to-action target.
 */

export type SttProvider = 'deepgram' | 'openai';

export interface TranscriptResult {
  text:       string;
  provider:   SttProvider;
  model:      string;
  latencyMs:  number;
}

export class SttError extends Error {
  constructor(message: string, readonly status: number = 500) {
    super(message);
    this.name = 'SttError';
  }
}

function chosenProvider(): SttProvider {
  const raw = (process.env.BACKROOM_STT_PROVIDER || 'deepgram').trim().toLowerCase();
  return raw === 'openai' ? 'openai' : 'deepgram';
}

const DEEPGRAM_MODEL = process.env.BACKROOM_DEEPGRAM_MODEL || 'nova-3';
const OPENAI_STT_MODEL = process.env.BACKROOM_OPENAI_STT_MODEL || 'gpt-4o-transcribe';

async function transcribeDeepgram(audio: ArrayBuffer, mimeType: string): Promise<string> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new SttError('DEEPGRAM_API_KEY is not set on this deployment', 503);

  const url = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(DEEPGRAM_MODEL)}&smart_format=true&punctuate=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${key}`,
      'Content-Type': mimeType || 'audio/webm',
    },
    body: audio,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SttError(`Deepgram ${res.status}: ${body.slice(0, 200)}`, 502);
  }
  const json = await res.json() as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
  };
  return json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
}

async function transcribeOpenai(audio: ArrayBuffer, mimeType: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new SttError('OPENAI_API_KEY is not set on this deployment', 503);

  const ext = mimeType.includes('mp4') ? 'mp4'
    : mimeType.includes('mpeg') ? 'mp3'
    : mimeType.includes('wav') ? 'wav'
    : 'webm';
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType || 'audio/webm' }), `utterance.${ext}`);
  form.append('model', OPENAI_STT_MODEL);
  form.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SttError(`OpenAI ${res.status}: ${body.slice(0, 200)}`, 502);
  }
  const json = await res.json() as { text?: string };
  return json.text?.trim() ?? '';
}

export async function transcribe(audio: ArrayBuffer, mimeType: string): Promise<TranscriptResult> {
  const provider = chosenProvider();
  const t0 = Date.now();
  const text = provider === 'openai'
    ? await transcribeOpenai(audio, mimeType)
    : await transcribeDeepgram(audio, mimeType);
  return {
    text,
    provider,
    model: provider === 'openai' ? OPENAI_STT_MODEL : DEEPGRAM_MODEL,
    latencyMs: Date.now() - t0,
  };
}
