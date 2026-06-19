import { BadgeClient } from './BadgeClient';

export const dynamic = 'force-static';

export const metadata = {
  title: 'VIA x Badge, the membership flywheel',
  description: 'How a co-branded VIA wallet pass turns each brand into a channel that brings customers onto the VIA network as active agents.',
};

export default function BadgePage() {
  return <BadgeClient />;
}
