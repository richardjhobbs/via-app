import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { getSignedUrl } from '@/lib/rrg/storage';
import { generateAvatar, AVATAR_GENERATION_COST_USDC, PRESET_AVATARS } from '@/lib/agent/avatars';
import { deductFlatCredits } from '@/lib/agent/credits';

export const dynamic = 'force-dynamic';

const BUCKET = 'rrg-submissions';
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * GET /api/agent/[agentId]/avatar
 *
 * Resolve the agent's current avatar to a displayable URL. Preset avatars
 * return their bundled asset path; uploaded/generated return a fresh signed
 * URL from Supabase storage so the dashboard can render the actual image
 * across page reloads (signed URLs expire, so we mint a new one on demand).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const { data: agent } = await db
    .from('agent_agents')
    .select('avatar_path, avatar_source')
    .eq('id', agentId)
    .single();

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  if (!agent.avatar_path || agent.avatar_source === 'none') {
    return NextResponse.json({
      avatar_url: null,
      avatar_path: null,
      avatar_source: 'none',
    });
  }

  if (agent.avatar_source === 'preset') {
    const preset = PRESET_AVATARS.find(p => p.id === agent.avatar_path);
    return NextResponse.json({
      avatar_url: preset?.src ?? null,
      avatar_path: agent.avatar_path,
      avatar_source: 'preset',
    });
  }

  // uploaded or generated: mint a fresh signed URL (7 days)
  try {
    const signedUrl = await getSignedUrl(agent.avatar_path, 604800);
    return NextResponse.json({
      avatar_url: signedUrl,
      avatar_path: agent.avatar_path,
      avatar_source: agent.avatar_source,
    });
  } catch (err) {
    console.error('[avatar resolve]', err);
    return NextResponse.json({
      avatar_url: null,
      avatar_path: agent.avatar_path,
      avatar_source: agent.avatar_source,
    });
  }
}

/**
 * POST /api/agent/[agentId]/avatar
 *
 * Three modes:
 * 1. File upload (multipart/form-data with "avatar" field)
 * 2. Preset selection (JSON { preset: "preset-03" })
 * 3. AI generation (JSON { generate: true })
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  // Load agent
  const { data: agent, error: agentErr } = await db
    .from('agent_agents')
    .select('id, tier, name, persona_bio, persona_voice, style_tags, credit_balance_usdc')
    .eq('id', agentId)
    .single();

  if (agentErr || !agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  const contentType = req.headers.get('content-type') || '';

  // ── Mode 1: File upload ───────────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const file = formData.get('avatar') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No avatar file provided' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG, and WebP are accepted' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File must be under 2MB' }, { status: 400 });
    }

    const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
    const storagePath = `avatars/${agentId}/avatar.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await db.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: file.type, upsert: true });

    if (uploadErr) {
      console.error('[avatar upload]', uploadErr);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }

    // Get signed URL for immediate display
    const signedUrl = await getSignedUrl(storagePath, 604800); // 7 days

    await db
      .from('agent_agents')
      .update({ avatar_path: storagePath, avatar_source: 'uploaded' })
      .eq('id', agentId);

    await db.from('agent_activity_log').insert({
      agent_id: agentId,
      action: 'avatar_updated',
      details: { source: 'uploaded' },
    });

    return NextResponse.json({ avatar_path: storagePath, avatar_url: signedUrl, avatar_source: 'uploaded' });
  }

  // ── Mode 2 & 3: JSON body ────────────────────────────────────────
  const body = await req.json();

  // Mode 2: Preset selection
  if (body.preset) {
    const preset = PRESET_AVATARS.find(p => p.id === body.preset);
    if (!preset) {
      return NextResponse.json({ error: 'Invalid preset ID' }, { status: 400 });
    }

    await db
      .from('agent_agents')
      .update({ avatar_path: preset.id, avatar_source: 'preset' })
      .eq('id', agentId);

    await db.from('agent_activity_log').insert({
      agent_id: agentId,
      action: 'avatar_updated',
      details: { source: 'preset', preset_id: preset.id },
    });

    return NextResponse.json({ avatar_path: preset.id, avatar_url: preset.src, avatar_source: 'preset' });
  }

  // Mode 3: AI generation
  if (body.generate) {
    if (agent.tier !== 'pro') {
      return NextResponse.json({ error: 'AI avatar generation requires Concierge tier' }, { status: 403 });
    }

    if (agent.credit_balance_usdc < AVATAR_GENERATION_COST_USDC) {
      return NextResponse.json({ error: `Insufficient credits. Generation costs $${AVATAR_GENERATION_COST_USDC} USDC` }, { status: 402 });
    }

    try {
      const imageBuffer = await generateAvatar({
        name: agent.name,
        bio: agent.persona_bio,
        voice: agent.persona_voice,
        style_tags: agent.style_tags,
      });

      const storagePath = `avatars/${agentId}/avatar.png`;

      const { error: uploadErr } = await db.storage
        .from(BUCKET)
        .upload(storagePath, imageBuffer, { contentType: 'image/png', upsert: true });

      if (uploadErr) {
        console.error('[avatar generate upload]', uploadErr);
        return NextResponse.json({ error: 'Failed to store generated avatar' }, { status: 500 });
      }

      // Deduct credits
      await deductFlatCredits(agentId, AVATAR_GENERATION_COST_USDC, 'AI avatar generation (DALL-E 3)');

      const signedUrl = await getSignedUrl(storagePath, 604800);

      await db
        .from('agent_agents')
        .update({ avatar_path: storagePath, avatar_source: 'generated' })
        .eq('id', agentId);

      await db.from('agent_activity_log').insert({
        agent_id: agentId,
        action: 'avatar_updated',
        details: { source: 'generated', cost_usdc: AVATAR_GENERATION_COST_USDC },
      });

      return NextResponse.json({ avatar_path: storagePath, avatar_url: signedUrl, avatar_source: 'generated' });
    } catch (err) {
      console.error('[avatar generate]', err);
      return NextResponse.json({ error: 'Avatar generation failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Provide preset, generate, or upload a file' }, { status: 400 });
}

/**
 * DELETE /api/agent/[agentId]/avatar — Remove custom avatar
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const { data: agent } = await db
    .from('agent_agents')
    .select('id, avatar_path, avatar_source')
    .eq('id', agentId)
    .single();

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  // Delete from storage if it's an uploaded/generated file
  if (agent.avatar_source === 'uploaded' || agent.avatar_source === 'generated') {
    if (agent.avatar_path) {
      await db.storage.from(BUCKET).remove([agent.avatar_path]);
    }
  }

  await db
    .from('agent_agents')
    .update({ avatar_path: null, avatar_source: 'none' })
    .eq('id', agentId);

  await db.from('agent_activity_log').insert({
    agent_id: agentId,
    action: 'avatar_removed',
    details: {},
  });

  return NextResponse.json({ ok: true });
}
