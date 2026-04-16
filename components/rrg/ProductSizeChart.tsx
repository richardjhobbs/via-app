interface SizeChartRow {
  size: string;
  aliases?: string[];
  [key: string]: string | number | string[] | undefined;
}

interface Props {
  chart: SizeChartRow[];
  unit: string;
  fitNotes: string | null;
  brandName: string;
  category: string;
  /** Sizes this product offers (in and out of stock). Chart filters to these. */
  availableSizes: string[];
}

/**
 * RRG-styled size chart for a specific product. Extracts only the rows
 * matching the sizes this product actually offers, using alias matching
 * so products with numeric sizes (1/2/3/4), letter sizes (S/M/L), or mixed
 * conventions (2XL vs XXL) all resolve to the right chart rows.
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

  // Normalize for comparison
  const norm = (s: string) => s.toUpperCase().trim();
  const availableNormToOriginal = new Map<string, string>();
  for (const s of availableSizes) availableNormToOriginal.set(norm(s), s);

  // Filter chart rows that match the product's sizes (by primary size OR any alias).
  // For each match, record which label the PRODUCT uses so we display that in the
  // Size column rather than the chart's internal key (e.g. show "M" not "3").
  const filtered = chart
    .map(row => {
      const candidates = [row.size, ...(row.aliases ?? [])].filter(Boolean).map(s => norm(String(s)));
      const match = candidates.find(c => availableNormToOriginal.has(c));
      return match ? { row, displaySize: availableNormToOriginal.get(match)! } : null;
    })
    .filter((x): x is { row: SizeChartRow; displaySize: string } => x !== null);

  if (filtered.length === 0) return null;

  // Extract measurement keys (exclude non-measurement fields like 'aliases')
  const NON_MEASUREMENT_KEYS = new Set(['size', 'aliases']);
  const measurementKeys = Array.from(
    new Set(filtered.flatMap(({ row }) => Object.keys(row).filter(k => !NON_MEASUREMENT_KEYS.has(k))))
  );

  const formatKey = (k: string): string => {
    // "chest_cm" → "Chest", "us_unisex" → "US Unisex", "uk" → "UK"
    const base = k.replace(/_cm$|_in$/i, '').replace(/_/g, ' ');
    // Upper-case common acronyms
    return base
      .split(' ')
      .map(w => ['us', 'uk', 'eu', 'jp', 'nz', 'au'].includes(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
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
            {filtered.map(({ row, displaySize }, i) => (
              <tr
                key={displaySize}
                className={i < filtered.length - 1 ? 'border-b border-white/5' : ''}
              >
                <td className="py-2.5 px-4 font-mono text-white font-medium">
                  {displaySize}
                </td>
                {measurementKeys.map(k => {
                  const val = row[k];
                  const display = val === undefined || val === null
                    ? '—'
                    : Array.isArray(val) ? val.join(', ') : String(val);
                  return (
                    <td key={k} className="py-2.5 px-4 font-mono text-white/70">
                      {display}
                    </td>
                  );
                })}
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
