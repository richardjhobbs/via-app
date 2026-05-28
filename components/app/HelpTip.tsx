'use client';

import { useState, useRef, useEffect } from 'react';

interface HelpTipProps {
  /** The help text to display in the modal */
  content: string | React.ReactNode;
  /** Optional title for the modal */
  title?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

export default function HelpTip({ content, title, size = 'sm' }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // delay to avoid immediate close from the click that opened it
    setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const btnSize = size === 'sm' ? 'w-4 h-4 text-[10px]' : 'w-5 h-5 text-xs';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center ${btnSize} rounded-full
                    border border-amber-400/60 text-amber-400 hover:text-amber-300 hover:border-amber-300
                    transition-all duration-150 ml-1.5 -mt-0.5 align-middle flex-shrink-0`}
        aria-label={title ? `Help: ${title}` : 'Help'}
      >
        ?
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            ref={modalRef}
            className="bg-[#0e1117] border border-amber-400/30 max-w-md w-full p-6 relative normal-case tracking-normal"
          >
            {title && (
              <h3 className="text-sm font-mono text-amber-400 tracking-wider mb-3">
                {title}
              </h3>
            )}
            <div className="text-sm text-white/70 leading-relaxed space-y-2">
              {typeof content === 'string' ? (
                content.split('\n\n').map((p, i) => <p key={i}>{p}</p>)
              ) : (
                content
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-4 text-white/30 hover:text-white/70 text-lg transition-colors"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
