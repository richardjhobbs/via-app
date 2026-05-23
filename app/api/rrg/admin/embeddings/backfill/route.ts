/**
 * POST /api/rrg/admin/embeddings/backfill
 *
 * One-shot (or repeat-safe) backfill of product embeddings for the
 * semantic discovery layer. Selects rrg_submissions rows where
 * embedding IS NULL, embeds them via OpenAI text-embedding-3-small in
 * batches, and writes the vectors back.
 *
 * Auth: CRON_SECRET via `x-cron-secret` or `Authorization: Bearer`,
 * or ADMIN_SECRET via `x-admin-secret`, or admin cookie. Same shape
 * as agent-notifications/scan.
 *
 * Query params:
 *   batch_size  (default 50, max 100)   rows per OpenAI call
 *   max_batches (default 20)            cap total batches in this run
 *   status      (default 'approved')    filter on submission status
 *
 * Idempotent: only processes rows with embedding IS NULL. Safe to
 * re-run after a partial failure. The vercel function timeout caps
 * any single invocation; call repeatedly to finish a large backfill.
 *
 * Example:
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     'https://realrealgenuine.com/api/rrg/admin/embeddings/backfill?batch_size=50&max_batches=20'
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminFromCookies } from '@/lib/rrg/auth';
import { db } from '@/lib/rrg/db';
import {
  embedBatch,
  composeProductEmbeddingInput,
  toPgVectorLiteral,
  EMBEDDING_MODEL,
} from '@/lib/agent/embeddings';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function checkAuth(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header =
      req.headers.get('x-cron-secret') ||
      req.headers.get('authorization')?.replace('Bearer ', '');
    if (header === cronSecret) return true;
  }
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = req.headers.get('x-admin-secret');
  if (adminSecret && adminHeader === adminSecret) return true;
  return isAdminFromCookies();
}

interface BackfillRow {
  id: string;
  token_id: number | null;
  title: string | null;
  description: string | null;
  enhanced_description: string | null;
  brand_id: string | null;
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured on this deployment' },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const batchSize = Math.min(
    Math.max(Number(url.searchParams.get('batch_size') ?? '50'), 1),
    100,
  );
  const maxBatches = Math.max(
    Number(url.searchParams.get('max_batches') ?? '20'),
    1,
  );
  const statusFilter = url.searchParams.get('status') ?? 'approved';

  const started = Date.now();
  let totalRowsEmbedded = 0;
  let totalTokens = 0;
  const errors: Array<{ id: string; message: string }> = [];

  // Look up brand names once so the embedding text includes brand.
  const { data: brandsData } = await db
    .from('rrg_brands')
    .select('id, name');
  const brandNameById = new Map<string, string>(
    (brandsData ?? []).map(b => [b.id as string, b.name as string]),
  );

  for (let batchIdx = 0; batchIdx < maxBatches; batchIdx++) {
    const { data, error } = await db
      .from('rrg_submissions')
      .select('id, token_id, title, description, enhanced_description, brand_id')
      .eq('status', statusFilter)
      .is('embedding', null)
      .order('approved_at', { ascending: false, nullsFirst: false })
      .limit(batchSize);

    if (error) {
      return NextResponse.json(
        { error: `select failed: ${error.message}`, embedded: totalRowsEmbedded },
        { status: 500 },
      );
    }
    const rows = (data ?? []) as BackfillRow[];
    if (rows.length === 0) break;

    const inputs = rows.map(r =>
      composeProductEmbeddingInput({
        brandName: r.brand_id ? brandNameById.get(r.brand_id) ?? null : null,
        title: r.title ?? '',
        description: r.description,
        enhancedDescription: r.enhanced_description,
      }),
    );

    let results;
    try {
      results = await embedBatch(inputs);
    } catch (err) {
      errors.push({ id: 'batch:' + batchIdx, message: (err as Error).message });
      break;
    }

    // Write back row-by-row. We pass the vector as the bracketed literal
    // string form because supabase-js serialises arrays as JSON, which
    // pgvector rejects.
    const nowIso = new Date().toISOString();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const v = results[i];
      if (!v) continue;
      const { error: upErr } = await db
        .from('rrg_submissions')
        .update({
          embedding: toPgVectorLiteral(v.vector),
          embedded_at: nowIso,
          embedding_model: EMBEDDING_MODEL,
        })
        .eq('id', r.id);
      if (upErr) {
        errors.push({ id: r.id, message: upErr.message });
        continue;
      }
      totalRowsEmbedded++;
      totalTokens += v.tokensUsed;
    }
  }

  // Remaining count gives the caller a clear "how many more passes" signal.
  const { count: remaining } = await db
    .from('rrg_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('status', statusFilter)
    .is('embedding', null);

  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - started,
    model: EMBEDDING_MODEL,
    embedded: totalRowsEmbedded,
    tokens_used: totalTokens,
    cost_usd_estimate: (totalTokens * 0.02) / 1_000_000,
    remaining_with_null_embedding: remaining ?? null,
    errors,
  });
}
