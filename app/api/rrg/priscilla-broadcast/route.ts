import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { ethers } from 'ethers';
import { autopostGeneric } from '@/lib/rrg/autopost';
import { uploadSubmissionFile, getSignedUrl } from '@/lib/rrg/storage';

export const dynamic = 'force-dynamic';

// POST /api/rrg/priscilla-broadcast
//
// One-shot endpoint for Priscilla #37750 to fan a marketing post out to
// Telegram + BlueSky + Discord (DROPS) using the same autopostGeneric
// machinery as listing approvals and sales.
//
// Body: multipart/form-data
//   content     (required) — post body
//   timestamp   (required) — ISO-8601, must be within 5 min of server clock
//   signature   (required) — EIP-191 signature over canonical
//                            `RRG-PRISCILLA-POST:<sha256-hex(content)>:<timestamp>`
//   image       (optional) — JPEG or PNG file, max 5 MB
//   channels    (optional) — comma-separated subset of TELEGRAM,BLUESKY,DISCORD
//
// Why multipart and not JSON: a 1.3 MB image base64-encoded in a JSON body
// hits Next.js body-size limits and inflates by 33%. Multipart binary keeps
// wire size at file size.
//
// This endpoint mirrors the auth gate of the `priscilla_post` MCP tool but
// accepts the image inline so the agent never has to chain upload -> sign ->
// post. One call from her broadcaster MCP, one round trip server-side.

const PRISCILLA_WALLET   = (process.env.RRG_PRISCILLA_BROADCAST_WALLET ?? '').toLowerCase();
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

  const content   = (formData.get('content')   as string | null)?.trim();
  const timestamp = (formData.get('timestamp') as string | null)?.trim();
  const signature = (formData.get('signature') as string | null)?.trim();
  const image     = formData.get('image')     as File   | null;
  const channelsRaw = (formData.get('channels') as string | null)?.trim();

  if (!content)   return NextResponse.json({ error: 'content required' },   { status: 400 });
  if (!timestamp) return NextResponse.json({ error: 'timestamp required' }, { status: 400 });
  if (!signature) return NextResponse.json({ error: 'signature required' }, { status: 400 });

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

  return NextResponse.json({
    posted_to: result.channels,
    errors:    result.errors,
    image_url: imageUrl,
  });
}
