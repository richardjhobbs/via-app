import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Onboard · VIA',
};

export default function OnboardLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center">
            <Image
              src="/vialogowhite.png"
              alt="VIA"
              width={72}
              height={28}
              priority
              className="h-7 w-auto"
            />
          </Link>
          <a
            href="https://getvia.xyz"
            className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors"
          >
            getvia.xyz
          </a>
        </div>
      </header>
      {children}
    </main>
  );
}

// OnboardSteps moved to ./OnboardSteps.tsx. Next.js disallows importing
// named exports from layout.tsx into 'use client' files.
