'use client';

/**
 * PlatformBadge
 * Shows a partner platform attestation badge (e.g. "MrChief").
 * Same visual pattern as WorldIdBadge — pill with expandable tooltip.
 */

import { useState } from 'react';
import Link from 'next/link';

interface Props {
  platformName: string;
  platformSlug: string;
  logoUrl?: string | null;
  accentColor: string;
  websiteUrl?: string | null;
  attestationType: 'wallet' | 'submission';
  createdAt?: string;
}

export default function PlatformBadge({
  platformName,
  platformSlug,
  logoUrl,
  accentColor,
  websiteUrl,
  attestationType,
  createdAt,
}: Props) {
  const [tooltip, setTip] = useState(false);

  return (
    <div className="relative inline-block">
      {/* Badge pill */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 border text-xs font-mono uppercase tracking-wider cursor-pointer select-none
                   border-white/20 text-white/70 hover:border-white/40 hover:text-white/90 transition-colors"
        style={{ borderColor: `${accentColor}40`, color: `${accentColor}cc` }}
        onClick={() => setTip((t) => !t)}
        title={`Made with ${platformName}`}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="w-3.5 h-3.5 flex-shrink-0 object-contain"
          />
        ) : (
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: accentColor }}
          />
        )}
        {platformName}
        <span style={{ color: `${accentColor}80` }} className="ml-0.5">
          ▾
        </span>
      </div>

      {/* Tooltip / expanded panel */}
      {tooltip && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setTip(false)} />

          <div className="fixed sm:absolute right-4 sm:right-0 left-4 sm:left-auto top-auto sm:top-full mt-2 z-20 sm:w-72 border bg-black/95 p-4 text-sm font-mono shadow-xl"
               style={{ borderColor: `${accentColor}33` }}>
            <div className="flex items-center justify-between mb-3">
              <span
                className="uppercase tracking-widest text-xs"
                style={{ color: `${accentColor}99` }}
              >
                Platform Verified
              </span>
              <button
                onClick={() => setTip(false)}
                className="text-white/50 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-2 mb-3">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="w-4 h-4 object-contain" />
              ) : (
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: accentColor }}
                />
              )}
              <span style={{ color: accentColor }}>
                Made with {platformName}
              </span>
            </div>

            <div className="space-y-1.5 text-white/60 mb-4">
              <div className="flex justify-between">
                <span>Type</span>
                <span className="text-white/80">
                  {attestationType === 'submission'
                    ? 'This creation'
                    : 'Creator wallet'}
                </span>
              </div>
              {createdAt && (
                <div className="flex justify-between">
                  <span>Attested</span>
                  <span className="text-white/80">
                    {new Date(createdAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            <p className="text-white/50 leading-relaxed mb-3 text-xs">
              This {attestationType === 'submission' ? 'creation' : 'agent'} was
              made using {platformName}. Platform attestations are verified via
              RRG&apos;s partner badge system.
            </p>

            {websiteUrl && (
              <div className="pt-2 border-t border-white/10">
                <Link
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: `${accentColor}99` }}
                  className="hover:opacity-80 transition-opacity"
                  onClick={() => setTip(false)}
                >
                  {platformName} ↗
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
