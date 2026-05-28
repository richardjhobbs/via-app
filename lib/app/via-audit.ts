// VIA signed-action audit client.
//
// Records an externally-visible agent action into the VIA protocol-level
// tamper-evident, append-only signed-action chain (via_record_signed_action
// at getvia.xyz/mcp). Server-side enforcement point: an action is not "done"
// until it is logged here.
//
// Transport mirrors lib/agent/erc8004.ts callViaTool exactly (stateless
// single-shot JSON-RPC, SSE-or-JSON response parsing) rather than inventing
// a new caller.

const VIA_MCP_URL = process.env.VIA_MCP_URL ?? 'https://www.getvia.xyz/mcp';

export interface SignedActionInput {
  via_agent_id: number;
  source_platform: string;
  action_type: string;
  target: string;
  payload_hash: string;
  payload?: Record<string, unknown>;
  nonce: number;
  signed_message: string;
  signature: string;
  sig_scheme: 'rrg-priscilla-post-v1' | 'via-action-v1';
}

/**
 * Record a signed action. Throws on transport, RPC, or tool-level errors so
 * the caller can surface the failure loudly (an unlogged action is a gap in
 * the audit trail and must never be swallowed silently).
 */
export async function recordSignedAction(
  input: SignedActionInput,
): Promise<Record<string, unknown>> {
  const platform_secret = process.env.VIA_PLATFORM_SECRET;

  const res = await fetch(VIA_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'via_record_signed_action',
        arguments: { ...input, platform_secret },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`VIA MCP HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const raw = await res.text();
  // Server may emit Server-Sent-Events ("event: message\ndata: {...}\n\n") or plain JSON.
  const dataLine = raw.split('\n').find(l => l.startsWith('data: '));
  const json = dataLine ? dataLine.slice(6) : raw;
  const parsed = JSON.parse(json) as {
    result?: { content?: { text: string }[]; isError?: boolean };
    error?: { message: string };
  };

  if (parsed.error) {
    throw new Error(`VIA MCP RPC error: ${parsed.error.message}`);
  }
  const text = parsed.result?.content?.[0]?.text;
  if (!text) {
    throw new Error(`VIA MCP returned no content: ${json.slice(0, 300)}`);
  }
  if (parsed.result?.isError) {
    throw new Error(`VIA MCP tool error: ${text}`);
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`VIA MCP returned non-JSON content: ${text.slice(0, 300)}`);
  }
}
