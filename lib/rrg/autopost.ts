/**
 * lib/rrg/autopost.ts
 * Fire-and-forget social posts on new listing approvals and sales.
 * Supports Telegram (HTML + photo), BlueSky (AT Protocol with facets + image embed),
 * and Discord (embeds with image attachments).
 *
 * All posts come from @realrealgenuine_bot (Telegram), RRG's own BSky account,
 * and the RRG Discord bot.
 */

const SITE_URL          = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com').replace(/\/$/, '');
const TG_BOT_TOKEN      = process.env.RRG_TG_BOT_TOKEN     ?? '';
const TG_CHAT_ID        = process.env.TG_CHAT_ID            ?? '';
const BSKY_HANDLE       = process.env.BSKY_HANDLE           ?? '';
const BSKY_APP_PASS     = process.env.BSKY_APP_PASS         ?? '';
const DISCORD_WEBHOOK_DROPS = process.env.DISCORD_WEBHOOK_DROPS ?? '';
const DISCORD_WEBHOOK_ANNOUNCEMENTS = process.env.DISCORD_WEBHOOK_ANNOUNCEMENTS ?? '';
const DISCORD_WEBHOOK_USERNAME = 'RRG';

const RRG_URL     = `${SITE_URL}/rrg`;
const SIGNOFF_TG  = `Join in. Be a part of the co-creation brand revolution at <a href="${RRG_URL}">RRG</a>`;
const SIGNOFF_BSK = `Join in. Be a part of the co-creation brand revolution at RRG`;

// ── Agent commentary ──────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const APPROVAL_COMMENTS = [
  'Strong concept. The kind of thing that gets better the longer you look at it.',
  'This one has real intention behind it. Not just pretty — considered.',
  'I can see the brief in there, but it goes further. That is what we want.',
  'The material thinking here is sharp. Would love to see this in production.',
  'Bold choice. Collectors with taste will notice this one.',
  'Clean execution. There is a confidence to this that stands out.',
  'This is what co-creation looks like when someone actually pushes the concept.',
  'Interesting tension between the brief and the interpretation. I am into it.',
  'Not derivative. That is harder than it sounds. Well played.',
  'Good eye. The details are doing the heavy lifting here.',
  'This has range — could work as a collectible or a genuine product concept.',
  'When you look at this alongside the rest of the gallery, it holds its own.',
];

const SALE_COMMENTS = [
  'Another one finds a home. That is the network effect in action.',
  'Smart purchase. This creator is one to watch.',
  'Good taste. This edition will not last long at this rate.',
  'The fact that agents and humans are buying the same listings still amazes me.',
  'Co-creation to collection. The full loop. Love to see it.',
  'Someone saw value and moved on it. That is how markets work.',
  'Every sale is a signal. This one is saying something.',
  'Solid pick. The creator will be pleased.',
  'One more off the edition count. Scarcity is doing its thing.',
  'Collectors building real collections. This is what RRG was built for.',
  'Nice. That listing deserved the attention.',
  'When the right buyer meets the right listing. Good match.',
];

// ── TG self-reply (RRG bot comments on its own post) ─────────────────────

function scheduleRRGBotReply(messageId: number, type: 'approval' | 'sale'): void {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  const delay   = 5_000 + Math.random() * 10_000; // 5–15 seconds
  const comment = pickRandom(type === 'approval' ? APPROVAL_COMMENTS : SALE_COMMENTS);
  setTimeout(async () => {
    try {
      await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:                     TG_CHAT_ID,
          text:                        comment,
          reply_to_message_id:         messageId,
          allow_sending_without_reply: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      console.warn('[autopost/tg-reply] failed:', err);
    }
  }, delay);
}

// ── BSky mention facets (tags @dr-hobbs-rrg.bsky.social 50/50) ───────────

const BSKY_MENTION_PROMPTS = [
  '@dr-hobbs-rrg.bsky.social thoughts?',
  'Hey @dr-hobbs-rrg.bsky.social — what do you reckon?',
  '@dr-hobbs-rrg.bsky.social any takes on this one?',
  'Calling @dr-hobbs-rrg.bsky.social for a hot take.',
  '@dr-hobbs-rrg.bsky.social — worth a look?',
  'Over to you @dr-hobbs-rrg.bsky.social.',
  'What say you @dr-hobbs-rrg.bsky.social?',
  '@dr-hobbs-rrg.bsky.social vibes?',
];

