import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/app/db';
import { getSellerUser, getSellerRole, roleAtLeast } from '@/lib/app/seller-auth';
import { listTeam } from '@/lib/app/seller-team';
import { Wordmark } from '@/components/app/Wordmark';
import { TeamClient } from './TeamClient';

export const dynamic = 'force-dynamic';

export default async function SellerTeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data: seller } = await db
    .from('app_sellers')
    .select('id, slug, name')
    .eq('slug', slug)
    .maybeSingle();
  if (!seller) return notFound();

  const user = await getSellerUser();
  if (!user) {
    redirect(`/seller/login?next=${encodeURIComponent(`/seller/${slug}/admin/team`)}`);
  }

  const role = await getSellerRole(user.id, seller.id as string);
  if (!role) return notFound();
  // Only owners and admins manage the team. Viewers can't reach this page.
  if (!roleAtLeast(role, 'admin')) return notFound();

  const { members, invites } = await listTeam(seller.id as string);

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href={`/seller/${slug}/admin`} aria-label="Back to dashboard" className="inline-flex items-center gap-3">
            <Wordmark />
          </Link>
          <span className="text-xs font-mono tracking-widest uppercase text-ink-3">{seller.name as string}</span>
        </div>
      </header>

      <section className="flex-1">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Team</p>
          <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-2">People with access.</h1>
          <p className="text-sm text-ink-2 mb-10 max-w-xl">
            Invite teammates to help run {seller.name as string}. Admins can manage products, negotiations, orders and
            settings. Viewers have read-only access. The owner manages billing and the payout wallet.
          </p>

          <TeamClient
            sellerId={seller.id as string}
            slug={slug}
            currentUserId={user.id}
            currentRole={role}
            initialMembers={members}
            initialInvites={invites}
          />
        </div>
      </section>
    </main>
  );
}
