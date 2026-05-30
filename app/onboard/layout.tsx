import type { ReactNode } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/app/Wordmark';

export const metadata = {
  title: 'Onboard · VIA',
};

export default function OnboardLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home"><Wordmark /></Link>
          <a
            href="https://getvia.xyz"
            className="uc-mono text-ink-3 hover:text-ink transition-colors"
          >
            getvia.xyz ↗
          </a>
        </div>
      </header>
      {children}
    </main>
  );
}

// OnboardSteps moved to ./OnboardSteps.tsx. Next.js disallows importing
// named exports from layout.tsx into 'use client' files.
