'use client';

interface StepperProps {
  steps: string[];
  currentStep: number;
}

export function Stepper({ steps, currentStep }: StepperProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36, flexWrap: 'wrap' }}>
      {steps.map((label, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 28, height: 28,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 99,
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: 10,
                letterSpacing: 0,
                transition: 'all 0.15s',
                background: done ? 'var(--accent)' : active ? 'var(--ink)' : 'transparent',
                color: done ? 'var(--bg)' : active ? 'var(--bg)' : 'var(--ink-3)',
                border: `1px solid ${done ? 'var(--accent)' : active ? 'var(--ink)' : 'var(--line-strong)'}`,
              }}
            >
              {done ? '✓' : i + 1}
            </div>
            <span
              style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                display: 'none',
                color: done ? 'var(--accent)' : active ? 'var(--ink)' : 'var(--ink-3)',
              }}
              className="stepper-label"
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <div
                style={{
                  width: 32,
                  height: 1,
                  background: done ? 'var(--accent)' : 'var(--line)',
                }}
              />
            )}
          </div>
        );
      })}
      <style>{`
        @media (min-width: 640px) {
          .stepper-label { display: inline !important; }
        }
      `}</style>
    </div>
  );
}
