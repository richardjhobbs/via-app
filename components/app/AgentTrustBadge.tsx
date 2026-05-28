'use client';

/**
 * AgentTrustBadge
 * Shows RRG's live ERC-8004 on-chain identity verification status.
 * Fetches after mount so it never blocks the main page render.
 * Degrades gracefully if the chain read fails.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TrustData {
  registered:  boolean;
  agentId?:    string;
  profileUrl?: string;
  tokenUri?:   string;
  uriCurrent?: boolean;
  error?:      string;
}

export default function AgentTrustBadge() {
  const [data, setData]     = useState<TrustData | null>(null);
  const [tooltip, setTip]   = useState(false);

  useEffect(() => {
    fetch('/api/rrg/agent-trust')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ registered: false }));
  }, []);

  // Skeleton while loading
  if (!data) {
    return (
      <div className="flex items-center gap-1 px-2 py-0.5 border border-white/10 text-white/40 text-[10px] font-mono animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
        ERC-8004
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Badge */}
      <div className="flex items-center gap-2">
        {/* Status pill */}
        <div
          className="flex items-center gap-1 px-2 py-0.5 border text-[10px] font-mono uppercase tracking-wider cursor-pointer select-none
                     border-white/20 text-white/70 hover:border-white/40 hover:text-white/90 transition-colors"
          onClick={() => setTip(t => !t)}
          title="What is ERC-8004?"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              data.registered ? 'bg-emerald-400' : 'bg-red-400'
            }`}
          />
          ERC-8004
          <span className="text-white/50 ml-0.5">▾</span>
        </div>
      </div>

      {/* Tooltip / expanded panel */}
      {tooltip && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setTip(false)} />

          {/* Panel */}
          <div className="fixed sm:absolute right-4 sm:right-0 left-4 sm:left-auto top-auto sm:top-full mt-2 z-20 sm:w-64 border border-white/20 bg-black/95 p-3 text-xs font-mono shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/60 uppercase tracking-widest text-xs">ERC-8004 Trustless Agent</span>
              <button onClick={() => setTip(false)} className="text-white/50 hover:text-white">✕</button>
            </div>

            {data.registered ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                  <span className="text-emerald-400">Verified on Base mainnet</span>
                </div>

                <div className="space-y-1.5 text-white/60 mb-4">
                  <div className="flex justify-between">
                    <span>Agent ID</span>
                    <span className="text-white/80">#{data.agentId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Network</span>
                    <span className="text-white/80">Base</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Identity</span>
                    <span className={data.uriCurrent ? 'text-emerald-400' : 'text-amber-400'}>
                      {data.uriCurrent ? 'Current ✓' : 'Updating…'}
                    </span>
                  </div>
                </div>

                <p className="text-white/50 leading-relaxed mb-3 text-xs">
                  ERC-8004 is an open standard for trustless AI agents. RRG is
                  registered on-chain — any agent can verify its identity and
                  reputation before trading, without needing a human introduction.
                </p>

                <div className="flex items-center justify-between pt-2 border-t border-white/10">
                  <Link
                    href={data.profileUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/60 hover:text-white transition-colors"
                    onClick={() => setTip(false)}
                  >
                    View on 8004scan →
                  </Link>
                  <Link
                    href="https://eips.ethereum.org/EIPS/eip-8004"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/50 hover:text-white/80 transition-colors"
                    onClick={() => setTip(false)}
                  >
                    EIP-8004 ↗
                  </Link>
                </div>
              </>
            ) : (
              <div className="text-white/60">
                Registry read unavailable. Check back shortly.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
