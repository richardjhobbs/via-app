import Link from 'next/link';
import { Wordmark } from '@/components/app/Wordmark';
import { getInviteByToken } from '@/lib/app/seller-team';
import { InviteAcceptForm } from './InviteAcceptForm';

export const dynamic = 'force-dynamic';

export default async function SellerInviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await getInviteByToken(token);

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home"><Wordmark /></Link>
          <span className="text-xs font-mono tracking-widest uppercase text-ink-3">Seller</span>
        </div>
      </header>

      <section className="flex-1 flex items-start justify-center px-6 py-16">
        <div className="w-full max-w-md px-6">
          {!invite ? (
            <>
              <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Invitation</p>
              <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-2">This link is no longer valid.</h1>
              <p className="text-sm text-ink-2 mb-8">
                The invitation may have expired, been revoked, or already been used. Ask the store owner to send a fresh invite.
              </p>
              <Link href="/seller/login" className="btn justify-center">Go to sign in</Link>
            </>
          ) : (
            <>
              <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">
                Join {invite.sellerName}
              </p>
              <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-2">
                You&apos;ve been invited.
              </h1>
              <p className="text-sm text-ink-2 mb-8">
                You&apos;re joining <span className="text-ink">{invite.sellerName}</span> as a{' '}
                <span className="text-ink">{invite.role === 'admin' ? 'admin' : 'viewer'}</span>, signed in as{' '}
                <span className="font-mono text-ink">{invite.email}</span>.
              </p>
              <InviteAcceptForm
                token={token}
                email={invite.email}
                needsAccount={invite.needsAccount}
              />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
