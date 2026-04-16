interface SizeChartRow {
  size: string;
  [key: string]: string | number | undefined;
}

interface Props {
  chart: SizeChartRow[];
  unit: string;
  fitNotes: string | null;
  brandName: string;
  category: string;
  /** Only show rows for sizes this product offers */
  availableSizes: string[];
}

/**
 * RRG-styled size chart for a specific product. Extracts only the sizes
 * that this product offers from the brand's category chart.
 *
 * Renders as a table in the Physical Product Details section.
 */
export default function ProductSizeChart({
  chart,
  unit,
  fitNotes,
  brandName,
  category,
  availableSizes,
}: Props) {
  if (!chart || chart.length === 0 || availableSizes.length === 0) return null;

  // Normalize available sizes for comparison
  const availableSet = new Set(availableSizes.map(s => s.toUpperCase()));

  // Filter chart to only rows matching available sizes
  const filtered = chart.filter(row =>
    availableSet.has(String(row.size ?? '').toUpperCase())
  );

  if (filtered.length === 0) return null;

  // Extract measurement keys (all keys except 'size'), formatted for display
  const measurementKeys = Array.from(
    new Set(filtered.flatMap(r => Object.keys(r).filter(k => k !== 'size')))
  );

  const formatKey = (k: string): string => {
    // "chest_cm" → "Chest"
    return k.replace(/_cm$|_in$/i, '').replace(/_/g, ' ');
  };

  return (
    <div className="mt-6 border border-white/10 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-baseline justify-between gap-4 flex-wrap">
        <p className="text-sm font-mono uppercase tracking-[0.2em] text-white/70">
          Size chart — {category}
        </p>
        <p className="text-xs font-mono text-white/40">
          All measurements in {unit}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-2 px-4 font-mono text-xs uppercase tracking-wider text-white/50">
                Size
              </th>
              {measurementKeys.map(k => (
                <th key={k} className="text-left py-2 px-4 font-mono text-xs uppercase tracking-wider text-white/50">
                  {formatKey(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr
                key={row.size as string}
                className={i < filtered.length - 1 ? 'border-b border-white/5' : ''}
              >
                <td className="py-2.5 px-4 font-mono text-white font-medium">
                  {row.size}
                </td>
                {measurementKeys.map(k => (
                  <td key={k} className="py-2.5 px-4 font-mono text-white/70">
                    {row[k] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fitNotes && (
        <div className="px-4 py-3 border-t border-white/10 bg-white/[0.02]">
          <p className="text-xs font-mono uppercase tracking-wider text-white/40 mb-1">
            Fit notes
          </p>
          <p className="text-sm text-white/70 leading-relaxed">
            {fitNotes}
          </p>
        </div>
      )}

      <div className="px-4 py-2 border-t border-white/10 bg-white/[0.02]">
        <p className="text-xs font-mono text-white/40">
          Source: {brandName} universal sizing
        </p>
      </div>
    </div>
  );
}
