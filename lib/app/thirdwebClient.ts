/**
 * Thirdweb v5 client configuration.
 *
 * Used for in-app wallet creation (email/social login) on the creator
 * registration page. This gives non-crypto-native users a wallet without
 * requiring MetaMask or any browser extension.
 *
 * Requires NEXT_PUBLIC_THIRDWEB_CLIENT_ID env var from https://thirdweb.com/dashboard
 */

import { createThirdwebClient } from 'thirdweb';

const clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID ?? '';

if (!clientId && typeof window !== 'undefined') {
  console.warn('[thirdweb] NEXT_PUBLIC_THIRDWEB_CLIENT_ID not set — wallet features will not work');
}

// Use a dummy clientId during SSG/build when env var is not available.
// thirdweb SDK throws if clientId is empty string.
export const thirdwebClient = createThirdwebClient({
  clientId: clientId || 'build-placeholder',
});
