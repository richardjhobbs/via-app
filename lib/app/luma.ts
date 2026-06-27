/**
 * Luma (lu.ma) public-API fulfilment adapter for the ticketing channel.
 *
 * When an event store is configured for `luma_api` fulfilment, a settled pass
 * purchase registers the buyer directly on the seller's Luma event instead of
 * handing them a redemption code: VIA -> Luma add-guest -> Luma issues the pass.
 * This removes the code-batch step entirely.
 *
 * Auth + shape (Luma public API, https://docs.luma.com):
 *   - Base URL  : https://public-api.luma.com
 *   - Auth      : header `x-luma-api-key` (per-calendar key, requires Luma Plus)
 *   - Add guest : POST /v1/event/add-guests
 *                 body { event_api_id, guests: [{ email, name? }] }
 *
 * The API key is NEVER stored in the database: it is read from an environment
 * variable named by the product's metadata.fulfilment.luma_api_key_env (so the
 * secret lives only in the deployment env). The event_api_id IS stored in
 * metadata (it is not a secret).
 *
 * NOTE: confirm the exact add-guests path/body against docs.luma.com when the
 * live key lands; this adapter fails closed (any non-2xx returns ok:false) and
 * the caller falls back to the voucher-code pool, so a shape mismatch degrades
 * gracefully rather than dropping the sale.
 */

const LUMA_API_BASE = 'https://public-api.luma.com';

export interface LumaGuestResult {
  ok:    boolean;
  error?: string;
}

/**
 * Register one guest (by email) on a Luma event. Returns ok:false on any
 * non-2xx or network error so the caller can fall back to code delivery.
 * Idempotent in practice: re-adding an already-registered email for the same
 * event is a no-op on Luma's side.
 */
export async function addLumaGuest(opts: {
  apiKey:     string;
  eventApiId: string;
  email:      string;
  name?:      string | null;
}): Promise<LumaGuestResult> {
  if (!opts.apiKey || !opts.eventApiId || !opts.email) {
    return { ok: false, error: 'missing apiKey, eventApiId, or email' };
  }
  try {
    const res = await fetch(`${LUMA_API_BASE}/v1/event/add-guests`, {
      method:  'POST',
      headers: { 'x-luma-api-key': opts.apiKey, 'content-type': 'application/json' },
      body:    JSON.stringify({
        event_api_id: opts.eventApiId,
        guests:       [{ email: opts.email, ...(opts.name ? { name: opts.name } : {}) }],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `luma add-guests ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
