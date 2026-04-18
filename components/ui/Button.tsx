'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantStyle: Record<Variant, React.CSSProperties> = {
  primary: {
    background: 'var(--ink)',
    color: 'var(--bg)',
    border: '1px solid var(--ink)',
  },
  secondary: {
    background: 'transparent',
    color: 'var(--ink)',
    border: '1px solid var(--line-strong)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--ink-2)',
    border: '1px solid transparent',
  },
  danger: {
    background: '#b5453a',
    color: '#fff',
    border: '1px solid #b5453a',
  },
};

const sizeStyle: Record<Size, React.CSSProperties> = {
  sm: { padding: '8px 14px', fontSize: 11 },
  md: { padding: '12px 20px', fontSize: 12 },
  lg: { padding: '14px 24px', fontSize: 13 },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, children, disabled, className = '', style, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        fontFamily: 'inherit',
        fontWeight: 500,
        letterSpacing: '0.04em',
        borderRadius: 0,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.55 : 1,
        transition: 'all 0.2s',
        ...variantStyle[variant],
        ...sizeStyle[size],
        ...style,
      }}
      {...props}
    >
      {loading && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="50 50" opacity="0.3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  )
);
Button.displayName = 'Button';
