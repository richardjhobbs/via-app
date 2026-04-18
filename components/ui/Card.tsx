import { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Card({ children, className = '', style, ...props }: CardProps) {
  return (
    <div
      className={className}
      style={{
        border: '1px solid var(--line)',
        background: 'var(--paper)',
        padding: 24,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
