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
  role:           'seller';
  email?:         string;
  password?:      string;       // held only until the register endpoint completes; never reused
  sellerName?:    string;
  slug?:          string;
  kind?:          'product' | 'service' | 'mixed';
  description?:   string;
  websiteUrl?:    string;
  walletAddress?: string;
  catalogSource?: 'shopify' | 'csv' | 'services';
  shopifyDomain?: string;
}

export interface BuyerOnboardState {
  role:           'buyer';
  email?:         string;
  password?:      string;
  handle?:        string;
  walletAddress?: string;
}

export type OnboardState = SellerOnboardState | BuyerOnboardState;

const KEY = 'via.onboard.v1';

export function readOnboardState(): OnboardState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OnboardState;
  } catch {
    return null;
  }
}

export function writeOnboardState(patch: Partial<OnboardState>): OnboardState {
  if (typeof window === 'undefined') return patch as OnboardState;
  const prev = readOnboardState() ?? ({} as OnboardState);
  const next = { ...prev, ...patch } as OnboardState;
  window.localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearOnboardState(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY);
}

/** Normalise a free-form business name into a URL-safe slug. */
export function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
