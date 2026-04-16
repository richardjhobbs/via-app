/**
 * AgentReadyBadge
 *
 * Small monochrome pill indicating that a listing has agent-facing
 * metadata populated (enhanced_description + structured product_attributes
 * via the per-brand MCP). Two variants:
 *
 *   - <AgentReadyBadge />          → "AGENT READY" (cyan)
 *   - <AgentReadyBadge label={x} /> → arbitrary label (e.g. an
 *                                     authentication-status pill set per brand)
 *
 * Server-renderable, no client-side JS needed.
 */

import React from 'react';

interface Props {
  label?: string;
  tone?: 'cyan' | 'amber' | 'neutral';
  size?: 'sm' | 'md';
}

const TONES = {
  cyan:    'border-cyan-400/40 text-cyan-300/90 bg-cyan-400/5',
  amber:   'border-amber-400/40 text-amber-300/90 bg-amber-400/5',
  neutral: 'border-white/30 text-white/70 bg-white/5',
};

const SIZES = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-1 text-xs',
};

export default function AgentReadyBadge({
  label = 'Agent Ready',
  tone = 'cyan',
  size = 'sm',
}: Props) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 border font-mono uppercase tracking-wider rounded',
        TONES[tone],
        SIZES[size],
      ].join(' ')}
    >
      {tone === 'cyan' && (
        <span className="w-1 h-1 rounded-full bg-cyan-300/80 flex-shrink-0" />
      )}
      {label}
    </span>
  );
}
