import { createConfig, http } from 'wagmi';
import { base } from 'viem/chains';
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors';

export const targetChain   = base;
export const targetChainId = base.id;

// Free project ID from https://cloud.walletconnect.com
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    // All browser-extension wallets (MetaMask, Brave, Rabby, Frame, etc.)
    // wagmi v2+ uses EIP-6963 multi-provider discovery — each extension
    // shows up as its own button automatically.
    injected(),

    // Coinbase Wallet (browser extension + mobile app)
    coinbaseWallet({ appName: 'RRG — realrealgenuine.com' }),

    // WalletConnect v2 — QR-code / deep-link for 300+ wallets & mobile
    // Requires NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID env var (free at
    // https://cloud.walletconnect.com). Hidden if no project ID is set.
    ...(wcProjectId
      ? [walletConnect({ projectId: wcProjectId })]
      : []),
  ],
  transports: {
    [base.id]: http('https://mainnet.base.org'),
  },
  ssr: true,
});
