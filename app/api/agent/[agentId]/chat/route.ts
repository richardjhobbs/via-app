import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { buildChatPrompt, streamChatWithTools } from '@/lib/agent/llm';
import { hasCredits, deductCredits, hasCapAvailable } from '@/lib/agent/credits';
import { loadMemories, formatMemoriesForPrompt, extractMemoriesFromSession } from '@/lib/agent/memory';
import type { Agent } from '@/lib/agent/types';

export const dynamic = 'force-dynamic';

/**
 * Strip em (U+2014) and en (U+2013) dashes from streamed LLM output.
 *
 * Defence in depth alongside the prompt rule in core-prompt.ts. DeepSeek
 * occasionally emits dashes anyway. The two-pass replace turns " WORD , NEXT "
 * cases into clean " WORD, NEXT " when both whitespace sides arrive in the
 * same chunk; the fallback strips a lone dash that survives across chunk
 * boundaries.
 */
function stripDashes(s: string): string {
  return s
    .replace(/\s+[\u2014\u2013]\s+/g, ', ')
    .replace(/[\u2014\u2013]/g, ',');
}

/**
 * Drop "Let me check\u2026" / "I'll search\u2026" preambles from the front of the
 * streamed response. Returns a per-stream stateful function: while still
 * in warmup (no substantive content emitted yet) it buffers chunks, peels
 * narration sentences off the front, and emits only once a non-narration
 * sentence arrives. Once a substantive chunk is emitted it switches off
 * and becomes a pass-through.
 *
 * Why server-side as well as the prompt rule: DeepSeek often opens every
 * tool-using turn with "Let me\u2026" despite the rule. Stripping it at the
 * stream layer is deterministic.
 */
const NARRATION_RE =
  /^(let me\s+(search|check|look|try|find|see|pull|grab|fetch|hop|also|do|run|take a look)|i'?ll\s+(search|check|look|try|find|see|pull|grab|fetch|run|take a look)|i'?m\s+(going to|gonna)\s+(search|check|look|try|find|pull|grab|run)|one (sec|second|moment)|hold on|give me (a sec|a second|a moment)|searching for|looking for|checking the|let's see|let's check|let's try|let's look)\b/i;

function makeNarrationStripper(): (chunk: string) => string {
  let warmup = true;
  let buf = '';
  const MAX_BUF = 400;

  return (chunk: string): string => {
    if (!warmup) return chunk;
    buf += chunk;

    while (buf.length > 0) {
      const termMatch = buf.match(/^([^.!?\n]*[.!?\n])\s*/);
      if (!termMatch) {
        if (buf.length > MAX_BUF) {
          warmup = false;
          const out = buf;
          buf = '';
          return out;
        }
        return '';
      }
      const sentence = termMatch[1].trim();
      if (NARRATION_RE.test(sentence)) {
        buf = buf.slice(termMatch[0].length);
        continue;
      }
      warmup = false;
      const out = buf;
      buf = '';
      return out;
    }
    return '';
  };
}

