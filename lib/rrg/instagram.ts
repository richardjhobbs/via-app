/**
 * RRG Instagram post automation
 *
 * Triggered by:
 *   1. approve/route.ts  — new drop published
 *   2. confirm/route.ts  — human purchase confirmed
 *   3. claim/route.ts    — agent purchase confirmed
 *
 * Sends richard@entrepot.asia an email with:
 *   - The drop image as an attachment (download → post to IG)
 *   - Claude-generated caption + hashtags (copy-paste ready)
 *   - Drop details
 *
 * Non-blocking / non-fatal — called fire-and-forget.
 */

import sharp from 'sharp';

const RESEND_URL = 'https://api.resend.com/emails';
const FROM       = process.env.FROM_EMAIL ?? 'deliver@realrealgenuine.com';
const SITE_URL   = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com';
const IG_TO      = 'richard@entrepot.asia';

export interface InstagramNotifyParams {
  trigger:      'new_drop' | 'sale';
  title:        string;
  tokenId:      number;
  creatorHandle: string | null;
  creatorType:  'human' | 'agent';
  listingType?: 'creator' | 'brand';  // brand = RRG/brand listed, creator = creator submitted
  briefName:    string | null;
  brandName:    string | null;
  buyerType?:   'human' | 'agent';
  imageUrl:     string | null;   // signed Supabase URL (or IPFS fallback)
}

// ── Caption generation via Anthropic ──────────────────────────────────────

async function generateCaption(p: InstagramNotifyParams): Promise<string> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY not set');

  const isBrandListing = p.listingType === 'brand' || (!p.creatorHandle && p.creatorType === 'human');

  const triggerLine = p.trigger === 'sale'
    ? `This is a sale announcement. The drop just sold${p.buyerType === 'agent' ? ' to an AI agent' : ''}.`
    : 'This is a new drop announcement.';

  const originLine = isBrandListing
    ? `This is a brand or platform listing — not a creator submission. Focus on the drop itself, the brand (${p.brandName ?? 'RRG'}), and its exclusivity. Do NOT mention a creator.`
    : `Creator: ${p.creatorType === 'agent' ? 'AI agent' : (p.creatorHandle ?? 'independent creator')}`;

  const prompt = `You write Instagram captions for Real Real Genuine (RRG), a fashion and lifestyle design marketplace where human and AI creators collaborate.

Write an Instagram caption for this drop:
- Title: ${p.title}
- ${originLine}
- Brief/collection: ${p.briefName ?? 'RRG original'}
- Brand: ${p.brandName ?? 'RRG'}
- ${triggerLine}

Rules:
- 2–3 sentences maximum
- No mention of crypto, USDC, blockchain, NFT, or wallet
- No price mentioned
- End with: "→ Link in bio"
- Add 8–12 relevant hashtags on a new line
- Tone: fashion-forward, editorial, understated
- If creator is AI, reference "AI x RRG" or "machine-made" naturally
- If sale trigger and creator listing, lead with the work selling / finding a new home
- If sale trigger and brand listing, lead with the drop, the brand, and the moment

Reply with ONLY the caption text and hashtags. Nothing else.`;

  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Together AI error ${res.status}: ${t}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content?.trim() ?? '';
}

// ── Email via Resend (with attachment) ────────────────────────────────────

