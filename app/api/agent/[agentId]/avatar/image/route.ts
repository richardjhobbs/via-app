/**
 * GET /api/agent/[agentId]/avatar/image
 *
 * Stream the agent's avatar bytes through the app origin so the image
 * loads even when the client's network blocks the Supabase storage
 * domain (UK VPN exits block sanvqnvvzdkjvfmxnxur.supabase.co, ad-
 * blockers sometimes block *.supabase.co, etc.). See
 * feedback_vpn_blocks_supabase.md.
 *
 * - 'preset' avatars 302-redirect to the static asset path (same
 *   origin already, no proxying needed).
 * - 'uploaded' / 'generated' avatars are fetched server-side from the
 *   signed Supabase URL and streamed back with a strong cache header,
 *   so mobile/VPN clients only see realrealgenuine.com on the wire.
 * - No avatar set => 404, the dashboard falls back to the initial.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { getSignedUrl } from '@/lib/rrg/storage';
import { PRESET_AVATARS } from '@/lib/agent/avatars';

export const dynamic = 'force-dynamic';

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;

  const { data: agent } = await db
    .from('agent_agents')
    .select('avatar_path, avatar_source')
    .eq('id', agentId)
    .single();

  if (!agent || !agent.avatar_path || agent.avatar_source === 'none') {
    return new NextResponse('No avatar', { status: 404 });
  }

  if (agent.avatar_source === 'preset') {
    const preset = PRESET_AVATARS.find(p => p.id === agent.avatar_path);
    if (!preset?.src) return new NextResponse('Preset not found', { status: 404 });
    return NextResponse.redirect(new URL(preset.src, _req.url), 302);
  }

  // uploaded or generated: fetch the signed URL server-side and proxy.
  let signedUrl: string;
  try {
    signedUrl = await getSignedUrl(agent.avatar_path, 600);
  } catch (err) {
    console.error('[avatar/image sign]', err);
    return new NextResponse('Avatar resolve failed', { status: 502 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(signedUrl, { cache: 'no-store' });
  } catch (err) {
    console.error('[avatar/image fetch]', err);
    return new NextResponse('Upstream fetch failed', { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new NextResponse(`Upstream ${upstream.status}`, { status: 502 });
  }

  const ext = (agent.avatar_path.split('.').pop() ?? '').toLowerCase();
  const contentType =
    upstream.headers.get('content-type') ?? CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // 1h browser cache, 1d CDN; signed URL is regenerated server-side
      // each request so cache invalidation isn't tied to the signature.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
