import { FaqClient } from './FaqClient';

export const dynamic = 'force-static';

export const metadata = {
  title: 'FAQ, VIA',
  description: 'How VIA works for sellers and for buyers. Train your agent, feed it rich data, and settle in USDC on Base.',
};

export default function FaqIndex() {
  return <FaqClient />;
}
