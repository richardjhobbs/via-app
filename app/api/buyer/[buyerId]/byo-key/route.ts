/**
 * Bring-your-own LLM key for a Buying Agent. Mirrors RRG's byo-key route.
 *
 *   GET    , current status { connected, provider, last4, model, set_at }
 *   POST   , save { provider: 'openai'|'openrouter', api_key, model? }
 *            (validated with a tiny live call before it is stored, encrypted)
 *   DELETE , disconnect (clear the key, fall back to platform credits)
 *
 * When a key is set the agent runs on the owner's provider and platform credits
 * are NOT consumed (see lib/app/buyer-llm.ts + the chat / negotiate routes).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';
import { encryptByoKey, lastFour } from '@/lib/app/byo-key-crypt';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['openai', 'openrouter']);
const MODEL_RE = /^[a-zA-Z0-9._\-:/]{3,80}$/;

function baseUrlFor(provider: string): string {
  return provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
}
function defaultModelFor(provider: string): string {
  return provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini';
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ buyerId: string }> }) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  const { data } = await db
    .from('app_buyers')
    .select('llm_byo_provider, llm_byo_key_last4, llm_byo_model, llm_byo_set_at')
    .eq('id', buyerId)
    .maybeSingle();

  return NextResponse.json({
    connected: !!data?.llm_byo_provider,
    provider:  data?.llm_byo_provider ?? null,
    last4:     data?.llm_byo_key_last4 ?? null,
    model:     data?.llm_byo_model ?? null,
    set_at:    data?.llm_byo_set_at ?? null,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ buyerId: string }> }) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  let body: { provider?: unknown; api_key?: unknown; model?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const provider = String(body.provider ?? '').trim().toLowerCase();
  const apiKey   = String(body.api_key ?? '').trim();
  const model    = String(body.model ?? '').trim();

  if (!ALLOWED.has(provider)) return NextResponse.json({ error: 'provider must be openai or openrouter' }, { status: 400 });
  if (apiKey.length < 16)     return NextResponse.json({ error: 'API key looks too short' }, { status: 400 });
  if (provider === 'openrouter' && model && !MODEL_RE.test(model)) {
    return NextResponse.json({ error: 'invalid model identifier' }, { status: 400 });
  }
  const effectiveModel = provider === 'openrouter' ? (model || defaultModelFor(provider)) : defaultModelFor(provider);

  // Validate the key with a tiny live call before storing it.
  try {
    const res = await fetch(`${baseUrlFor(provider)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: effectiveModel,
        messages: [{ role: 'user', content: 'Respond with exactly: OK' }],
        max_tokens: 5,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Key rejected by ${provider}: ${text.slice(0, 160)}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: `Could not reach ${provider} to validate the key: ${err instanceof Error ? err.message : 'network error'}` }, { status: 400 });
  }

  let encrypted: string;
  try {
    encrypted = encryptByoKey(apiKey);
  } catch (err) {
    console.error('[byo-key] encrypt failed:', err);
    return NextResponse.json({ error: 'Server is not configured for BYO keys yet.' }, { status: 500 });
  }

  const { error } = await db
    .from('app_buyers')
    .update({
      llm_byo_provider:      provider,
      llm_byo_key_encrypted: encrypted,
      llm_byo_key_last4:     lastFour(apiKey),
      llm_byo_model:         provider === 'openrouter' ? effectiveModel : null,
      llm_byo_set_at:        new Date().toISOString(),
    })
    .eq('id', buyerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    connected: true,
    provider,
    last4:  lastFour(apiKey),
    model:  provider === 'openrouter' ? effectiveModel : null,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ buyerId: string }> }) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  const { error } = await db
    .from('app_buyers')
    .update({
      llm_byo_provider:      null,
      llm_byo_key_encrypted: null,
      llm_byo_key_last4:     null,
      llm_byo_model:         null,
      llm_byo_set_at:        null,
    })
    .eq('id', buyerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ connected: false });
}
