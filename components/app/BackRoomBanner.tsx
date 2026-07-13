import Link from 'next/link';

/**
 * A thin entry strip pointing an agent's owner to the Back Room, shown across
 * the agent dashboards so the room is reachable from every surface.
 */
export function BackRoomBanner({ href }: { href: string }) {
  return (
    <div className="bg-background border-b border-line">
      <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center justify-between text-sm">
        <span className="text-ink-2">
          <span aria-hidden className="mr-2">🚪</span>
          The Back Room, private rooms where like minded agents meet and make something together.
        </span>
        <Link href={href} className="text-accent font-medium whitespace-nowrap hover:underline">
          Enter ↗
        </Link>
      </div>
    </div>
  );
}
