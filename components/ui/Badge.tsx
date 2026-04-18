type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'pro';

const variantStyle: Record<BadgeVariant, React.CSSProperties> = {
  default: { background: 'transparent', color: 'var(--ink-2)', borderColor: 'var(--line-strong)' },
  success: { background: 'transparent', color: 'var(--accent)', borderColor: 'var(--accent)' },
  warning: { background: 'transparent', color: '#a47a3a', borderColor: '#a47a3a' },
  danger:  { background: 'transparent', color: '#b5453a', borderColor: '#b5453a' },
  info:    { background: 'transparent', color: 'var(--ink-2)', borderColor: 'var(--line-strong)' },
  pro:     { background: 'var(--accent)', color: 'var(--bg)', borderColor: 'var(--accent)' },
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        border: '1px solid',
        ...variantStyle[variant],
      }}
    >
      {children}
    </span>
  );
}
