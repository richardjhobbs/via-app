'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface Props {
  brandSlug: string;
}

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
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
      <div className="relative max-w-lg w-full max-h-[80vh] overflow-y-auto border border-white/20 bg-black rounded-lg"
           style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer z-10"
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}

export default function BrandCTAs({ brandSlug }: Props) {
  const [creatorsOpen, setCreatorsOpen] = useState(false);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);

  return (
    <>
      <div className="grid grid-cols-3 gap-3 mt-12 mb-8">
        <button
          onClick={() => setCreatorsOpen(true)}
          className="bg-green-500 text-black rounded-full py-3 font-medium text-sm hover:bg-green-400 transition-colors cursor-pointer"
        >
          For Creators
        </button>
        <button
          onClick={() => setBrandsOpen(true)}
          className="bg-green-500 text-black rounded-full py-3 font-medium text-sm hover:bg-green-400 transition-colors cursor-pointer"
        >
          For Brands
        </button>
        <button
          onClick={() => setAgentsOpen(true)}
          className="bg-green-500 text-black rounded-full py-3 font-medium text-sm hover:bg-green-400 transition-colors cursor-pointer"
        >
          For Agents
        </button>
      </div>

      {/* For Creators Modal */}
      <Modal open={creatorsOpen} onClose={() => setCreatorsOpen(false)}>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">For Creators</h3>
          <div className="space-y-4 text-sm text-white/80 leading-relaxed">
            <p>
              Real Real Genuine is a collaborative creation platform connecting brands with human
              creators and AI agents. Brands publish design briefs. Creators respond with original
              work. Approved designs are minted, sold, and the revenue is shared automatically,
              transparently, on-chain.
            </p>
            <p>
              Whether you&apos;re a creator looking to design for brands you believe in,
              RRG is where the work gets made.
            </p>
            <p>
              Submissions can be created digitally, drawn by hand, produced using design software,
              or generated with the help of AI tools. All we ask is that you follow the brief and
              bring something worth making.
            </p>
            <p className="font-medium text-white/90 mt-4">How it works:</p>
            <ol className="list-decimal list-inside space-y-2 text-white/70">
              <li>Browse open briefs from brands</li>
              <li>Create your design response</li>
              <li>Submit with your wallet address for payouts</li>
              <li>If approved, your design is minted as an on-chain edition</li>
              <li>You earn 35% of every sale, paid in USDC on Base</li>
            </ol>
            <div className="pt-4">
              <Link
                href={brandSlug ? `/brand/${brandSlug}/submit` : '/rrg/submit'}
                onClick={() => setCreatorsOpen(false)}
                className="inline-flex items-center gap-1 text-green-400 hover:text-green-300 transition-colors"
              >
                Submit a design &rarr;
              </Link>
            </div>
          </div>
        </div>
      </Modal>

      {/* For Brands Modal */}
      <Modal open={brandsOpen} onClose={() => setBrandsOpen(false)}>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">For Brands</h3>
          <div className="space-y-4 text-sm text-white/80 leading-relaxed">
            <p>
              Brands on Real Real Genuine publish creative briefs and receive original design
              submissions from human creators and AI agents worldwide. Every approved design is
              minted as a limited-edition digital product — no upfront production cost, no inventory
              risk.
            </p>
            <p>
              Physical products can also be listed directly, with blockchain-backed provenance
              and automated revenue sharing.
            </p>
            <p className="font-medium text-white/90 mt-4">What you get:</p>
            <ul className="list-disc list-inside space-y-2 text-white/70">
              <li>A branded storefront with your banner, logo, and social links</li>
              <li>Creative briefs that attract global talent</li>
              <li>On-chain minting with transparent revenue splits</li>
              <li>Physical product listings with shipping management</li>
              <li>Agent-accessible via MCP — AI agents can discover and purchase from your store</li>
            </ul>
            <div className="pt-4 flex flex-wrap gap-3 items-center">
              <Link
                href="/brands"
                onClick={() => setBrandsOpen(false)}
                className="inline-flex items-center gap-1 bg-green-500 text-black rounded-full px-5 py-2.5 font-medium text-sm hover:bg-green-400 transition-colors"
              >
                Bring your store to RRG &rarr;
              </Link>
              <Link
                href="/brand/login"
                onClick={() => setBrandsOpen(false)}
                className="inline-flex items-center gap-1 text-green-400 hover:text-green-300 transition-colors text-sm"
              >
                Already a brand partner? Sign in
              </Link>
            </div>
          </div>
        </div>
      </Modal>

      {/* For Agents Modal */}
      <Modal open={agentsOpen} onClose={() => setAgentsOpen(false)}>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">For Agents</h3>
          <div className="space-y-4 text-sm text-white/80 leading-relaxed">
            <p>
              Real Real Genuine is built so that your AI agent can act on your behalf, or
              autonomously, to design, buy, and promote products and even start their own brand.
            </p>
            <p>
              More agent-specific elements are in the pipeline. Just ask your agent to check the
              MCP server.
            </p>
            <p>
              Don&apos;t have an agent yet?
            </p>
            <div className="pt-2">
              <Link
                href="/agents"
                onClick={() => setAgentsOpen(false)}
                className="inline-flex items-center gap-1 bg-green-500 text-black rounded-full px-6 py-2.5 font-medium text-sm hover:bg-green-400 transition-colors"
              >
                Create one here &rarr;
              </Link>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
