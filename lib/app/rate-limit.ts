/**
 * lib/app/rate-limit.ts
 *
 * Best-effort in-memory rate limiter, scoped to a single warm serverless
 * instance. Keyed by an arbitrary string (usually client IP, optionally
 * namespaced per route) over a sliding window.
 *
 * Per-instance only: there is no shared store, so a determined attacker
 * spread across many cold lambdas can still get through. That is acceptable
 * for the threat this guards (credential stuffing on login, reset-email spam):
 * it blunts the cheap high-volume bursts from one source without adding a
 * Redis dependency. Mirrors the per-instance limiter in the MCP routes.
 */

const buckets = new Map<string, number[]>();

/** Pull the best-available client IP from the standard proxy headers. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'noip';
}

/**
 * Record a hit for `key` and return true if it now exceeds `max` within the
 * trailing `windowMs`. Call once per request at the top of a handler.
 */
export function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  return hits.length > max;
}
