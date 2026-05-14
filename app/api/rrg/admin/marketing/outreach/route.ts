/**
 * POST /api/rrg/admin/marketing/outreach
 * Send outreach to a candidate or batch of candidates.
 *
 * Body:
 *   single mode:
 *     { candidate_id, channel, message_type,
 *       brand_slug?, brand_id?, product_ids?, full_catalogue?, campaign_id? }
 *   batch mode (set one of: tier / limit / resend):
 *     { tier?, channel?, limit?, resend?,
 *       brand_slug?, brand_id?, product_ids?, full_catalogue?, campaign_id?,
 *       message_type? }
 *
 * Brand context (any of brand_slug / brand_id, plus optional product_ids /
 * full_catalogue) switches the message to a brand template and stamps
 * brand_id + product_refs + campaign_id on the mkt_outreach row.
 *
 * GET /api/rrg/admin/marketing/outreach?candidate_id=...
 * View outreach history for a candidate.
 */

import { NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/rrg/auth';
import { sendOutreach, batchOutreach, previewOutreach, type BrandOutreachOpts } from '@/lib/rrg/marketing-outreach';
import { getOutreachForCandidate, type MessageType } from '@/lib/rrg/marketing-db';

export const dynamic = 'force-dynamic';

async function checkAuth(req: Request): Promise<boolean> {
  // Cookie auth (browser sessions)
  const cookieAuth = await isAdminFromCookies();
  if (cookieAuth) return true;
  // Header auth (curl / agent calls)
  const secret = process.env.ADMIN_SECRET;
  const header = req.headers.get('x-admin-secret');
  return !!(secret && header && header === secret);
}

export async function POST(req: Request) {
  const isAdmin = await checkAuth(req);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();

    // Build brand opts (shared by single + batch mode). Any of these triggers
    // the brand template path; absence falls through to platform recruitment.
    const brandOpts: BrandOutreachOpts = {
      brandId:       typeof body.brand_id === 'string' ? body.brand_id : undefined,
      brandSlug:     typeof body.brand_slug === 'string' ? body.brand_slug : undefined,
      productIds:    Array.isArray(body.product_ids) ? body.product_ids.filter((x: unknown) => typeof x === 'string') : undefined,
      fullCatalogue: body.full_catalogue === true,
      campaignId:    typeof body.campaign_id === 'string' ? body.campaign_id : undefined,
    };
    const hasBrand = !!(brandOpts.brandId || brandOpts.brandSlug);

    // Dry-run mode: build the brand context, pick the recipient pool, and
    // render the EXACT message body that would go out to a sample candidate.
    // No mkt_outreach rows written, no candidate endpoints contacted. Used
    // by Rosie / admin UI for human review before greenlighting a real send.
    if (body.dry_run === true) {
      const messageType: MessageType | undefined = typeof body.message_type === 'string'
        ? body.message_type as MessageType
        : undefined;
      const preview = await previewOutreach(
        body.tier ?? undefined,
        Math.min(body.limit ?? 10, 2000),
        brandOpts,
        messageType,
      );
      return NextResponse.json({ ok: true, mode: 'dry_run', preview });
    }

    // Batch mode (tier is optional — without it, sends to all reachable pending agents)
    // resend: true → re-contact previously contacted agents with updated message
    // candidate_id (single-target) always wins over brand-only batch dispatch.
    if (!body.candidate_id && (body.tier || body.limit || body.resend || hasBrand)) {
      const messageType: MessageType | undefined = typeof body.message_type === 'string'
        ? body.message_type as MessageType
        : undefined;
      const results = await batchOutreach(
        body.tier ?? undefined,
        body.channel ?? 'a2a',
        Math.min(body.limit ?? 10, 2000),
        body.resend ?? false,
        brandOpts,
        messageType,
      );
      const delivered = results.filter((r) => r.status === 'delivered').length;
      const bounced = results.filter((r) => r.status === 'bounced').length;
      const sent = results.filter((r) => r.status === 'sent').length;
      const failed = results.filter((r) => r.status === 'failed').length;
      return NextResponse.json({
        ok: true,
        mode: 'batch',
        summary: { delivered, bounced, sent, failed, total: results.length },
        results,
      });
    }

    // Single mode
    if (!body.candidate_id) {
      return NextResponse.json(
        { error: 'candidate_id required (or use tier for batch mode)' },
        { status: 400 },
      );
    }

    const result = await sendOutreach(
      body.candidate_id,
      body.channel ?? 'manual',
      body.message_type ?? (hasBrand ? 'brand_intro' : 'intro'),
      brandOpts,
    );

    return NextResponse.json({ ok: result.status === 'delivered' || result.status === 'sent', ...result });
  } catch (err) {
    console.error('[marketing/outreach] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Outreach failed' },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const isAdmin = await checkAuth(req);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const candidateId = url.searchParams.get('candidate_id');

  // Single candidate history
  if (candidateId) {
    const history = await getOutreachForCandidate(candidateId);
    return NextResponse.json({ outreach: history });
  }

  // Full outreach dashboard — aggregated stats + recent messages
  const { db: supabase } = await import('@/lib/rrg/db');
  const { getOutreachPoolSummary } = await import('@/lib/rrg/marketing-db');

  // Recent outreach records (capped at 500 for aggregation; this is a send
  // log, NOT the candidate pool — see `candidates_*` fields below for the
  // real pool sizes from mkt_candidates).
  const { data: allOutreach } = await supabase
    .from('mkt_outreach')
    .select('id, created_at, candidate_id, channel, message_type, status, response_body, cost_usdc')
    .order('created_at', { ascending: false })
    .limit(500);

  const records = allOutreach ?? [];

  // Real candidate pool counts (mkt_candidates), not the send-log slice
  const poolSummary = await getOutreachPoolSummary();

  // Aggregate by status
  const byStatus: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const byMessageType: Record<string, number> = {};
  let totalCost = 0;

  for (const r of records) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byChannel[r.channel] = (byChannel[r.channel] ?? 0) + 1;
    byMessageType[r.message_type] = (byMessageType[r.message_type] ?? 0) + 1;
    totalCost += r.cost_usdc ?? 0;
  }

  // Recent outreach with candidate names
  const recentIds = records.slice(0, 100).map(r => r.candidate_id);
  const uniqueCandidateIds = [...new Set(recentIds)];

  const { data: candidates } = uniqueCandidateIds.length > 0
    ? await supabase
        .from('mkt_candidates')
        .select('id, name, erc8004_id, chain, tier, wallet_address, has_mcp, has_a2a, has_image_gen, outreach_status')
        .in('id', uniqueCandidateIds)
    : { data: [] };

  const candidateMap = new Map((candidates ?? []).map(c => [c.id, c]));

  const recent = records.slice(0, 100).map(r => ({
    ...r,
    candidate: candidateMap.get(r.candidate_id) ?? null,
    response_preview: r.response_body?.slice(0, 200) ?? null,
  }));

  // Delivery rate calculation
  const deliveryRate = records.length > 0
    ? ((byStatus['delivered'] ?? 0) / records.length * 100).toFixed(1)
    : '0';
  const bounceRate = records.length > 0
    ? ((byStatus['bounced'] ?? 0) / records.length * 100).toFixed(1)
    : '0';

  // Today's activity
  const today = new Date().toISOString().slice(0, 10);
  const todayRecords = records.filter(r => r.created_at?.startsWith(today));
  const todayDelivered = todayRecords.filter(r => r.status === 'delivered').length;

  return NextResponse.json({
    // DEPRECATED field name — kept for downstream consumers that read it.
    // `total` is the count of the 500 most recent mkt_outreach rows, NOT
    // the candidate pool. Use `recent_messages_count` (same value, clearer
    // name) or `candidates_total` / `candidates_reachable` instead.
    total: records.length,
    recent_messages_count: records.length,
    candidates_total: poolSummary.total_candidates,
    candidates_reachable: poolSummary.total_reachable,
    candidates_pending: poolSummary.pending_total,
    candidates_pending_reachable: poolSummary.pending_reachable,
    candidates_pending_by_tier: poolSummary.pending_by_tier,
    candidates_pending_reachable_by_tier: poolSummary.pending_reachable_by_tier,
    byStatus,
    byChannel,
    byMessageType,
    deliveryRate,
    bounceRate,
    totalCostUsdc: totalCost,
    today: {
      total: todayRecords.length,
      delivered: todayDelivered,
    },
    recent,
  });
}
