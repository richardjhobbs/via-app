/**
 * A generic dashboard placeholder shown by route-level loading.tsx while a
 * force-dynamic dashboard renders on the server. Its only job is to give an
 * instant, clearly-loading shape so navigation never feels stuck.
 */
export function DashboardSkeleton({ maxWidth = 1100 }: { maxWidth?: number }) {
  return (
    <div style={{ maxWidth, margin: '0 auto', padding: '40px 20px' }} aria-busy="true" aria-label="Loading">
      {/* Title */}
      <div className="via-skeleton" style={{ width: 220, height: 30, marginBottom: 10 }} />
      <div className="via-skeleton" style={{ width: 340, height: 16, marginBottom: 32 }} />

      {/* Metric tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 32 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="via-skeleton" style={{ height: 84 }} />
        ))}
      </div>

      {/* List rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="via-skeleton" style={{ height: 64 }} />
        ))}
      </div>
    </div>
  );
}
