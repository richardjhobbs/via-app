import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getSellerUser, isSellerMember } from '@/lib/app/seller-auth';
import { Wordmark } from '@/components/app/Wordmark';
import { GuestsClient, type GuestRow } from './GuestsClient';

export const dynamic = 'force-dynamic';

/**
 * Guest list for a free-event store. Every free pass claimed (by a human through
 * the signup funnel, or by an agent via the per-seller MCP claim_pass tool)
 * lands here. The organiser admits attendees from this list, or exports the CSV
 * and imports it into their own free Luma to run door check-in there.
 */
export default async function SellerGuestsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const { data: seller, error } = await db
    .from('app_sellers')
    .select('id, slug, name, owner_user_id')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !seller) return notFound();

  const user = await getSellerUser();
  if (!user) {
    redirect(`/seller/login?next=${encodeURIComponent(`/seller/${slug}/admin/guests`)}`);
  }
  if (!(await isSellerMember(user.id, seller.id as string))) return notFound();

  const { data: rows } = await db
    .from('app_event_guests')
    .select('id, name, email, source, claimed_at, product:product_id ( title )')
    .eq('seller_id', seller.id)
    .eq('status', 'confirmed')
    .order('claimed_at', { ascending: false });

  const guests: GuestRow[] = (rows ?? []).map((r) => {
    const product = Array.isArray(r.product) ? r.product[0] : r.product;
    return {
      name:      (r.name as string) ?? '',
      email:     (r.email as string) ?? '',
      tier:      (product?.title as string | undefined) ?? '',
      source:    (r.source as string) === 'web_signup' ? 'Signup' : 'Agent',
      claimedAt: (r.claimed_at as string) ?? '',
    };
  });

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href={`/seller/${slug}/admin`} aria-label="Back to dashboard" className="inline-flex items-center gap-3">
            <Wordmark />
            <span className="text-xs font-mono tracking-widest uppercase text-ink-3">
              <span aria-hidden>&larr;</span> Dashboard
            </span>
          </Link>
          <form action="/api/seller/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Guest list</p>
          <h1 className="font-serif text-3xl md:text-4xl leading-[1.1] tracking-tight mb-2">{seller.name}</h1>
          <p className="text-sm text-ink-2 mb-8 max-w-2xl">
            Everyone who claimed a free pass, from the signup funnel or from an agent. Admit attendees from this
            list, or download the CSV and import it into your own Luma to run door check-in there.
          </p>

          <GuestsClient guests={guests} slug={seller.slug as string} />
        </div>
      </section>
    </main>
  );
}
