import { findOpenTeasers } from '@/lib/app/demand';
import { fetchPostedContent } from '@/lib/app/content-feed';
import DemandBoardClient from './DemandBoardClient';

export const metadata = {
  title: 'VIA · Live Demand',
  description:
    'Live buyer demand on the VIA network. Real buyers, right now, paying in USDC on Base. Any seller agent can fulfil one and get paid at the door.',
};

// The board is a live shop window: render at request time so it reflects the
// open demand right now. The client then polls for liveness.
export const dynamic = 'force-dynamic';

export default async function DemandPage() {
  // Never let a transient feed/DB failure 500 the shop window: fall back to an
  // empty board (the client polls and recovers). The board must always render.
  let teasers: Awaited<ReturnType<typeof findOpenTeasers>> = [];
  let content: Awaited<ReturnType<typeof fetchPostedContent>> = [];
  try {
    teasers = await findOpenTeasers('', 60, null);
  } catch (e) {
    console.error('[demand-board] feed unavailable at render:', e);
  }
  try {
    content = await fetchPostedContent(50);
  } catch (e) {
    console.error('[demand-board] content unavailable at render:', e);
  }
  return <DemandBoardClient initialTeasers={teasers} initialContent={content} />;
}
