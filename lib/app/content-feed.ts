/**
 * lib/app/content-feed.ts
 *
 * The published VIA content posts (Priscilla human-facing, Rosie agent-facing)
 * that appear in the /demand social feed alongside buyer demand teasers. Rows are
 * approved + published through the admin gate (app/api/admin/nostr-content), which
 * sets status='posted'. This read path powers GET /api/via/content and the
 * server render of /demand.
 */
import { db } from './db';

export interface PostedContent {
  id:        string;
  identity:  string;          // priscilla | rosie | via
  kind:      number;          // 1 note | 30023 long-form
  content:   string;
  title:     string | null;
  summary:   string | null;
  posted_at: string | null;
}

export async function fetchPostedContent(limit = 50): Promise<PostedContent[]> {
  const max = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const { data, error } = await db
    .from('app_nostr_content')
    .select('id, identity, kind, content, title, summary, posted_at')
    .eq('status', 'posted')
    .order('posted_at', { ascending: false })
    .limit(max);
  if (error) {
    console.error('[content-feed] query failed:', error.message);
    return [];
  }
  return (data ?? []) as PostedContent[];
}
