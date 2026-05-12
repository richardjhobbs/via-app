/**
 * lib/rrg/notion-build-log.ts
 *
 * Append a "brand live" entry to the RRG Notion Build Log continuation page
 * (`34ddbc7b67f2811690afe320fa579892`). The entry is inserted BEFORE the
 * trailing `*Last updated*` paragraph so the page footer remains the latest
 * timestamp marker.
 *
 * Format rules from feedback_notion_build_log_format.md:
 *   - Continuation page id is `34ddbc7b67f2811690afe320fa579892`
 *   - New content appended before `*Last updated*` line
 *   - We append a single paragraph block here, not a full Phase, so the
 *     hand-curated Phase structure stays intact for human edits.
 *
 * Auth: NOTION_API_KEY env var (Notion integration token).
 */

const BUILD_LOG_PAGE_ID = '34ddbc7b67f2811690afe320fa579892';
const NOTION_VERSION = '2022-06-28';
const NOTION_API = 'https://api.notion.com/v1';

interface NotionBlock {
  id: string;
  type: string;
  paragraph?: {
    rich_text?: { plain_text?: string }[];
  };
  heading_1?: { rich_text?: { plain_text?: string }[] };
  heading_2?: { rich_text?: { plain_text?: string }[] };
  heading_3?: { rich_text?: { plain_text?: string }[] };
}

export interface BrandLiveEntryParams {
  slug: string;
  name: string;
  agentId: number | null;
  walletAddress: string | null;
  tokenCount: number | null;
  storefrontUrl: string;
}

function plainText(block: NotionBlock): string {
  const rich =
    block.paragraph?.rich_text ??
    block.heading_1?.rich_text ??
    block.heading_2?.rich_text ??
    block.heading_3?.rich_text ??
    [];
  return rich.map((r) => r.plain_text ?? '').join('');
}

async function notionFetch(path: string, init?: RequestInit): Promise<Response> {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error('NOTION_API_KEY not set');
  return fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
}

/**
 * Walk the page children (paginated, up to 200 blocks) to find the
 * `*Last updated*` paragraph and the block immediately before it. Returns
 * the id of the preceding block — used as `after` when inserting a new
 * paragraph just above the timestamp line.
 *
 * If `*Last updated*` is not found, returns null and the caller appends
 * at the end of the page.
 */
async function findInsertAnchor(): Promise<string | null> {
  let cursor: string | undefined;
  const blocks: NotionBlock[] = [];
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({ page_size: '100' });
    if (cursor) qs.set('start_cursor', cursor);
    const resp = await notionFetch(`/blocks/${BUILD_LOG_PAGE_ID}/children?${qs.toString()}`);
    if (!resp.ok) {
      throw new Error(`Notion children fetch failed (${resp.status}): ${await resp.text()}`);
    }
    const json = (await resp.json()) as { results?: NotionBlock[]; has_more?: boolean; next_cursor?: string | null };
    blocks.push(...(json.results ?? []));
    if (!json.has_more) break;
    cursor = json.next_cursor ?? undefined;
  }

  const lastUpdatedIdx = blocks.findIndex((b) => /^\s*\*Last updated/i.test(plainText(b)));
  if (lastUpdatedIdx <= 0) return null;
  return blocks[lastUpdatedIdx - 1].id;
}

/**
 * Append a single rich-text paragraph announcing a new live brand. Best
 * effort: any failure throws so the orchestrator can log via Promise.allSettled.
 */
export async function appendBrandLiveEntry(p: BrandLiveEntryParams): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const agent = p.agentId != null ? `#${p.agentId}` : 'unregistered';
  const wallet = p.walletAddress ?? 'no wallet';
  const tokens = p.tokenCount != null ? `${p.tokenCount} product${p.tokenCount === 1 ? '' : 's'}` : 'no products yet';
  const text = `Brand live: ${p.name} (${p.slug}) — agent ${agent}, wallet ${wallet}, ${tokens}. Storefront ${p.storefrontUrl}. Auto-logged ${today}.`;

  const newBlock = {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: { content: text },
          annotations: { bold: false, italic: false, code: false },
        },
      ],
    },
  };

  const after = await findInsertAnchor();
  const body: Record<string, unknown> = { children: [newBlock] };
  if (after) body.after = after;

  const resp = await notionFetch(`/blocks/${BUILD_LOG_PAGE_ID}/children`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`Notion append failed (${resp.status}): ${await resp.text()}`);
  }
}
