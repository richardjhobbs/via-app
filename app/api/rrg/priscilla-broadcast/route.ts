import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { ethers } from 'ethers';
import { autopostGeneric } from '@/lib/rrg/autopost';
import { uploadSubmissionFile, getSignedUrl } from '@/lib/rrg/storage';
import { recordSignedAction } from '@/lib/rrg/via-audit';

export const dynamic = 'force-dynamic';

// POST /api/rrg/priscilla-broadcast
//
// One-shot endpoint for Priscilla #37750 to fan a marketing post out to
// Telegram + BlueSky + Discord (DROPS) using the same autopostGeneric
// machinery as listing approvals and sales.
//
// Body: multipart/form-data
//   content     (required): post body
//   timestamp   (required): ISO-8601, must be within 5 min of server clock
//   signature   (required): EIP-191 signature over canonical
//                            `RRG-PRISCILLA-POST:<sha256-hex(content)>:<timestamp>`
//   image       (optional): JPEG or PNG file, max 5 MB
//   channels    (optional): comma-separated subset of TELEGRAM,BLUESKY,DISCORD
//
// Why multipart and not JSON: a 1.3 MB image base64-encoded in a JSON body
// hits Next.js body-size limits and inflates by 33%. Multipart binary keeps
// wire size at file size.
//
// This endpoint mirrors the auth gate of the `priscilla_post` MCP tool but
// accepts the image inline so the agent never has to chain upload -> sign ->
// post. One call from her broadcaster MCP, one round trip server-side.

const PRISCILLA_WALLET   = (process.env.RRG_PRISCILLA_BROADCAST_WALLET ?? '').toLowerCase();
const PRISCILLA_VIA_AGENT_ID = 37750; // Priscilla #37750, see wallet_separation.md
const REPLAY_WINDOW_MS   = 5 * 60 * 1000;
const ALLOWED_CHANNELS   = ['TELEGRAM', 'BLUESKY', 'DISCORD'] as const;
const ACCEPTED_MIME      = ['image/jpeg', 'image/jpg', 'image/png'];

