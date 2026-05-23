/**
 * Embedding helpers for semantic discovery.
 *
 * Why this exists: per feedback_semantic_discovery_principle and
 * feedback_agentic_commerce_vision, VIA's discovery layer must be
 * intent-driven and scalable to 100k products + 10k buyers. tsvector
 * cannot answer "any coffee?" when the coffee brand's products are
 * called "Caramel Swirl". Embeddings are the lingua franca for both
 * sides of A2A discovery: products carry one, intents carry one,
 * matching is cosine similarity.
 *
 * Model: OpenAI text-embedding-3-small (1536 dims, $0.02/M input
 * tokens). Cheap, fast, plenty for product retrieval at our scale.
 * Upgrade path is a column-type change + re-backfill.
 */

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMS = 1536;

/** Cost per input token in USD for the active model. */
const EMBED_COST_PER_TOKEN = 0.02 / 1_000_000; // $0.02 per 1M input tokens

export const EMBEDDING_MODEL = EMBED_MODEL;
export const EMBEDDING_DIMS = EMBED_DIMS;

export interface EmbedResult {
  vector: number[];
  tokensUsed: number;
  costUsd: number;
  model: string;
}

/**
 * Embed a single piece of text. Throws on API failure; callers decide
 * whether to fail open (e.g. fall back to tsvector) or hard.
 */
export async function embedText(input: string): Promise<EmbedResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('embedText: OPENAI_API_KEY not configured');
  }
  const text = (input ?? '').trim();
  if (!text) {
    throw new Error('embedText: input is empty');
  }

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.embeddings.create({
    model: EMBED_MODEL,
    input: text,
    encoding_format: 'float',
  });

  const vector = response.data[0]?.embedding;
  if (!vector || vector.length !== EMBED_DIMS) {
    throw new Error(
      `embedText: unexpected vector shape (got ${vector?.length}, expected ${EMBED_DIMS})`,
    );
  }
  const tokensUsed = response.usage?.prompt_tokens ?? 0;
  return {
    vector,
    tokensUsed,
    costUsd: tokensUsed * EMBED_COST_PER_TOKEN,
    model: EMBED_MODEL,
  };
}

/**
 * Embed a batch of texts in a single API call. Returns vectors in
 * the same order as inputs. Empty strings are passed as a single
 * space character to satisfy the API; the resulting vectors should
 * not be used for retrieval.
 */
export async function embedBatch(inputs: string[]): Promise<EmbedResult[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('embedBatch: OPENAI_API_KEY not configured');
  }
  if (inputs.length === 0) return [];

  const safe = inputs.map(t => (t ?? '').trim() || ' ');

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.embeddings.create({
    model: EMBED_MODEL,
    input: safe,
    encoding_format: 'float',
  });

  const totalTokens = response.usage?.prompt_tokens ?? 0;
  // Pro-rate cost evenly across inputs. Per-input precision isn't
  // available from the API (only total prompt_tokens); fine for billing.
  const perInputTokens = inputs.length > 0 ? totalTokens / inputs.length : 0;

  return response.data.map((d, i) => {
    if (!d.embedding || d.embedding.length !== EMBED_DIMS) {
      throw new Error(`embedBatch: bad vector at index ${i}`);
    }
    return {
      vector: d.embedding,
      tokensUsed: Math.round(perInputTokens),
      costUsd: Math.round(perInputTokens) * EMBED_COST_PER_TOKEN,
      model: EMBED_MODEL,
    };
  });
}

/**
 * Compose the canonical embedding input for a product. Brand name,
 * title, and enhanced/plain description in that order. Keep it
 * compact: embeddings benefit from concise focused text more than
 * raw token volume.
 */
export function composeProductEmbeddingInput(p: {
  brandName: string | null;
  title: string;
  description: string | null;
  enhancedDescription: string | null;
}): string {
  const parts: string[] = [];
  if (p.brandName) parts.push(p.brandName);
  if (p.title) parts.push(p.title);
  const body = (p.enhancedDescription ?? p.description ?? '').trim();
  if (body) parts.push(body.slice(0, 2000));
  return parts.join(' | ');
}

/**
 * Format a JS number[] as the Postgres vector literal. Supabase's
 * supabase-js auto-serialises arrays to JSON, which the vector type
 * rejects; we need the bracketed-string form (e.g. "[0.1,0.2,...]")
 * when passing as an RPC arg.
 */
export function toPgVectorLiteral(v: number[]): string {
  return '[' + v.join(',') + ']';
}
