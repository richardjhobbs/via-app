'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

export default function LoginButton() {
  const [open, setOpen] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Check if user has an active agent session
  useEffect(() => {
    fetch('/api/agent/session')
      .then(r => { if (r.ok) setHasSession(true); })
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function handleSignOut() {
    await fetch('/api/agent/session', { method: 'DELETE' });
    setHasSession(false);
    setOpen(false);
    window.location.href = '/rrg';
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          if (hasSession) {
            setOpen(!open);
          } else {
            setOpen(!open);
          }
        }}
        className="text-base text-white/80 hover:text-white transition-colors"
      >
        {hasSession ? 'Sign Out' : 'Login'}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 border border-white/20 bg-black z-50 shadow-xl">
          {hasSession ? (
            <button
              onClick={handleSignOut}
              className="block w-full text-left px-4 py-3 text-base text-white/80 hover:text-white hover:bg-white/5
                         transition-colors cursor-pointer"
            >
              Sign out
              <span className="block text-sm text-white/50 mt-0.5">End your session</span>
            </button>
          ) : (
            <>
              <Link
                href="/agents"
                onClick={() => setOpen(false)}
                className="block px-4 py-3 text-base text-white/80 hover:text-white hover:bg-white/5
                           transition-colors border-b border-white/10"
              >
                Concierge
                <span className="block text-sm text-white/50 mt-0.5">Your VIA agent across the network</span>
              </Link>
              <Link
                href="/brand/login"
                onClick={() => setOpen(false)}
                className="block px-4 py-3 text-base text-white/80 hover:text-white hover:bg-white/5
                           transition-colors border-b border-white/10"
              >
                Brand Partner
                <span className="block text-sm text-white/50 mt-0.5">Manage briefs & products</span>
              </Link>
              <Link
                href="/creator"
                onClick={() => setOpen(false)}
                className="block px-4 py-3 text-base text-white/80 hover:text-white hover:bg-white/5
                           transition-colors"
              >
                Creator Partner
                <span className="block text-sm text-white/50 mt-0.5">Co-create with and Promote Brands</span>
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
