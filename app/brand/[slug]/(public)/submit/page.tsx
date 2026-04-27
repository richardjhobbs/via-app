import { getBrandBySlug, getSubmittableBriefs } from '@/lib/rrg/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import SubmitForm from '@/components/rrg/SubmitForm';

export const dynamic = 'force-dynamic';

export default async function BrandSubmitPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ brief?: string }>;
}) {
  const { slug } = await params;
  const { brief: briefId } = await searchParams;
  const brand = await getBrandBySlug(slug);
  if (!brand || brand.status !== 'active') return notFound();

  // Fetch only this brand's active, non-expired briefs
  const briefs = await getSubmittableBriefs(brand.id);

  // If a specific brief was selected (via query param) or there's only one, show form
  if (briefId || briefs.length <= 1) {
    return (
      <SubmitForm
        brandId={brand.id}
        brandSlug={brand.slug}
        brandName={brand.name}
        briefId={briefId}
      />
    );
  }

  // Multiple active briefs — show a selection page scoped to this brand
  return (
    <div className="px-6 py-12 max-w-3xl mx-auto">
      <h1 className="text-2xl font-mono tracking-wider mb-3">Submit a Design</h1>
      <p className="text-base text-white/60 mb-10">
        Choose a brief from {brand.name} to respond to.
      </p>

      <div className="space-y-4">
        {briefs.map((brief) => (
          <Link
            key={brief.id}
            href={`/brand/${slug}/submit?brief=${brief.id}`}
            className="block p-6 border border-white/15 hover:border-white/40
                       transition-all group relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent
                            pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex justify-between items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <p className="text-sm font-mono uppercase tracking-[0.15em] text-white/50">
                    {brand.name}
                  </p>
                  {brief.is_current && (
                    <span className="px-2 py-0.5 text-xs font-mono uppercase tracking-wider
                                     border border-green-400/30 text-green-400/70 leading-tight">
                      Current
                    </span>
                  )}
                </div>
                <h2 className="text-xl font-light mb-2 leading-snug group-hover:opacity-80 transition-opacity">
                  {brief.title}
                </h2>
                <p className="text-base text-white/70 leading-relaxed line-clamp-2">
                  {brief.description}
                </p>
                {brief.ends_at && (
                  <p className="mt-3 text-sm font-mono text-white/50">
                    Deadline:{' '}
                    {new Date(brief.ends_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                )}
              </div>
              <span className="text-white/40 group-hover:text-white/80 transition-colors text-xl shrink-0 mt-1">
                &rarr;
              </span>
            </div>
          </Link>
        ))}
      </div>

      <Link
        href={`/brand/${slug}`}
        className="mt-8 inline-block text-base text-white/50 hover:text-white transition-colors"
      >
        &larr; Back to {brand.name}
      </Link>
    </div>
  );
}
