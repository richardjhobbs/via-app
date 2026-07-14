/**
 * lib/app/mcp-forward.ts
 *
 * Gateway forwarder. Lets the central network MCP (app/mcp/route.ts) invoke a
 * transactional tool that actually lives on a per-seller / per-brand MCP, so an
 * agent connected to ONE VIA connector can go discovery -> detail -> quote ->
 * buy -> settle across the whole network without attaching a second endpoint.
 *
 * Why forward instead of re-implement: the per-seller MCP already encodes the
 * full purchase logic (Stage-1 gate, vouchers, free guest-list routing,
 * delivery/attendee validation, stock, the x402 payment requirement). Forwarding
 * reuses that ONE implementation verbatim, so the gateway can never drift from
 * the endpoint it fronts. It also generalises: the same mechanism fronts a
 * federated member (RRG) once its identifier/arg translation is wired.
 *
 * Transport: these MCP endpoints are stateless streamable-HTTP servers that
 * accept a bare JSON-RPC `tools/call` POST with no initialize handshake (a fresh
 * server is built per request), so a forward is a single HTTP POST whose result
 * we parse straight back out.
 *
 * SSRF guard: only VIA + federated-member hosts are reachable, and only the
 * central / per-seller / per-brand MCP path shapes. A seller_mcp_url arriving as
 * a tool argument can never be turned into a request to an arbitrary host.
 */
import { NETWORK_MEMBERS } from './network-search';

// Hosts the gateway may call: this app, the marketing-site MCP, and every
// federated member's host (derived from NETWORK_MEMBERS so adding a vertical
// needs no change here).
const ALLOWED_HOSTS = new Set<string>([
  'app.getvia.xyz',
  'www.getvia.xyz',
  'getvia.xyz',
  ...NETWORK_MEMBERS.map((m) => {
    try { return new URL(m.searchUrl).hostname; } catch { return ''; }
  }).filter(Boolean),
]);

// Central `/mcp`, per-seller `/sellers/{slug}/mcp`, per-brand `/brand{,s}/{slug}/mcp`.
const MCP_PATH = /^\/(?:mcp|sellers?\/[^/]+\/mcp|brands?\/[^/]+\/mcp)\/?$/i;

function allowedMcpUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (!ALLOWED_HOSTS.has(u.hostname)) return null;
  if (!MCP_PATH.test(u.pathname)) return null;
  return u;
}

export interface ForwardResult {
  ok:       boolean;         // false on transport error OR when the tool returned isError
  payload?: unknown;         // the tool's parsed JSON result (or raw text if not JSON)
  error?:   string;          // machine code when ok === false
  status:   number;          // HTTP-ish status for the caller to map
}

/** Parse a JSON-RPC response body that may be plain JSON or an SSE data stream. */
function parseRpc(text: string): { result?: { content?: unknown; isError?: boolean }; error?: { message?: string } } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch { return null; }
  }
  // SSE: take the last `data:` line (the final JSON-RPC message).
  const dataLines = trimmed.split(/\r?\n/).filter((l) => l.startsWith('data:'));
  if (dataLines.length === 0) return null;
  const last = dataLines[dataLines.length - 1].replace(/^data:\s*/, '');
  try { return JSON.parse(last); } catch { return null; }
}

/**
 * Call `toolName` on the MCP at `mcpUrl`, forwarding `args`, and return the
 * tool's parsed payload. Never throws: transport failures come back as
 * { ok:false, error, status } so the gateway tool can surface a clean message.
 */
export async function forwardMcpTool(
  mcpUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  opts: { viaAgentId?: string | null } = {},
): Promise<ForwardResult> {
  const u = allowedMcpUrl(mcpUrl);
  if (!u) return { ok: false, error: 'blocked_target', status: 400 };

  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } };
  let res: Response;
  try {
    res = await fetch(u.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept:         'application/json, text/event-stream',
        ...(opts.viaAgentId ? { 'x-via-agent-id': String(opts.viaAgentId) } : {}),
      },
      body:   JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, error: 'target_unreachable', status: 502 };
  }

  const rpc = parseRpc(await res.text());
  if (!rpc) return { ok: false, error: 'bad_response', status: 502 };
  if (rpc.error) return { ok: false, error: rpc.error.message ?? 'tool_error', status: 502 };

  const content = rpc.result?.content;
  const textPart = Array.isArray(content)
    ? (content.find((c): c is { type: string; text: string } => Boolean(c) && (c as { type?: string }).type === 'text')?.text ?? null)
    : null;
  if (typeof textPart !== 'string') return { ok: false, error: 'empty_response', status: 502 };

  let payload: unknown;
  try { payload = JSON.parse(textPart); } catch { payload = textPart; }
  return { ok: !rpc.result?.isError, payload, status: res.status };
}
