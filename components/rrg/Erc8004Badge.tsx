'use client';

/**
 * Erc8004Badge
 * Shows VIA Agent identity (backed by ERC-8004 on-chain registration).
 * Renders nothing if the wallet has no ERC-8004 registration.
 */

import { useState } from 'react';
import Link from 'next/link';

interface Props {
  agentId: number;
}

export default function Erc8004Badge({ agentId }: Props) {
  const [tooltip, setTip] = useState(false);

  return (
    <div className="relative inline-block">
      {/* Badge pill */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 border text-xs font-mono uppercase tracking-wider cursor-pointer select-none
                   border-amber-500/30 text-amber-400/80 hover:border-amber-400/50 hover:text-amber-300 transition-colors"
        onClick={() => setTip((t) => !t)}
        title="VIA Agent identity (ERC-8004 verified)"
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-amber-400" />
        VIA #{agentId}
        <span className="text-amber-400/50 ml-0.5">▾</span>
      </div>

      {/* Tooltip / expanded panel */}
      {tooltip && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setTip(false)} />

          {/* Panel */}
          <div className="fixed sm:absolute right-4 sm:right-0 left-4 sm:left-auto top-auto sm:top-full mt-2 z-20 sm:w-72 border border-amber-500/20 bg-black/95 p-4 text-sm font-mono shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-amber-400/60 uppercase tracking-widest text-xs">
                VIA Agent Identity
              </span>
              <button
                onClick={() => setTip(false)}
                className="text-white/50 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              <span className="text-amber-400">
                VIA Agent #{agentId}
              </span>
            </div>

            <div className="space-y-1.5 text-white/60 mb-4">
              <div className="flex justify-between">
                <span>Standard</span>
                <span className="text-white/80">ERC-8004</span>
              </div>
              <div className="flex justify-between">
                <span>Network</span>
                <span className="text-white/80">Base</span>
              </div>
              <div className="flex justify-between">
                <span>Registry</span>
                <span className="text-white/80 text-xs">0x8004...9432</span>
              </div>
            </div>

            <p className="text-white/50 leading-relaxed mb-3 text-xs">
              VIA Agent IDs are portable identities across the VIA network,
              backed by ERC-8004 on-chain registration on Base mainnet.
            </p>

            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <Link
                href={`/agents/via/${agentId}`}
                className="text-amber-400/60 hover:text-amber-300 transition-colors"
                onClick={() => setTip(false)}
              >
                Profile →
              </Link>
              <Link
                href={`https://8004scan.io/agents/base/${agentId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/50 hover:text-white/80 transition-colors"
                onClick={() => setTip(false)}
              >
                8004scan ↗
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
