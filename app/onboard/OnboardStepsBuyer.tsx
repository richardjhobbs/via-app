/**
 * Step indicator for the buyer wizard (4 steps vs the seller's 5).
 */
export function OnboardStepsBuyer({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = ['Account', 'Handle', 'Wallets', 'Buying Agent'] as const;
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
