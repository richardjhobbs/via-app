'use client';

import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', style, ...props }, ref) => (
    <div style={{ width: '100%' }}>
      {label && (
        <label style={{
          display: 'block',
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          marginBottom: 8,
        }}>
          {label}
        </label>
      )}
      <input
        ref={ref}
        className={className}
        style={{
          width: '100%',
          background: 'var(--paper)',
          border: `1px solid ${error ? '#b5453a' : 'var(--line-strong)'}`,
          padding: '12px 14px',
          fontSize: 14,
          fontFamily: 'inherit',
          color: 'var(--ink)',
          outline: 'none',
          transition: 'border-color 0.15s',
          ...style,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ink)'; props.onFocus?.(e); }}
        onBlur={(e) => { e.currentTarget.style.borderColor = error ? '#b5453a' : 'var(--line-strong)'; props.onBlur?.(e); }}
        {...props}
      />
      {error && <p style={{ marginTop: 6, fontSize: 11, color: '#b5453a', fontFamily: 'var(--font-jetbrains), monospace' }}>{error}</p>}
    </div>
  )
);
Input.displayName = 'Input';