async function sendInstagramEmail(p: InstagramNotifyParams, caption: string, imageBase64: string | null): Promise<void> {
  const dropUrl = `${SITE_URL}/rrg/drop/${p.tokenId}`;
  const subjectPrefix = p.trigger === 'sale' ? 'RRG Sale' : 'RRG Drop Ready';
  const subject = `${subjectPrefix} — ${p.title}`;

  const captionHtml = caption
    .split('\n')
    .map((line) => `<p style="margin:0 0 6px;font-size:14px;color:#e5e5e5;line-height:1.6">${escHtml(line)}</p>`)
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0a0a0a; color:#e5e5e5; margin:0; padding:32px 16px; }
  .card { max-width:560px; margin:0 auto; background:#111; border:1px solid #222; border-radius:12px; overflow:hidden; }
  .header { background:#d4ff22; padding:20px 24px; }
  .header h1 { margin:0; font-size:16px; color:#0a0a0a; font-weight:700; letter-spacing:0.02em; }
  .section { padding:24px; border-bottom:1px solid #1a1a1a; }
  .label { font-size:10px; text-transform:uppercase; letter-spacing:1.5px; color:#555; margin-bottom:10px; font-weight:600; }
  .caption-box { background:#0a0a0a; border:1px solid #222; border-radius:8px; padding:16px; }
  .divider { border:none; border-top:1px dashed #333; margin:0; }
  .meta-row { display:flex; gap:12px; padding:5px 0; font-size:13px; }
  .meta-key { color:#666; min-width:80px; }
  .meta-val { color:#ccc; }
  .footer { padding:16px 24px; font-size:12px; color:#444; }
  a { color:#d4ff22; }
</style></head>
<body>
<div class="card">
  <div class="header">
    <h1>${p.trigger === 'sale' ? '🛍 Sale — post to Instagram' : '🟢 New Drop — post to Instagram'} — ${escHtml(p.title)}</h1>
  </div>

  ${imageBase64 ? `
  <div class="section" style="padding:16px 24px;text-align:center;background:#000">
    <img src="cid:igimage" alt="${escHtml(p.title)}" style="max-width:100%;border-radius:4px;display:block;margin:0 auto" />
    <p style="margin:8px 0 0;font-size:11px;color:#444">Image attached — download and post to Instagram</p>
  </div>` : `
  <div class="section">
    <p style="font-size:13px;color:#666">⚠️ No image available for this drop.</p>
  </div>`}

  <div class="section">
    <div class="label">Caption — copy from here</div>
    <div class="caption-box">${captionHtml}</div>
  </div>

  <div class="section">
    <div class="label">Listing details</div>
    <div class="meta-row"><span class="meta-key">Title</span><span class="meta-val">${escHtml(p.title)}</span></div>
    ${p.brandName ? `<div class="meta-row"><span class="meta-key">Brand</span><span class="meta-val">${escHtml(p.brandName)}</span></div>` : ''}
    ${p.briefName ? `<div class="meta-row"><span class="meta-key">Brief</span><span class="meta-val">${escHtml(p.briefName)}</span></div>` : ''}
    <div class="meta-row"><span class="meta-key">URL</span><span class="meta-val"><a href="${dropUrl}">${dropUrl}</a></span></div>
  </div>

  <div class="footer">RRG — Real Real Genuine · Auto-generated</div>
</div>
</body>
</html>`;

  const payload: Record<string, unknown> = {
    from:    FROM,
    to:      IG_TO,
    subject,
    html,
  };

  if (imageBase64) {
    payload.attachments = [{
      filename:     `rrg-${p.tokenId}-${p.trigger}.jpg`,
      content:      imageBase64,
      content_type: 'image/jpeg',
    }];
  }

  const res = await fetch(RESEND_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend error ${res.status}: ${text}`);
  }
}

// ── Banner overlay using sharp ─────────────────────────────────────────────

async function addBanner(imgBuf: Buffer, trigger: 'new_drop' | 'sale'): Promise<Buffer> {
  const label   = trigger === 'sale' ? 'SOLD' : 'NEW DROP';
  // Site colours: lime (#d4ff22 / black text) for new drop, red (#dc2626 / white text) for sale
  const bgColor = trigger === 'sale' ? '#dc2626' : '#d4ff22';
  const fgColor = trigger === 'sale' ? '#ffffff' : '#000000';

  const meta    = await sharp(imgBuf).metadata();
  const w       = meta.width  ?? 1080;
  const h       = meta.height ?? 1080;
  const barH    = Math.round(h * 0.09);  // ~9% of image height
  const fontSize = Math.round(barH * 0.45);
  const letterSpacing = Math.round(fontSize * 0.18);

  // SVG banner strip — bottom of image
  const svg = `<svg width="${w}" height="${barH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${barH}" fill="${bgColor}"/>
    <text
      x="${w / 2}" y="${Math.round(barH * 0.68)}"
      font-family="monospace, 'Courier New', Courier"
      font-size="${fontSize}"
      font-weight="700"
      fill="${fgColor}"
      text-anchor="middle"
      letter-spacing="${letterSpacing}"
    >${label}</text>
  </svg>`;

  return sharp(imgBuf)
    .composite([{
      input:     Buffer.from(svg),
      top:       h - barH,
      left:      0,
    }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

// ── Public entry point ─────────────────────────────────────────────────────

export async function sendInstagramNotification(p: InstagramNotifyParams): Promise<void> {
  // 1. Generate caption
  const caption = await generateCaption(p);

  // 2. Fetch image, add banner, base64 encode
  let imageBase64: string | null = null;
  if (p.imageUrl) {
    try {
      const imgRes = await fetch(p.imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (imgRes.ok) {
        const raw        = Buffer.from(await imgRes.arrayBuffer());
        const withBanner = await addBanner(raw, p.trigger);
        imageBase64      = withBanner.toString('base64');
      }
    } catch (err) {
      console.error('[instagram] image fetch/banner failed:', err);
      // Continue without image — caption email still useful
    }
  }

  // 3. Send
  await sendInstagramEmail(p, caption, imageBase64);
}

// ── HTML escape helper ─────────────────────────────────────────────────────
function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
