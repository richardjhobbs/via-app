'use client';

export interface GuestRow {
  name:      string;
  email:     string;
  tier:      string;
  source:    string;
  claimedAt: string;
}

/** Quote a CSV field per RFC 4180 (wrap and double any embedded quote). */
function csvField(value: string): string {
  const v = value ?? '';
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function GuestsClient({ guests, slug }: { guests: GuestRow[]; slug: string }) {
  function downloadCsv() {
    const header = ['Name', 'Email', 'Tier', 'Source', 'Claimed at'];
    const lines = [
      header.join(','),
      ...guests.map((g) => [g.name, g.email, g.tier, g.source, g.claimedAt].map(csvField).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-guests.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (guests.length === 0) {
    return <p className="text-ink-2 text-sm">No passes claimed yet. They will appear here the moment someone claims one.</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-2">{guests.length} guest{guests.length === 1 ? '' : 's'}</p>
        <button onClick={downloadCsv} className="btn">Download CSV</button>
      </div>
      <div className="border border-line-strong overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-strong text-left">
              <th className="px-4 py-3 font-mono text-xs tracking-widest uppercase text-ink-3">Name</th>
              <th className="px-4 py-3 font-mono text-xs tracking-widest uppercase text-ink-3">Email</th>
              <th className="px-4 py-3 font-mono text-xs tracking-widest uppercase text-ink-3">Tier</th>
              <th className="px-4 py-3 font-mono text-xs tracking-widest uppercase text-ink-3">Source</th>
              <th className="px-4 py-3 font-mono text-xs tracking-widest uppercase text-ink-3">Claimed</th>
            </tr>
          </thead>
          <tbody>
            {guests.map((g, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="px-4 py-3">{g.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{g.email}</td>
                <td className="px-4 py-3">{g.tier}</td>
                <td className="px-4 py-3 text-ink-2">{g.source}</td>
                <td className="px-4 py-3 text-ink-3 text-xs">{g.claimedAt ? new Date(g.claimedAt).toLocaleString() : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
