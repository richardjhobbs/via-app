'use client';

/**
 * Milestone-1 voice spike surface (not a member surface, not shipped to
 * members). Proves the loop end to end: hold to speak, server transcription,
 * one utterance resolved through a member agent to one room tool call, with
 * real latency numbers shown against the sub-2s target.
 */
import { useState } from 'react';
import { HoldToSpeak } from '@/components/backroom/HoldToSpeak';

interface VoiceResult {
  transcript: string;
  action: { tool: string | null; arguments: Record<string, unknown>; say: string; llmLabel: string } | null;
  stt?: { provider: string; model: string; latency_ms: number };
  resolve_ms?: number;
  total_ms?: number;
  note?: string;
  error?: string;
}

export default function VoiceSpikePage() {
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function onUtterance(blob: Blob) {
    setBusy(true);
    setResult(null);
    const form = new FormData();
    form.append('audio', blob, 'utterance');
    const res = await fetch('/api/backroom/voice', { method: 'POST', body: form });
    const json = (await res.json()) as VoiceResult;
    setResult(json);
    setBusy(false);
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px 160px' }}>
      <p className="br-sans" style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        The Back Room
      </p>
      <h1 className="br-serif" style={{ fontSize: 34, fontWeight: 400, margin: '8px 0 4px' }}>
        Voice spike
      </h1>
      <p className="br-sans" style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.6 }}>
        Hold the button and say something, for example: put this record on the table, or find a pressing plant that does 180 gram.
      </p>

      {busy && (
        <p className="br-sans" style={{ marginTop: 32, color: 'var(--ink-3)' }}>Working...</p>
      )}

      {result && (
        <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {result.error ? (
            <p className="br-sans" style={{ color: 'var(--danger)' }}>{result.error}</p>
          ) : (
            <>
              <Field label="Heard" value={result.transcript || result.note || '(nothing)'} serif />
              {result.action?.tool && (
                <Field label="Resolved to" value={`${result.action.tool}(${JSON.stringify(result.action.arguments)})`} />
              )}
              {result.action?.say && <Field label="VIA" value={result.action.say} serif />}
              <div
                className="br-sans"
                style={{
                  fontSize: 13,
                  color: 'var(--ink-3)',
                  borderTop: '1px solid var(--line)',
                  paddingTop: 12,
                  display: 'flex',
                  gap: 18,
                  flexWrap: 'wrap',
                }}
              >
                {result.stt && <span>stt {result.stt.provider} {result.stt.latency_ms}ms</span>}
                {typeof result.resolve_ms === 'number' && <span>resolve {result.resolve_ms}ms</span>}
                {typeof result.total_ms === 'number' && (
                  <span style={{ color: result.total_ms <= 2000 ? 'var(--live)' : 'var(--warning)' }}>
                    total {result.total_ms}ms
                  </span>
                )}
                {result.action?.llmLabel && <span>{result.action.llmLabel}</span>}
              </div>
            </>
          )}
        </div>
      )}

      <HoldToSpeak onUtterance={onUtterance} />
    </main>
  );
}

function Field({ label, value, serif }: { label: string; value: string; serif?: boolean }) {
  return (
    <div>
      <p className="br-sans" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 4px' }}>
        {label}
      </p>
      <p className={serif ? 'br-serif' : 'br-sans'} style={{ fontSize: serif ? 20 : 15, margin: 0, color: 'var(--ink)', wordBreak: 'break-word' }}>
        {value}
      </p>
    </div>
  );
}
