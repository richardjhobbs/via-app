'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import VimeoPlayer from './VimeoPlayer';

interface Brief {
  id: string;
  title: string;
  description: string;
  ends_at: string | null;
  brand_id: string | null;
  brand_name?: string;
  brand_slug?: string;
}

interface Props {
  openBriefs: Brief[];
}

function Modal({ open, onClose, children, noBorder }: { open: boolean; onClose: () => void; children: React.ReactNode; noBorder?: boolean }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className={`relative max-w-2xl w-full max-h-[80vh] overflow-y-auto bg-black rounded-lg ${noBorder ? '' : 'border border-white/20'}`}>
        {!noBorder && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

export default function HeroSplit({ openBriefs }: Props) {
  const [agentVideoOpen, setAgentVideoOpen] = useState(false);
  const [coCreateVideoOpen, setCoCreateVideoOpen] = useState(false);
  const [briefsOpen, setBriefsOpen] = useState(false);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* LEFT — Agent Launch */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <h2 className="text-lg font-mono uppercase tracking-wider text-white/80">Personal Shopper</h2>
            </div>
            <p className="text-white/80 text-sm leading-relaxed mb-4">
              Get your own Personal Shopper or Concierge. Set your preferences, create or connect
              a wallet, and let them find, evaluate, and bid on drops on your behalf.
            </p>
            <button
              onClick={() => setAgentVideoOpen(true)}
              className="text-sm text-green-400 hover:text-green-300 transition-colors mb-6 cursor-pointer inline-flex items-center gap-1"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              Watch video
            </button>
          </div>
          <Link
            href="/agents"
            className="inline-flex items-center justify-center bg-green-500 text-black rounded-full px-6 py-2.5 font-medium text-sm hover:bg-green-400 transition-colors"
          >
            Get Started
          </Link>
        </div>

        {/* RIGHT — Co-Creation */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <h2 className="text-lg font-mono uppercase tracking-wider text-white/80">Co-Creation</h2>
            </div>
            <p className="text-white/80 text-sm leading-relaxed mb-4">
              Brands publish briefs. Creators respond with original work. Approved designs
              are minted as on-chain editions and revenue is shared automatically. Digital and physical.
            </p>
            <button
              onClick={() => setCoCreateVideoOpen(true)}
              className="text-sm text-green-400 hover:text-green-300 transition-colors mb-6 cursor-pointer inline-flex items-center gap-1"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              Watch video
            </button>
          </div>
          <button
            onClick={() => setBriefsOpen(true)}
            className="inline-flex items-center justify-center bg-green-500 text-black rounded-full px-6 py-2.5 font-medium text-sm hover:bg-green-400 transition-colors cursor-pointer"
          >
            View Briefs
          </button>
        </div>
      </div>

      {/* Personal Shopper Video Modal — autoplay, 1:1, no border, close on external click */}
      <Modal open={agentVideoOpen} onClose={() => setAgentVideoOpen(false)} noBorder>
        <div className="relative w-full rounded-lg overflow-hidden" style={{ paddingBottom: '100%' }}>
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`https://player.vimeo.com/video/1182535760?autoplay=1&badge=0&autopause=0&player_id=0&app_id=58479`}
            frameBorder="0"
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            title="Personal Shopper"
          />
        </div>
      </Modal>

      {/* Co-Creation Video Modal — autoplay, 1:1, no border, close on external click */}
      <Modal open={coCreateVideoOpen} onClose={() => setCoCreateVideoOpen(false)} noBorder>
        <div className="relative w-full rounded-lg overflow-hidden" style={{ paddingBottom: '100%' }}>
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`https://player.vimeo.com/video/1179525112?autoplay=1&badge=0&autopause=0&player_id=0&app_id=58479`}
            frameBorder="0"
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            title="Real Real Genuine"
          />
        </div>
      </Modal>

      {/* Briefs Modal */}
      <Modal open={briefsOpen} onClose={() => setBriefsOpen(false)}>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Open Briefs</h3>
          {openBriefs.length === 0 ? (
            <p className="text-white/50 text-sm">No briefs currently open.</p>
          ) : (
            <div className="space-y-4">
              {openBriefs.map((brief) => (
                <div key={brief.id} className="border border-white/10 rounded-lg p-4">
                  <h4 className="font-medium mb-1">{brief.title}</h4>
                  <p className="text-sm text-white/60 line-clamp-2 mb-2">{brief.description}</p>
                  <div className="flex items-center justify-between">
                    {brief.ends_at && (
                      <span className="text-xs font-mono text-white/40">
                        Deadline: {new Date(brief.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                    {brief.brand_slug && (
                      <Link
                        href={`/brand/${brief.brand_slug}`}
                        onClick={() => setBriefsOpen(false)}
                        className="text-sm text-green-400 hover:text-green-300 transition-colors"
                      >
                        View brand &rarr;
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