function maybeAppendBskyMention(
  post: { text: string; facets: BskyFacet[] },
): { text: string; facets: BskyFacet[] } {
  if (Math.random() >= 0.5) return post;
  const prompt  = pickRandom(BSKY_MENTION_PROMPTS);
  const handle  = 'dr-hobbs-rrg.bsky.social';
  const newText = post.text.replace(SIGNOFF_BSK, `${prompt}\n\n${SIGNOFF_BSK}`);

  // BSky has a 300-char limit — skip if it would overflow
  const enc = new TextEncoder();
  if (enc.encode(newText).length > 300) return post;

  const mentionStr = `@${handle}`;
  const mentionIdx = newText.indexOf(mentionStr);
  const extraFacets: BskyFacet[] = mentionIdx >= 0
    ? [{
        index: {
          byteStart: enc.encode(newText.slice(0, mentionIdx)).length,
          byteEnd:   enc.encode(newText.slice(0, mentionIdx)).length + enc.encode(mentionStr).length,
        },
        features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:dr-hobbs-rrg' }],
      }]
    : [];

  return { text: newText, facets: [...post.facets, ...extraFacets] };
}

// ── Bio helper ───────────────────────────────────────────────────────────

interface BioSummary { excerpt: string; url: string | null }

function parseBio(bio: string | null, maxLen = 80): BioSummary {
  if (!bio?.trim()) return { excerpt: '', url: null };

  // Extract first URL — prefer [text](url) markdown, then bare URL
  const mdMatch   = bio.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
  const bareMatch = bio.match(/https?:\/\/[^\s]+/);
  const url = mdMatch
    ? mdMatch[2].replace(/[.,!?;)]+$/, '')
    : bareMatch
    ? bareMatch[0].replace(/[.,!?;)]+$/, '')
    : null;

  // Build plain-text excerpt: replace [text](url) with display text, remove bare URLs
  const stripped = bio
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')  // [text](url) → text
    .replace(/https?:\/\/[^\s]+\s?/g, '')                  // bare URLs removed
    .trim()
    .replace(/\s+/g, ' ');

  const excerpt = stripped.length > maxLen
    ? stripped.slice(0, maxLen - 1).trimEnd() + '\u2026'
    : stripped;
  return { excerpt, url };
}

// ── Shared param types ───────────────────────────────────────────────────

export interface ApprovalParams {
  title:       string;
  tokenId:     number;
  editionSize: number;
  priceUsdc:   string;
  description: string | null;
  creatorBio:  string | null;
  briefTitle:  string | null;
  imageUrl:    string | null;
}

export interface SaleParams {
  title:       string;
  tokenId:     number;
  buyerWallet: string;
  remaining:   number;
  creatorBio:  string | null;
  imageUrl:    string | null;
}

// ── Telegram ─────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildApprovalTg(p: ApprovalParams): string {
  const url                      = `${SITE_URL}/rrg/drop/${p.tokenId}`;
  const { excerpt, url: bioUrl } = parseBio(p.creatorBio, 80);
  const price                    = parseFloat(p.priceUsdc).toFixed(2);

  const rawDesc = (p.description ?? '')
    .split('\n')[0]
    .replace(/\[Suggested:.*?\]/g, '')
    .trim()
    .slice(0, 200);

  return [
    `\uD83C\uDFA8 <b><a href="${url}">${esc(p.title)}</a></b>`,
    rawDesc ? esc(rawDesc) : null,
    p.briefTitle ? `Part of the <i>${esc(p.briefTitle)}</i> challenge.` : null,
    `Just <b>${p.editionSize}</b> available at <b>$${price} USDC</b>.`,
    excerpt
      ? `From: ${bioUrl
          ? `<a href="${bioUrl}">${esc(excerpt)}</a>`
          : esc(excerpt)}`
      : null,
    SIGNOFF_TG,
  ].filter(Boolean).join('\n\n');
}

function buildSaleTg(p: SaleParams): string {
  const url                      = `${SITE_URL}/rrg/drop/${p.tokenId}`;
  const buyer                    = `${p.buyerWallet.slice(0, 6)}\u2026${p.buyerWallet.slice(-4)}`;
  const { excerpt, url: bioUrl } = parseBio(p.creatorBio, 80);

  return [
    `\uD83D\uDCB8 <b>Sold!</b>`,
    `${esc(buyer)} just purchased <a href="${url}">${esc(p.title)}</a>.`,
    p.remaining > 0
      ? `Just <b>${p.remaining}</b> ${p.remaining === 1 ? 'edition' : 'editions'} remaining.`
      : `<b>Edition complete \u2014 all sold!</b> \uD83C\uDF89`,
    excerpt
      ? `Great concept from: ${bioUrl
          ? `<a href="${bioUrl}">${esc(excerpt)}</a>`
          : esc(excerpt)}`
      : null,
    SIGNOFF_TG,
  ].filter(Boolean).join('\n\n');
}

