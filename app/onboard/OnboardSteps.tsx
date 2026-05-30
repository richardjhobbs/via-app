/**
 * Step indicator strip used by every wizard page. Server-safe (no hooks).
 *
 * Lives in its own file because Next.js disallows importing named exports
 * from a layout.tsx into 'use client' files.
 */
export function OnboardSteps({ current }: { current: 1 | 2 | 3 | 4 | 5 }) {
  const steps = ['Account', 'Business', 'Wallet', 'Catalog', 'Sales Agent'] as const;
  return (
    <ol className="flex flex-wrap items-center gap-2 mb-10 text-xs font-mono tracking-widest uppercase">
      {steps.map((label, i) => {
        const n = i + 1;
        const done   = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={
                active ? 'text-ink'
                  : done  ? 'text-accent'
                          : 'text-ink-3'
              }
            >
              {String(n).padStart(2, '0')} · {label}
            </span>
            {n < steps.length && <span className="text-ink-3">/</span>}
          </li>
        );
      })}
    </ol>
  );
}
