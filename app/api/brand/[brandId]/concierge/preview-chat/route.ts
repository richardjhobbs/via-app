/**
 * POST /api/brand/[brandId]/concierge/preview-chat
 *
 * Public brand-concierge preview. Same memory pool the Telegram bot consumes
 * (rrg_brand_memories via rrg_brand_memory_list, plus the voice:system memory
 * block), but presented as a clean customer chat: no admin tools, no
 * "Locked in:" framing, no memory writes.
 *
 * No auth: this is a public test surface for asking the brand concierge
 * questions in the brand's own voice.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

interface ChatMessage {
  role:    'user' | 'assistant';
  content: string;
}

interface PreviewBody {
  messages:  ChatMessage[];
  sessionId?: string;
}

// ── Customer-facing system prompt builder ─────────────────────────────

function buildCustomerSystemPrompt(brandName: string, voiceBlock: string | null, memoriesBlock: string): string {
  const voicePara = voiceBlock
    ? `\n\nBrand voice for ${brandName},  internalise this, do not quote it back to the customer:\n${voiceBlock}`
    : '';
  return `You are the ${brandName} Concierge speaking with a customer on a public preview surface.

STRICT GROUNDING. The LIVE BRAND MEMORIES block below is the ONLY source of truth for policies, pricing, fees, sizing rules, store details, and anything else the brand has locked in. Never invent. If a question is not covered by the memories, say so plainly and offer to flag it for the brand to add.

Behaviour:
- Lead with the customer's question. Answer concisely in the brand voice.
- When the memories contain a verbatim policy quote on the topic, quote it directly rather than paraphrasing.
- Cite specifics (numbers, fees, timeframes, names) as they appear in the memories, never approximate.
- Do not use em dashes. Do not use unicode bullet characters.
- Keep replies short: at most 4 short paragraphs for a complex question, often one paragraph is enough.
- Do not narrate ("let me check"). Just answer.
- Never offer to "store" or "remember" anything,  that is the admin's job, not the customer's.${voicePara}

LIVE BRAND MEMORIES (locked in by ${brandName}; treat as authoritative):
${memoriesBlock || '(none)'}`;
}

// ── Memory loader (mirrors lib/rrg/brand-telegram-bot.ts getLiveMemoriesContext) ──

async function loadMemoriesBlock(brandSlug: string): Promise<string> {
  const { data, error } = await db.rpc('rrg_brand_memory_list', {
    p_slug:            brandSlug,
    p_type:            null,
    p_tag:             null,
    p_include_expired: false,
    p_limit:           60,
  });
  if (error) {
    console.warn(`[preview-chat] memory list error for ${brandSlug}: ${error.message}`);
    return '';
  }
  const rows = (data as Record<string, unknown>[] | null) ?? [];
  if (rows.length === 0) return '';
  return rows.map((m) => {
    const validUntil = m.valid_until as string | null;
    const expires = validUntil
      ? ` (valid until ${new Date(validUntil).toISOString().slice(0, 16).replace('T', ' ')} UTC)`
      : '';
    const tags = Array.isArray(m.tags) && (m.tags as string[]).length > 0
      ? ` [${(m.tags as string[]).join(', ')}]`
      : '';
    return `- ${String(m.type).toUpperCase()}: ${m.title}${expires}${tags}\n  ${m.body}`;
  }).join('\n\n');
}

async function loadVoiceBlock(brandSlug: string): Promise<string | null> {
  const { data, error } = await db.rpc('rrg_brand_memory_list', {
    p_slug:            brandSlug,
    p_type:            'general',
    p_tag:             'voice:system',
    p_include_expired: false,
    p_limit:           1,
  });
  if (error) return null;
  const row = Array.isArray(data) && data.length > 0 ? (data[0] as Record<string, unknown>) : null;
  const body = row?.body;
  return typeof body === 'string' && body.trim().length > 0 ? body.trim() : null;
}

// ── Route handler ──────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> },
) {
  const { brandId } = await params;

  const { data: brand, error: brandErr } = await db
    .from('rrg_brands')
    .select('id, slug, name')
    .eq('id', brandId)
    .single();
  if (brandErr || !brand) {
    return NextResponse.json({ error: `Brand not found: ${brandErr?.message ?? ''}` }, { status: 404 });
  }

  let body: PreviewBody;
  try {
    body = (await req.json()) as PreviewBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: '`messages` must be a non-empty array' }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Preview is not configured (missing DEEPSEEK_API_KEY).' }, { status: 503 });
  }

  const [memoriesBlock, voiceBlock] = await Promise.all([
    loadMemoriesBlock(brand.slug as string),
    loadVoiceBlock(brand.slug as string),
  ]);

  const systemPrompt = buildCustomerSystemPrompt(brand.name as string, voiceBlock, memoriesBlock);

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...body.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let reply = '';
  let tokensUsed = 0;
  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:       'deepseek-chat',
        messages:    apiMessages,
        max_tokens:  900,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[preview-chat] deepseek error ${resp.status}: ${errText.slice(0, 200)}`);
      return NextResponse.json({ error: `Upstream LLM error ${resp.status}` }, { status: 502 });
    }
    const data = await resp.json();
    reply = (data?.choices?.[0]?.message?.content as string | undefined)?.trim() ?? '';
    tokensUsed = ((data?.usage?.prompt_tokens as number | undefined) ?? 0)
               + ((data?.usage?.completion_tokens as number | undefined) ?? 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[preview-chat] LLM call failed:', msg);
    return NextResponse.json({ error: `LLM call failed: ${msg}` }, { status: 502 });
  }

  return NextResponse.json({
    reply: reply || '(no reply)',
    tokensUsed,
    memoriesCount: memoriesBlock ? memoriesBlock.split('\n\n').length : 0,
    voiceBlockUsed: voiceBlock != null,
  });
}
