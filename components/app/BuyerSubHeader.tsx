import Link from 'next/link';
import { Wordmark } from '@/components/app/Wordmark';
import ThemeToggle from '@/components/app/ThemeToggle';
import MatchNotifyDot from '@/components/app/MatchNotifyDot';

/**
 * Shared header for the buyer admin sub-pages (Briefs, Train, Credits, Matches).
 * Carries the back-to-dashboard link with the flashing new-results dot, the
 * sign-out form, and the day/night toggle , so every sub-page has the same
 * controls as the dashboard top nav.
 */
export function BuyerSubHeader({ handle, buyerId }: { handle: string; buyerId: string }) {
  return (
    <header className="border-b border-line">
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
        <Link href={`/buyer/${handle}/admin`} aria-label="Back to dashboard" className="inline-flex items-center gap-3">
          <Wordmark />
          <span className="text-xs font-mono tracking-widest uppercase text-ink-3 inline-flex items-center">
            <span aria-hidden>&larr;</span>&nbsp;Dashboard
            <MatchNotifyDot buyerId={buyerId} />
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <form action="/api/buyer/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink transition-colors">
              Sign out
            </button>
          </form>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
