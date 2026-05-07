'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { LLM_PROVIDER_OPTIONS } from '@/lib/agent/types';
import type { Agent, LlmProvider } from '@/lib/agent/types';

interface LlmStatus {
  provider: string;
  label: string;
  model: string;
  color: string;
  api_key_configured: boolean;
  cost_per_eval: number;
  chat_cost_estimate: string;
  credit_balance: number;
  estimated_evals_remaining: number;
}

interface Props {
  agent: Agent;
  onProviderChange?: (provider: LlmProvider) => void;
}

const lbl: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains), monospace',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};
const val: React.CSSProperties = { fontSize: 12, color: 'var(--ink)' };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };

export function LlmStatusCard({ agent, onProviderChange }: Props) {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latency_ms?: number; error?: string } | null>(null);
  const [editingProvider, setEditingProvider] = useState(false);
  const [providerDraft, setProviderDraft] = useState<LlmProvider>(agent.llm_provider);
  const [savingProvider, setSavingProvider] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/agent/${agent.id}/llm-status`)
      .then(r => r.json())
      .then(setStatus)
      .catch(() => {});
  }, [agent.id, agent.llm_provider]);

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/agent/${agent.id}/llm-status`, { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, error: 'Connection error' });
    } finally {
      setTesting(false);
    }
  }

  async function saveProvider() {
    if (providerDraft === agent.llm_provider) {
      setEditingProvider(false);
      return;
    }
    setSavingProvider(true);
    setProviderError(null);
    try {
      const res = await fetch(`/api/agent/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_provider: providerDraft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to switch provider');
      }
      onProviderChange?.(providerDraft);
      setEditingProvider(false);
    } catch (err) {
      setProviderError(err instanceof Error ? err.message : 'Failed to switch provider');
    } finally {
      setSavingProvider(false);
    }
  }

  if (agent.tier !== 'pro') return null;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', margin: 0 }}>
          LLM Provider
        </h2>
        {!editingProvider && (
          <button
            onClick={() => { setProviderDraft(agent.llm_provider); setEditingProvider(true); }}
            className="text-xs text-green-700 hover:text-green-800 transition-colors cursor-pointer"
            style={{ background: 'transparent', border: 'none', padding: 0 }}
          >
            Switch
          </button>
        )}
      </div>

      {editingProvider && (
        <div style={{ marginBottom: 16, padding: 12, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Select
            label="Provider"
            value={providerDraft}
            onChange={(v) => setProviderDraft(v as LlmProvider)}
            options={[...LLM_PROVIDER_OPTIONS]}
          />
          {providerError && (
            <div style={{ fontSize: 11, color: '#b5453a', fontFamily: 'var(--font-jetbrains), monospace', letterSpacing: '0.06em' }}>
              {providerError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" onClick={saveProvider} loading={savingProvider}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditingProvider(false); setProviderError(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {!status ? (
        <div style={{ ...lbl }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <div style={row}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 8, height: 8, borderRadius: 99,
                  background: status.api_key_configured ? 'var(--live)' : '#a47a3a',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{status.label}</span>
            </div>
            <span style={lbl}>{status.model}</span>
          </div>

          <div>
            <span
              style={{
                display: 'inline-flex',
                padding: '3px 8px',
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                border: `1px solid ${status.api_key_configured ? 'var(--accent)' : '#a47a3a'}`,
                color: status.api_key_configured ? 'var(--accent)' : '#a47a3a',
              }}
            >
              {status.api_key_configured ? 'Connected' : 'No API key'}
            </span>
          </div>

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Per-evaluation and evals-remaining hidden until autonomous
                drop evaluation actually runs in production. Showing a cost
                for a feature that doesn't fire just confuses users. */}
            <div style={row}><span style={lbl}>Per chat message</span><span style={val}>{status.chat_cost_estimate}</span></div>
          </div>

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <Button size="sm" variant="secondary" onClick={testConnection} loading={testing}>
              Test connection
            </Button>
            {testResult && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: testResult.success ? 'var(--accent)' : '#b5453a',
                  fontFamily: 'var(--font-jetbrains), monospace',
                  letterSpacing: '0.08em',
                }}
              >
                {testResult.success
                  ? `Connected (${testResult.latency_ms}ms)`
                  : `Failed: ${testResult.error}`}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
