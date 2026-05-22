import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { buildChatPrompt, streamChatWithTools } from '@/lib/agent/llm';
import { hasCredits, deductCredits } from '@/lib/agent/credits';
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
    );

    // Collect full response while streaming to client
    let fullResponse = '';

    const encoder = new TextEncoder();
    const outputStream = new ReadableStream({
      async start(controller) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const cleaned = stripDashes(value);
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