/**
 * POST /api/agent/[agentId]/chat
 *
 * Streaming chat with the agent's configured LLM.
 * Concierge (pro) tier only, requires credits.
 *
 * Body: { message: string, session_id: string, is_eval_preview?: boolean }
 * Returns: text/event-stream
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const { message, session_id, is_eval_preview = false } = await req.json();

  if (!message || !session_id) {
    return NextResponse.json({ error: 'message and session_id are required' }, { status: 400 });
  }

  // Load agent
  const { data: agent, error: agentErr } = await db
    .from('agent_agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (agentErr || !agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  if (agent.tier !== 'pro') {
    return NextResponse.json({ error: 'Chat requires Concierge tier' }, { status: 403 });
  }

  const canPay = await hasCredits(agentId);
  if (!canPay) {
    return NextResponse.json({ error: 'Insufficient credits for chat' }, { status: 402 });
  }

  // Hard weekly cap. Even with credits available the agent stops making
  // LLM calls once the cap is hit. Owner gets the cap-hit email and can
  // raise the cap from the dashboard.
  const capOk = await hasCapAvailable(agentId);
  if (!capOk) {
    return NextResponse.json(
      {
        error: 'weekly_cap_reached',
        message:
          "This agent has reached this week's LLM cap. The cap protects you from runaway LLM cost. Raise the cap from your dashboard to keep going this week.",
      },
      { status: 429 },
    );
  }

  // Store user message
  await db.from('agent_chat_messages').insert({
    agent_id: agentId,
    role: 'user',
    content: message,
    is_eval_preview,
    session_id,
  });

  // Load recent chat history for context
  const { data: history } = await db
    .from('agent_chat_messages')
    .select('role, content')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true })
    .limit(20);

  const messages = (history ?? []).map((m: { role: string; content: string }) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Load persistent memories and build prompt
  const memories = await loadMemories(agentId);
  const memoriesBlock = formatMemoriesForPrompt(memories);
  const systemPrompt = buildChatPrompt(agent as Agent, is_eval_preview, memoriesBlock);

  // Tool calls fired during this single chat turn. Used for the
  // chat_completed roll-up row written at the end of the stream.
  const toolNamesThisTurn: string[] = [];

  try {
    const { stream, getTokensUsed } = await streamChatWithTools(
      agent.llm_provider,
      systemPrompt,
      messages,
      agentId,
      {
        sessionId: session_id,
        // Per-tool-call audit log. Each row carries the tool name, args,
        // result preview, the tokens consumed by the LLM iteration that
        // produced this call (which become USDC cost when reconciled at
        // batch-pull time), and execution duration. Failures here do not
        // abort the chat stream.
        onToolCall: async (rec) => {
          toolNamesThisTurn.push(rec.tool_name);
          try {
            await db.from('agent_activity_log').insert({
              agent_id: agentId,
              action: 'tool_call',
              details: {
                session_id,
                iteration: rec.iteration,
                tool_name: rec.tool_name,
                args: rec.args,
                result_preview: rec.result_preview,
                tokens_in_iteration: rec.tokens_in_iteration,
                duration_ms: rec.duration_ms,
                provider: agent.llm_provider,
              },
            });
          } catch (err) {
            console.error('[tool_call audit log]', err);
          }
        },
      },
      (agent as Agent).sex ?? null,
    );

    // Collect full response while streaming to client
    let fullResponse = '';
    const peelNarration = makeNarrationStripper();

    const encoder = new TextEncoder();
    const outputStream = new ReadableStream({
      async start(controller) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const cleaned = stripDashes(peelNarration(value));
            if (cleaned.length === 0) continue;
            fullResponse += cleaned;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(cleaned)}\n\n`));
          }

          // Store assistant message and deduct credits
          const tokensUsed = getTokensUsed();
          const costPerToken = agent.llm_provider === 'claude' ? 0.000005
            : agent.llm_provider === 'openai' ? 0.000003
            : 0.000001;
          const costUsdc = Math.max(tokensUsed * costPerToken, 0.0001);

          await db.from('agent_chat_messages').insert({
            agent_id: agentId,
            role: 'assistant',
            content: fullResponse,
            is_eval_preview,
            tokens_used: tokensUsed,
            cost_usdc: costUsdc,
            session_id,
          });

          await deductCredits(agentId, tokensUsed, agent.llm_provider);

          // Roll-up activity row for the dashboard's Activity panel.
          // One entry per user message rather than one per tool call.
          // Individual tool_call rows remain for audit but are hidden
          // from the UI by the activity API.
          try {
            await db.from('agent_activity_log').insert({
              agent_id: agentId,
              action: 'chat_completed',
              details: {
                session_id,
                user_message_preview: message.slice(0, 120),
                tokens_used: tokensUsed,
                cost_usdc: costUsdc,
                tool_count: toolNamesThisTurn.length,
                tool_names: toolNamesThisTurn,
                provider: agent.llm_provider,
              },
            });
          } catch (err) {
            console.error('[chat_completed audit log]', err);
          }

          // Extract memories from conversation (async, non-blocking)
          // Trigger after every 4+ messages in the session
          const { count: msgCount } = await db
            .from('agent_chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('session_id', session_id);

          if (msgCount && msgCount >= 4 && msgCount % 4 === 0) {
            extractMemoriesFromSession(agentId, session_id, agent.llm_provider)
              .catch(err => console.error('[memory extract bg]', err));
          }

          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (err) {
          console.error('[chat stream]', err);
          controller.error(err);
        }
      },
    });

    return new Response(outputStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('[chat]', err);
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 });
  }
}

/**
 * GET /api/agent/[agentId]/chat?session_id=...
 *
 * Load chat history for a session.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const sessionId = req.nextUrl.searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 });
  }

  const { data: messages } = await db
    .from('agent_chat_messages')
    .select('id, created_at, role, content, is_eval_preview, tokens_used, cost_usdc')
    .eq('agent_id', agentId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(50);

  return NextResponse.json({ messages: messages ?? [] });
}
