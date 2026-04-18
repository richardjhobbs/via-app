'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { Agent } from '@/lib/agent/types';

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

export function LlmStatusCard({ agent }: Props) {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latency_ms?: number; error?: string } | null>(null);

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

  if (agent.tier !== 'pro') return null;

  return (
    <Card>
      <h2 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', margin: '0 0 16px' }}>
        LLM Provider
      </h2>

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
            <div style={row}><span style={lbl}>Per evaluation</span><span style={val}>${status.cost_per_eval.toFixed(4)}</span></div>
            <div style={row}><span style={lbl}>Per chat message</span><span style={val}>{status.chat_cost_estimate}</span></div>
            <div style={row}><span style={lbl}>Evals remaining</span><span style={val}>{status.estimated_evals_remaining.toLocaleString()}</span></div>
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
