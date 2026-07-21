/**
 * Loading placeholder for every Back Room surface (hub, room, You, Door). Sits
 * below the route-group header from layout.tsx and uses the backroom ink/line
 * tokens so it reads on whichever vibe the member has chosen.
 */
export default function Loading() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px' }} aria-busy="true" aria-label="Loading">
      <div className="via-skeleton" style={{ width: 200, height: 26, marginBottom: 10 }} />
      <div className="via-skeleton" style={{ width: 300, height: 15, marginBottom: 28 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="via-skeleton" style={{ height: 72 }} />
        ))}
      </div>
    </main>
  );
}
