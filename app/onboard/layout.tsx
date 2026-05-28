import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Onboard — VIA',
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

/**
 * Shared step indicator used by every wizard step page. `current` is 1-indexed.
 * Kept in the layout file so all steps import a single source of truth for the
 * step labels.
 */
export function OnboardSteps({ current }: { current: 1 | 2 | 3 | 4 | 5 }) {
  const steps = ['Account', 'Business', 'Wallet', 'Catalog', 'Sales Agent'] as const;
  return (
    <ol className="flex items-center gap-2 mb-10 text-xs font-mono tracking-widest uppercase">
      {steps.map((label, i) => {
        const n = i + 1;
        const done    = n < current;
        const active  = n === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={
                active ? 'text-neutral-900'
                  : done  ? 'text-neutral-500'
                          : 'text-neutral-300'
              }
            >
              {String(n).padStart(2, '0')} · {label}
            </span>
            {n < steps.length && <span className="text-neutral-300">/</span>}
          </li>
        );
      })}
    </ol>
  );
}