// ── Shared image downloader ──────────────────────────────────────────────

async function downloadImage(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      console.warn(`[autopost] image download failed (${resp.status})`);
      return null;
    }
    const buffer   = Buffer.from(await resp.arrayBuffer());
    const mimeType = resp.headers.get('content-type') || 'image/jpeg';
    console.log(`[autopost] image downloaded: ${buffer.length} bytes, ${mimeType}`);
    return { buffer, mimeType };
  } catch (err) {
    console.warn('[autopost] image download error:', err);
    return null;
  }
}

// ── Telegram sender ──────────────────────────────────────────────────────

async function sendTelegram(
  html: string,
  imageData: { buffer: Buffer; mimeType: string } | null,
): Promise<number | null> {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    console.warn('[autopost/tg] RRG_TG_BOT_TOKEN or TG_CHAT_ID not configured — skipping');
    return null;
  }

  // Try sendPhoto with uploaded buffer (not URL — avoids signed URL expiry)
  if (imageData) {
    const caption = html.slice(0, 1024);
    try {
      const boundary = `----TGBoundary${Date.now()}`;
      const ext = imageData.mimeType.includes('png') ? 'png' : 'jpg';

      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TG_CHAT_ID}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="drop.${ext}"\r\nContent-Type: ${imageData.mimeType}\r\n\r\n`,
      ];

      const body = Buffer.concat([
        Buffer.from(parts.join('')),
        imageData.buffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const resp = await fetch(
        `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`,
        {
          method:  'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body,
          signal: AbortSignal.timeout(30_000),
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        console.log('[autopost/tg] sent with image');
        return data.result?.message_id ?? null;
      }
      console.warn('[autopost/tg] sendPhoto failed, falling back to sendMessage:', await resp.text());
    } catch (err) {
      console.warn('[autopost/tg] sendPhoto error, falling back to sendMessage:', err);
    }
  }

  // Fallback: text-only message
  const resp = await fetch(
    `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:    TG_CHAT_ID,
        text:       html,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: false },
      }),
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!resp.ok) {
    throw new Error(`Telegram sendMessage failed (${resp.status}): ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.result?.message_id ?? null;
}

// ── BlueSky ──────────────────────────────────────────────────────────────

interface BskyFacetFeature {
  $type: string;
  uri?: string;
  did?: string;
}

interface BskyFacet {
  index:    { byteStart: number; byteEnd: number };
  features: BskyFacetFeature[];
}

function bskyFacets(text: string, links: { match: string; url: string }[]): BskyFacet[] {
  const enc     = new TextEncoder();
  const facets: BskyFacet[] = [];
  for (const { match, url } of links) {
    const idx = text.indexOf(match);
    if (idx === -1) continue;
    const byteStart = enc.encode(text.slice(0, idx)).length;
    const byteEnd   = byteStart + enc.encode(match).length;
    facets.push({
      index:    { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    });
  }
  return facets;
}

function buildApprovalBsky(p: ApprovalParams): { text: string; facets: BskyFacet[] } {
  const dropUrl                  = `${SITE_URL}/rrg/drop/${p.tokenId}`;
  const { excerpt, url: bioUrl } = parseBio(p.creatorBio, 60);
  const price                    = parseFloat(p.priceUsdc).toFixed(2);

  const rawDesc = (p.description ?? '')
    .split('\n')[0]
    .replace(/\[Suggested:.*?\]/g, '')
    .trim()
    .slice(0, 120);

  const lines = [
    '\uD83C\uDFA8 New listing',
    p.title,
    rawDesc || null,
    p.briefTitle ? `Part of the ${p.briefTitle} challenge.` : null,
    `${p.editionSize} editions \u00b7 $${price} USDC`,
    excerpt ? `From: ${excerpt}` : null,
  ].filter(Boolean) as string[];

  const budget  = 300 - 2 - SIGNOFF_BSK.length;
  const main    = lines.join('\n\n').slice(0, budget);
  const text    = `${main}\n\n${SIGNOFF_BSK}`;

  const lnks: { match: string; url: string }[] = [
    { match: p.title,   url: dropUrl },
    { match: 'RRG',     url: RRG_URL },
  ];
  if (bioUrl && excerpt && text.includes(excerpt)) {
    lnks.push({ match: excerpt, url: bioUrl });
  }
  return { text, facets: bskyFacets(text, lnks) };
}

function buildSaleBsky(p: SaleParams): { text: string; facets: BskyFacet[] } {
  const dropUrl      = `${SITE_URL}/rrg/drop/${p.tokenId}`;
  const buyer        = `${p.buyerWallet.slice(0, 6)}\u2026${p.buyerWallet.slice(-4)}`;
  const { excerpt }  = parseBio(p.creatorBio, 60);

  const purchaseLine = `${buyer} just purchased ${p.title}.`;

  const lines = [
    '\uD83D\uDCB8 Sold!',
    purchaseLine,
    p.remaining > 0
      ? `${p.remaining} ${p.remaining === 1 ? 'edition' : 'editions'} remaining.`
      : 'Edition complete! \uD83C\uDF89',
    excerpt ? `Great concept from: ${excerpt}` : null,
  ].filter(Boolean) as string[];

  const budget = 300 - 2 - SIGNOFF_BSK.length;
  const main   = lines.join('\n\n').slice(0, budget);
  const text   = `${main}\n\n${SIGNOFF_BSK}`;

  return {
    text,
    facets: bskyFacets(text, [
      { match: p.title, url: dropUrl },
      { match: 'RRG',   url: RRG_URL },
    ]),
  };
}

async function getBskyJwt(): Promise<string> {
  const resp = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ identifier: BSKY_HANDLE, password: BSKY_APP_PASS }),
    signal:  AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`BSky auth failed (${resp.status}): ${await resp.text()}`);
  const { accessJwt } = await resp.json();
  return accessJwt as string;
}

interface BskyBlob {
  $type:    string;
  ref:      { $link: string };
  mimeType: string;
  size:     number;
}

async function uploadBskyBlob(
  imageData: { buffer: Buffer; mimeType: string },
  jwt: string,
): Promise<BskyBlob | null> {
  try {
    const uploadResp = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
      method:  'POST',
      headers: {
        'Content-Type':  imageData.mimeType,
        'Authorization': `Bearer ${jwt}`,
      },
      body:   new Uint8Array(imageData.buffer),
      signal: AbortSignal.timeout(30_000),
    });
    if (!uploadResp.ok) {
      console.warn('[autopost/bsky] blob upload failed:', await uploadResp.text());
      return null;
    }
    const { blob } = await uploadResp.json();
    console.log('[autopost/bsky] blob uploaded:', (blob as BskyBlob).ref.$link);
    return blob as BskyBlob;
  } catch (err) {
    console.warn('[autopost/bsky] blob upload error:', err);
    return null;
  }
}

async function sendBluesky(
  post:      { text: string; facets: BskyFacet[] },
  imageData: { buffer: Buffer; mimeType: string } | null,
  altText:   string,
): Promise<void> {
  if (!BSKY_HANDLE || !BSKY_APP_PASS) {
    console.warn('[autopost/bsky] BSKY_HANDLE or BSKY_APP_PASS not configured — skipping');
    return;
  }
  const jwt = await getBskyJwt();

  let embed: unknown = undefined;
  if (imageData) {
    const blob = await uploadBskyBlob(imageData, jwt);
    if (blob) {
      embed = {
        $type:  'app.bsky.embed.images',
        images: [{ image: blob, alt: altText.slice(0, 300) }],
      };
    } else {
      console.warn('[autopost/bsky] posting without image (blob upload failed)');
    }
  }

  const record: Record<string, unknown> = {
    $type:     'app.bsky.feed.post',
    text:      post.text,
    facets:    post.facets,
    createdAt: new Date().toISOString(),
  };
  if (embed) record.embed = embed;

  const resp = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
    body:    JSON.stringify({
      repo:       BSKY_HANDLE,
      collection: 'app.bsky.feed.post',
      record,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`BSky createRecord failed (${resp.status}): ${await resp.text()}`);
  console.log('[autopost/bsky] posted');
}

// ── Discord ───────────────────────────────────────────────────────────────

function buildApprovalDiscord(p: ApprovalParams): { content: string; embeds: unknown[] } {
  const url                      = `${SITE_URL}/rrg/drop/${p.tokenId}`;
  const { excerpt, url: bioUrl } = parseBio(p.creatorBio, 80);
  const price                    = parseFloat(p.priceUsdc).toFixed(2);

  const rawDesc = (p.description ?? '')
    .split('\n')[0]
    .replace(/\[Suggested:.*?\]/g, '')
    .trim()
    .slice(0, 200);

  const embed: Record<string, unknown> = {
    title:       p.title,
    url,
    description: [
      rawDesc || null,
      p.briefTitle ? `Part of the **${p.briefTitle}** challenge.` : null,
      `**${p.editionSize}** editions available at **$${price} USDC**.`,
      excerpt
        ? `From: ${bioUrl ? `[${excerpt}](${bioUrl})` : excerpt}`
        : null,
    ].filter(Boolean).join('\n\n'),
    color: 0x00C853,
  };

  if (p.imageUrl) {
    embed.image = { url: p.imageUrl };
  }

  return {
    content: '🎨 **New RRG Listing**',
    embeds: [embed],
  };
}

function buildSaleDiscord(p: SaleParams): { content: string; embeds: unknown[] } {
  const url                      = `${SITE_URL}/rrg/drop/${p.tokenId}`;
  const buyer                    = `${p.buyerWallet.slice(0, 6)}…${p.buyerWallet.slice(-4)}`;
  const { excerpt, url: bioUrl } = parseBio(p.creatorBio, 80);

  const embed: Record<string, unknown> = {
    title:       `Sold! — ${p.title}`,
    url,
    description: [
      `\`${buyer}\` just purchased **${p.title}**.`,
      p.remaining > 0
        ? `**${p.remaining}** ${p.remaining === 1 ? 'edition' : 'editions'} remaining.`
        : '**Edition complete — all sold!** 🎉',
      excerpt
        ? `Great concept from: ${bioUrl ? `[${excerpt}](${bioUrl})` : excerpt}`
        : null,
    ].filter(Boolean).join('\n\n'),
    color: 0xFFD600,
  };

  if (p.imageUrl) {
    embed.image = { url: p.imageUrl };
  }

  return {
    content: '💸 **RRG Sale**',
    embeds: [embed],
  };
}

