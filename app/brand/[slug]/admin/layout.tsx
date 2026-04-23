'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useActiveWallet, useDisconnect } from 'thirdweb/react';
import { BrandCtx, type BrandContext } from './brand-context';

export default function BrandAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams();
  const slug   = params.slug as string;

  const activeWallet = useActiveWallet();
  const { disconnect } = useDisconnect();

  const [ctx,     setCtx]     = useState<BrandContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/brand/auth/check')
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) {
          router.push('/brand/login');
          return;
        }
        const match = d.brands?.find(
          (b: { brandSlug: string }) => b.brandSlug === slug
        );
        if (!match) {
          router.push('/brand/login');
          return;
        }
        setCtx({
          brandId:   match.brandId,
          brandName: match.brandName,
          brandSlug: match.brandSlug,
          userEmail: d.user.email,
        });
        setLoading(false);
      })
      .catch(() => router.push('/brand/login'));
  }, [slug, router]);

  const handleLogout = async () => {
    if (activeWallet) {
      disconnect(activeWallet);
    }
    await fetch('/api/brand/auth/logout', { method: 'POST' });
    router.push('/brand/login');
  };

  if (loading || !ctx) {
    return (
      <p className="px-6 py-8 font-mono text-white/50 text-base">Loading…</p>
    );
  }

  return (
    <BrandCtx.Provider value={ctx}>
      <div className="border-b border-white/10 px-6 py-2 flex justify-between items-center bg-white/[0.03]">
        <span className="text-sm text-white/40 font-mono">Brand Admin</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-white/50 font-mono">{ctx.userEmail}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-white/50 hover:text-white transition-colors font-mono"
          >
            Logout
          </button>
        </div>
      </div>
      {children}
    </BrandCtx.Provider>
  );
}
