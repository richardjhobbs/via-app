/**
 * fetchWithTimeout, a single safe primitive for client-side API calls.
 *
 * The wizard and dashboard both used to call `await fetch(...)` with no
 * timeout. A hung server, dropped TCP connection, mid-deploy Next.js bundle
 * mismatch, or sleeping mobile radio could leave the UI spinning forever
 * with no recovery path. That is the bug class this helper closes.
 *
 * Returns a discriminated union so callers MUST handle every failure mode:
 *   { kind: 'ok', data }        - server returned 2xx and JSON parsed
 *   { kind: 'http', status,     - server returned non-2xx; body is the parsed
 *     body }                      JSON or { error: <text> } as a fallback
 *   { kind: 'timeout' }         - aborted after timeoutMs
 *   { kind: 'network', error }  - fetch threw before a response arrived
 *   { kind: 'parse', error }    - response parsing failed
 *
 * Use it like:
 *   const r = await fetchJson<{ agent: Agent }>('/api/x', { method: 'POST' });
 *   switch (r.kind) {
 *     case 'ok':      ...
 *     case 'http':    ...
 *     case 'timeout': ...
 *     case 'network': ...
 *     case 'parse':   ...
 *   }
 */

export type FetchResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'http'; status: number; body: unknown }
  | { kind: 'timeout' }
  | { kind: 'network'; error: Error }
  | { kind: 'parse'; error: Error };

export interface FetchJsonOptions extends Omit<RequestInit, 'signal'> {
  /** Hard timeout in milliseconds. Defaults to 30,000 (30s). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchJson<T = unknown>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<FetchResult<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const e = err instanceof Error ? err : new Error(String(err));
    if (e.name === 'AbortError') return { kind: 'timeout' };
    return { kind: 'network', error: e };
  }
  clearTimeout(timer);

  // Parse body once. Tolerate non-JSON (e.g. HTML error pages from
  // a reverse proxy mid-deploy) by capturing as text and stashing
  // under { error } so callers can still surface something meaningful.
  let body: unknown;
  const ct = res.headers.get('content-type') ?? '';
  try {
    body = ct.includes('application/json') ? await res.json() : { error: await res.text() };
  } catch (err) {
    return { kind: 'parse', error: err instanceof Error ? err : new Error(String(err)) };
  }

  if (!res.ok) {
    return { kind: 'http', status: res.status, body };
  }

  return { kind: 'ok', data: body as T };
}

/**
 * Convenience: pull a human-readable error string out of an http/parse/network
 * /timeout result for a fallback error banner. Callers that want richer
 * handling (e.g. branching on a 409 conflict payload) should switch on
 * result.kind themselves and only fall through to this for the generic case.
 */
export function fetchErrorMessage<T>(r: Exclude<FetchResult<T>, { kind: 'ok' }>): string {
  switch (r.kind) {
    case 'timeout':
      return 'Took longer than expected. Check your connection and try again.';
    case 'network':
      return 'Network error. Check your connection and try again.';
    case 'parse':
      return 'Got an unexpected response from the server. Please refresh and try again.';
    case 'http': {
      const body = r.body as { error?: unknown } | null;
      if (body && typeof body.error === 'string' && body.error.length > 0) return body.error;
      return `Server error (${r.status}). Please try again.`;
    }
  }
}