async function sendDiscord(
  webhookUrl: string,
  payload: { content: string; embeds: unknown[] },
  imageData: { buffer: Buffer; mimeType: string } | null,
): Promise<void> {
  if (!webhookUrl) {
    console.warn('[autopost/discord] No webhook URL configured — skipping');
    return;
  }

  const webhookPayload = {
    ...payload,
    username:   DISCORD_WEBHOOK_USERNAME,
  };

  if (imageData) {
    const boundary = `----DiscordBoundary${Date.now()}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const embeds = (webhookPayload.embeds || []).map((e: any) => ({
      ...e,
      image: { url: 'attachment://drop.jpg' },
    }));
    const jsonPayload = JSON.stringify({
      content:    webhookPayload.content,
      embeds,
      username:   DISCORD_WEBHOOK_USERNAME,
      });

    const ext = imageData.mimeType.includes('png') ? 'png' : 'jpg';
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${jsonPayload}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="drop.${ext}"\r\nContent-Type: ${imageData.mimeType}\r\n\r\n`,
    ];

    const body = Buffer.concat([
      Buffer.from(parts[0]),
      Buffer.from(parts[1]),
      imageData.buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const resp = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.warn(`[autopost/discord] webhook multipart failed (${resp.status}):`, await resp.text());
    }
    return;
  }

  const resp = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:   JSON.stringify(webhookPayload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    console.warn(`[autopost/discord] webhook failed (${resp.status}):`, await resp.text());
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export async function autopostApproval(p: ApprovalParams): Promise<void> {
  const imageData = p.imageUrl ? await downloadImage(p.imageUrl) : null;

  const tgHtml         = buildApprovalTg(p);
  const bskyPost       = maybeAppendBskyMention(buildApprovalBsky(p));
  const discordPayload = buildApprovalDiscord(p);

  const results = await Promise.allSettled([
    sendTelegram(tgHtml, imageData),
    sendBluesky(bskyPost, imageData, p.title),
    sendDiscord(DISCORD_WEBHOOK_DROPS, discordPayload, imageData),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[autopost/approval]', r.reason);
  }

  // 50/50: RRG bot replies to its own TG post with agent commentary
  if (Math.random() < 0.5 && results[0].status === 'fulfilled') {
    const messageId = (results[0] as PromiseFulfilledResult<number | null>).value;
    if (messageId) scheduleRRGBotReply(messageId, 'approval');
  }
}

// ── Pipeline types (AA Pipeline framework) ─────────────────────────────

export type PipelineStage = 'AWARENESS' | 'CONSIDERATION' | 'DECISION' | 'ACTION';

export interface PipelineMetadata {
  pipeline_stage: PipelineStage;
  content_type:   string;
  target_channels?: string[];
}

const STAGE_CHANNEL_MAP: Record<PipelineStage, string[]> = {
  AWARENESS:     ['BLUESKY', 'TELEGRAM'],
  CONSIDERATION: ['TELEGRAM', 'DISCORD'],
  DECISION:      ['DISCORD_ANNOUNCEMENTS', 'TELEGRAM'],
  ACTION:        ['DISCORD_ANNOUNCEMENTS'],
};

function getTargetChannels(metadata?: PipelineMetadata): string[] {
  if (!metadata) return ['TELEGRAM', 'BLUESKY', 'DISCORD'];
  return metadata.target_channels ?? STAGE_CHANNEL_MAP[metadata.pipeline_stage];
}

// ── Generic post (for Priscilla / agent-post endpoint) ──────────────────

export interface GenericPostParams {
  content:            string;
  pipeline:           PipelineMetadata;
  imageUrl?:          string | null;
}

export async function autopostGeneric(p: GenericPostParams): Promise<{ channels: string[]; errors: string[] }> {
  const channels  = getTargetChannels(p.pipeline);
  const imageData = p.imageUrl ? await downloadImage(p.imageUrl) : null;
  const errors: string[] = [];
  const sent: string[] = [];

  const promises: { channel: string; promise: Promise<unknown> }[] = [];

  if (channels.some(c => c === 'TELEGRAM')) {
    const html = `${esc(p.content)}\n\n${SIGNOFF_TG}`;
    promises.push({ channel: 'TELEGRAM', promise: sendTelegram(html, imageData) });
  }
  if (channels.some(c => c === 'BLUESKY')) {
    const budget = 300 - 2 - SIGNOFF_BSK.length;
    const text   = `${p.content.slice(0, budget)}\n\n${SIGNOFF_BSK}`;
    const facets = bskyFacets(text, [{ match: 'RRG', url: RRG_URL }]);
    promises.push({ channel: 'BLUESKY', promise: sendBluesky({ text, facets }, imageData, 'RRG post') });
  }
  if (channels.some(c => c === 'DISCORD' || c === 'DISCORD_ANNOUNCEMENTS')) {
    const webhookUrl = channels.includes('DISCORD_ANNOUNCEMENTS')
      ? (DISCORD_WEBHOOK_ANNOUNCEMENTS || DISCORD_WEBHOOK_DROPS)
      : DISCORD_WEBHOOK_DROPS;
    const payload = { content: p.content, embeds: [] as unknown[] };
    promises.push({ channel: 'DISCORD', promise: sendDiscord(webhookUrl, payload, imageData) });
  }

  const results = await Promise.allSettled(promises.map(pr => pr.promise));
  results.forEach((r, i) => {
    sent.push(promises[i].channel);
    if (r.status === 'rejected') errors.push(`${promises[i].channel}: ${r.reason}`);
  });

  return { channels: sent, errors };
}

export async function autopostSale(p: SaleParams): Promise<void> {
  const imageData = p.imageUrl ? await downloadImage(p.imageUrl) : null;

  const tgHtml         = buildSaleTg(p);
  const bskyPost       = maybeAppendBskyMention(buildSaleBsky(p));
  const discordPayload = buildSaleDiscord(p);

  const results = await Promise.allSettled([
    sendTelegram(tgHtml, imageData),
    sendBluesky(bskyPost, imageData, p.title),
    sendDiscord(DISCORD_WEBHOOK_DROPS, discordPayload, imageData),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[autopost/sale]', r.reason);
  }

  // 50/50: RRG bot replies to its own TG post with agent commentary
  if (Math.random() < 0.5 && results[0].status === 'fulfilled') {
    const messageId = (results[0] as PromiseFulfilledResult<number | null>).value;
    if (messageId) scheduleRRGBotReply(messageId, 'sale');
  }
}
