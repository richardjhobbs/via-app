'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThirdwebProvider, AutoConnect } from 'thirdweb/react';
import { inAppWallet } from 'thirdweb/wallets';
import { wagmiConfig } from '@/lib/app/wagmiConfig';
import { thirdwebClient } from '@/lib/app/thirdwebClient';
import { useState } from 'react';
import WebMCPTools from '@/components/app/WebMCPTools';

// Wallets that should auto-reconnect across page loads / tabs
const autoConnectWallets = [
  inAppWallet({ auth: { options: ['google', 'email'] } }),
];

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ThirdwebProvider>
          {/* Silently reconnects thirdweb in-app wallet if user previously authenticated */}
          <AutoConnect client={thirdwebClient} wallets={autoConnectWallets} />
          <WebMCPTools />
          {children}
        </ThirdwebProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
