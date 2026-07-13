'use client';

/**
 * The persistent hold-to-speak control. Bottom centre, thumb reach, on every
 * Back Room surface. Press and hold to speak, release to act. Slow, physical,
 * no pulsing for attention.
 */
import { useHoldToSpeak, type SpeakState } from './useHoldToSpeak';

const LABEL: Record<SpeakState, string> = {
  idle:       'Hold to speak',
  recording:  'Listening',
  processing: 'One moment',
  error:      'Try again',
};

export function HoldToSpeak({ onUtterance }: { onUtterance: (blob: Blob) => void | Promise<void> }) {
  const { state, error, start, stop } = useHoldToSpeak(onUtterance);
  const active = state === 'recording';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: '20px 16px calc(20px + env(safe-area-inset-bottom))',
        pointerEvents: 'none',
      }}
    >
      {error && state === 'error' && (
        <span className="br-sans" style={{ fontSize: 12, color: 'var(--danger)', pointerEvents: 'none' }}>
          {error}
        </span>
      )}
      <button
        type="button"
        aria-label="Hold to speak"
        onPointerDown={(e) => { e.preventDefault(); void start(); }}
        onPointerUp={(e) => { e.preventDefault(); stop(); }}
        onPointerLeave={() => { if (active) stop(); }}
        onContextMenu={(e) => e.preventDefault()}
        className="br-sans"
        style={{
          pointerEvents: 'auto',
          userSelect: 'none',
          touchAction: 'none',
          minWidth: 220,
          padding: '18px 32px',
          borderRadius: 999,
          border: '1px solid var(--ink)',
          // Semi-transparent infill (plus a light blur) so the pill reads clearly
          // when it overlays the table, instead of content showing through.
          background: active ? 'var(--ink)' : 'color-mix(in srgb, var(--bg) 85%, transparent)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
          color: active ? 'var(--bg)' : 'var(--ink)',
          fontSize: 15,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          transition: 'background 0.4s ease, color 0.4s ease, transform 0.4s ease',
          transform: active ? 'scale(1.03)' : 'scale(1)',
        }}
      >
        {LABEL[state]}
      </button>
    </div>
  );
}
