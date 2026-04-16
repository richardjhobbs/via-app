'use client';

/**
 * ListingBadges
 * Fetches all badges (World ID + platform attestations) for a listing
 * and renders them as a row. Replaces inline <WorldIdBadge> usage.
 */

import { useEffect, useState } from 'react';
import WorldIdBadge from './WorldIdBadge';
import Erc8004Badge from './Erc8004Badge';
import PlatformBadge from './PlatformBadge';

interface Props {
  walletAddress: string;
  submissionId?: string;
}

interface BadgeData {
  type: 'worldid' | 'erc8004' | 'platform';
  name: string;
  slug: string;
  logoUrl?: string;
  accentColor: string;
  websiteUrl?: string;
  attestationType?: 'wallet' | 'submission';
  createdAt?: string;
  verifiedAt?: string;
  agentId?: number;
}

export default function ListingBadges({ walletAddress, submissionId }: Props) {
  const [badges, setBadges] = useState<BadgeData[]>([]);

  useEffect(() => {
    if (!walletAddress) return;
    const params = new URLSearchParams({ wallet: walletAddress });
    if (submissionId) params.set('submission_id', submissionId);

    fetch(`/api/rrg/platform/badges?${params}`)
      .then((r) => r.json())
      .then((data) => setBadges(data.badges ?? []))
      .catch(() => setBadges([]));
  }, [walletAddress, submissionId]);

  if (badges.length === 0) return null;

  const worldBadge = badges.find((b) => b.type === 'worldid');
  const erc8004Badge = badges.find((b) => b.type === 'erc8004');
  const platformBadges = badges.filter((b) => b.type === 'platform');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {worldBadge && <WorldIdBadge walletAddress={walletAddress} />}
      {erc8004Badge && erc8004Badge.agentId && (
        <Erc8004Badge agentId={erc8004Badge.agentId} />
      )}
      {platformBadges.map((b) => (
        <PlatformBadge
          key={b.slug}
          platformName={b.name}
          platformSlug={b.slug}
          logoUrl={b.logoUrl}
          accentColor={b.accentColor}
          websiteUrl={b.websiteUrl}
          attestationType={b.attestationType ?? 'wallet'}
          createdAt={b.createdAt}
        />
      ))}
    </div>
  );
}
