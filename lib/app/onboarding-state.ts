/**
 * Client-only helpers for persisting the multi-step onboarding wizard state
 * across page navigations. State lives in localStorage under a single key so
 * the user can refresh / share / back-button without losing inputs.
 *
 * The server commits the row in app_sellers at the END of step 4 (catalog).
 * Until then, nothing is persisted server-side.
 */

export type OnboardRole = 'seller' | 'buyer';

export interface SellerOnboardState {
  role:                 'seller';
  email?:               string;
  password?:            string;       // held only until the register endpoint completes; never reused
  sellerName?:          string;
  slug?:                string;
  kind?:                'product' | 'service' | 'mixed';
  description?:         string;
  websiteUrl?:          string;
  // The seller provides ONE wallet: their payout EOA. The Sales Agent's identity
  // wallet is platform-derived server-side (never collected in the wizard).
  walletAddress?:       string;       // seller's payout wallet (pasted EOA; receives USDC)
  catalogSource?:       'shopify' | 'csv' | 'services';
  shopifyDomain?:       string;
}

export interface BuyerOnboardState {
  role:                'buyer';
  email?:              string;
  password?:           string;
  handle?:             string;
  displayName?:        string;
  walletAddress?:      string;       // buyer's funding wallet (where USDC sits for x402 payments)
  // The Buying Agent's identity wallet is platform-derived server-side.
  // Set when the user arrived from a free-event landing page: after registration
  // completes, the done step claims this pass and binds it to the new buyer.
  eventClaim?:         { slug: string; tier: string };
  // Set when the user arrived from a room invitation link: after registration
  // completes, the done step redeems the invite and lands them in the room.
  roomInvite?:         { token: string };
}

export type OnboardState = SellerOnboardState | BuyerOnboardState;

const KEY = 'via.onboard.v1';
// The password is the one sensitive field in the wizard. Keep it out of
// localStorage (which persists to disk and is shared across tabs) and hold it
// in sessionStorage instead: cleared when the tab closes, scoped to this tab,
// and never written to disk. Read/write/clear overlay it transparently so the
// call sites see a single state object.
const PW_KEY = 'via.onboard.pw.v1';

export function readOnboardState(): OnboardState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as OnboardState;
    const pw = window.sessionStorage.getItem(PW_KEY);
    if (pw) (state as { password?: string }).password = pw;
    return state;
  } catch {
    return null;
  }
}

export function writeOnboardState(patch: Partial<OnboardState>): OnboardState {
  if (typeof window === 'undefined') return patch as OnboardState;
  const prev = readOnboardState() ?? ({} as OnboardState);
  const next = { ...prev, ...patch } as OnboardState;
  const { password, ...persisted } = next as unknown as Record<string, unknown> & { password?: string };
  if (typeof password === 'string' && password.length > 0) {
    window.sessionStorage.setItem(PW_KEY, password);
  }
  window.localStorage.setItem(KEY, JSON.stringify(persisted));
  return next;
}

export function clearOnboardState(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY);
  window.sessionStorage.removeItem(PW_KEY);
}

/** Normalise a free-form business name into a URL-safe slug. */
export function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