export async function POST(req: NextRequest) {
  if (!PRISCILLA_WALLET) {
    return NextResponse.json({ error: 'Server: RRG_PRISCILLA_BROADCAST_WALLET not configured' }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 });
  }

  const contentRaw = formData.get('content') as string | null;
  const timestamp  = (formData.get('timestamp') as string | null)?.trim();
  const signature  = (formData.get('signature') as string | null)?.trim();
  const image      = formData.get('image')      as File   | null;
  const channelsRaw = (formData.get('channels') as string | null)?.trim();

  if (!contentRaw) return NextResponse.json({ error: 'content required' },   { status: 400 });
  if (!timestamp)  return NextResponse.json({ error: 'timestamp required' }, { status: 400 });
  if (!signature)  return NextResponse.json({ error: 'signature required' }, { status: 400 });

  // Canonicalise content for hashing. multipart/form-data per RFC 7578/2046
  // can normalise bare LF to CRLF in field values, which would diverge from
  // what the agent signed. We collapse \r\n -> \n before hashing on both
  // sides of the wire so the hash is stable regardless of transport.
  // Trim is applied only AFTER hashing so signers can sign raw content.
  const content = contentRaw.replace(/\r\n/g, '\n');

  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts)) {
    return NextResponse.json({ error: 'invalid timestamp; ISO-8601 expected' }, { status: 400 });
  }
  if (Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
    return NextResponse.json({ error: 'timestamp outside 5 min replay window' }, { status: 400 });
  }

  const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
  const canonical   = `RRG-PRISCILLA-POST:${contentHash}:${timestamp}`;
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(canonical, signature).toLowerCase();
  } catch {
    return NextResponse.json({ error: 'signature verification failed' }, { status: 401 });
  }
  if (recovered !== PRISCILLA_WALLET) {
    return NextResponse.json({ error: 'signer is not Priscilla #37750' }, { status: 401 });
  }

  // Channel allowlist
  let targets: string[] = [...ALLOWED_CHANNELS];
  if (channelsRaw) {
    const parsed = channelsRaw.split(',').map(s => s.trim()).filter(Boolean);
    targets = parsed.filter(c => (ALLOWED_CHANNELS as readonly string[]).includes(c));
    if (targets.length === 0) {
      return NextResponse.json({ error: 'no valid channels in `channels` field' }, { status: 400 });
    }
  }

  // Pre-trimmed-content guard.
  //
  // Priscilla repeatedly trims her body for BlueSky's 300-char limit and
  // then sends the SAME short text to Telegram and Discord, throwing away
  // the long-form context those channels accept. The server already
  // auto-truncates for BlueSky (see lib/rrg/autopost.ts:767, bskyTruncate
  // at 300 chars), so this pre-trim is unnecessary AND destructive.
  //
  // If the content is <= 320 chars AND the targets include any long-form
  // channel (Telegram or Discord), refuse. The agent must either send
  // long-form (server trims BlueSky internally) or restrict targets to
  // BLUESKY-only with an explicit `short_intentional=true` form field.
  const longChannels   = ['TELEGRAM', 'DISCORD'];
  const includesLong   = targets.some(t => longChannels.includes(t));
  const shortIntentRaw = (formData.get('short_intentional') as string | null)?.trim().toLowerCase();
  const shortIntentional = shortIntentRaw === 'true' || shortIntentRaw === '1' || shortIntentRaw === 'yes';

  if (content.length <= 320 && includesLong && !shortIntentional) {
    return NextResponse.json(
      {
        error: 'content_too_short_for_long_channels',
        detail:
          `content is ${content.length} chars but channels include ${targets.filter(t => longChannels.includes(t)).join(', ')}. ` +
          'The server auto-truncates for BlueSky internally (lib/rrg/autopost.ts bskyTruncate), so send the FULL long-form content (~400-1500 chars typical) and the server will produce the 300-char BlueSky variant for you. ' +
          'If you genuinely want the short text on every channel (rare), pass form field `short_intentional=true`.',
        content_length: content.length,
        long_channels_targeted: targets.filter(t => longChannels.includes(t)),
      },
      { status: 422 },
    );
  }

  // Upload image (if any) and produce a signed URL for autopostGeneric
  let imageUrl: string | null = null;
  if (image && image.size > 0) {
    if (!ACCEPTED_MIME.includes(image.type)) {
      return NextResponse.json({ error: 'image must be JPEG or PNG' }, { status: 400 });
    }
    if (image.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: `image is ${(image.size / 1024 / 1024).toFixed(1)} MB; max 5 MB` }, { status: 413 });
    }
    const buf  = Buffer.from(await image.arrayBuffer());
    const ext  = image.type === 'image/png' ? 'png' : 'jpg';
    const id   = randomUUID();
    const path = `uploads/${id}/priscilla-broadcast.${ext}`;
    await uploadSubmissionFile(path, buf, image.type);
    imageUrl = await getSignedUrl(path, 86400);
  }

  const result = await autopostGeneric({
    content,
    imageUrl,
    pipeline: {
      pipeline_stage:  'AWARENESS',
      content_type:    'priscilla_broadcast',
      target_channels: targets,
    },
  });

  // Signed-action audit. The post already went out and cannot be un-sent, so
  // this runs after autopost; a failed audit write is surfaced loudly via
  // audit_logged:false, never swallowed (a loud gap beats a silent one).
  let audit_logged = false;
  let audit_error: string | null = null;
  try {
    await recordSignedAction({
      via_agent_id:    PRISCILLA_VIA_AGENT_ID,
      source_platform: 'rrg',
      action_type:     'public_post',
      target:          result.channels.join(','),
      payload_hash:    contentHash,
      payload:         { content, channels: result.channels, errors: result.errors, image_url: imageUrl },
      nonce:           Math.floor(ts / 1000),
      signed_message:  canonical,
      signature,
      sig_scheme:      'rrg-priscilla-post-v1',
    });
    audit_logged = true;
  } catch (e: any) {
    audit_error = e?.message ?? String(e);
    console.error('[priscilla-broadcast] signed-action audit FAILED (post sent, audit gap):', audit_error);
  }

  return NextResponse.json({
    posted_to:    result.channels,
    errors:       result.errors,
    image_url:    imageUrl,
    audit_logged,
    audit_error,
  });
}
