/**
 * Resolve a spoken utterance into ONE Back Room tool call, through the
 * member's own agent.
 *
 * The member holds the microphone; their words go to their agent, which
 * chooses a single room tool and its arguments. Nothing is posted to the
 * room by the agent on its own initiative: the resolver only ever proposes
 * the action its human just asked for out loud (hard invariant 1, no AI
 * content in the room). The three deliberate acts (accept an introduction,
 * confirm a vouch, approve money out) are never auto-resolved: room_invite
 * only stages a vouch, and errand_purchase is not in the callable set here,
 * it is reached only through a human press in the UI.
 *
 * Milestone-1 spike: this returns the resolved call; execution against the
 * room store lands with the room MCP in milestone 2.
 */
import { resolveBuyerLlm, type ResolvedLlm } from '../buyer-llm';

export interface ResolvedAction {
  tool:      string | null;             // null when nothing actionable was said
  arguments: Record<string, unknown>;
  say:       string;                    // short confirmation addressed to the member
  llmLabel:  string;
}

// The tools a voice utterance may resolve to. Money out and vouch confirmation
// are deliberately excluded: those require a physical press.
const VOICE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'room_place_object',
      description: 'Place an object on the room table: a reference image, a link, a note, or a voice note. Use when the member says to put something on the table or share it with the room.',
      parameters: {
        type: 'object',
        properties: {
          object_type: { type: 'string', enum: ['image', 'link', 'note', 'voice_note'], description: 'What kind of object.' },
          content: { type: 'string', description: 'The link URL, the note text, or a short caption for an image/voice note.' },
          corner: { type: 'string', description: 'Optional corner of the table to place it in.' },
        },
        required: ['object_type', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'room_say',
      description: 'Say something to the room as ambient talk. Use for a spoken remark to the people at the table that is not an object.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'What to say to the room.' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'room_invite',
      description: 'Stage an invitation (a vouch) for someone to join the room. This only stages it; the member must then confirm the vouch with a deliberate press.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Who to invite, by name or handle.' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'errand_request_quote',
      description: 'Ask VIA to source something and get a quote: find a supplier, a pressing plant, a studio, a sample. Use when the member asks to find or price something. This only fetches a quote; paying is a separate deliberate press.',
      parameters: {
        type: 'object',
        properties: { request: { type: 'string', description: 'What to source or price, in plain words.' } },
        required: ['request'],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are a member's VIA agent inside a private Back Room. The member just spoke to you. Turn what they said into exactly one action by calling one tool, or none if they did not ask for anything actionable.

Rules:
- Only ever do what the member just asked. Never invent content, never post to the room on your own.
- Do not confirm a vouch or move money. Inviting only stages a vouch; sourcing only fetches a quote.
- Keep any spoken reply to the member to one short line. British English. No em dashes.`;

interface MemberLlmFields {
  llm_byo_provider?:      string | null;
  llm_byo_key_encrypted?: string | null;
  llm_byo_model?:         string | null;
}

export async function resolveUtterance(
  transcript: string,
  member?: MemberLlmFields,
): Promise<ResolvedAction> {
  const llm: ResolvedLlm = resolveBuyerLlm(member ?? {});
  if (!llm.apiKey) {
    return { tool: null, arguments: {}, say: 'VIA is being set up here.', llmLabel: llm.label };
  }

  const res = await fetch(`${llm.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
      tools: VOICE_TOOLS,
      tool_choice: 'auto',
      temperature: 0.1,
      // The content is discarded (see confirmationFor); keep the budget small
      // so the model emits the tool call promptly instead of reasoning aloud,
      // which is the dominant cost in the resolve step.
      max_tokens: 120,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`resolve LLM ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
  };
  const message = json.choices?.[0]?.message;
  const call = message?.tool_calls?.[0]?.function;

  let args: Record<string, unknown> = {};
  if (call?.arguments) {
    try { args = JSON.parse(call.arguments) as Record<string, unknown>; }
    catch { args = {}; }
  }

  return {
    tool: call?.name ?? null,
    arguments: args,
    // The confirmation is derived from the resolved tool, never from the
    // model's free content: content is where the model reasons aloud, and
    // that reasoning must not reach the member (short VIA voice, invariant 5).
    say: confirmationFor(call?.name, args),
    llmLabel: llm.label,
  };
}

function confirmationFor(tool: string | undefined, args: Record<string, unknown>): string {
  switch (tool) {
    case 'room_place_object':
      return 'On the table.';
    case 'room_say':
      return typeof args.text === 'string' && args.text.trim() ? args.text.trim() : 'Said.';
    case 'room_invite':
      return 'Staged. Press to vouch them in.';
    case 'errand_request_quote':
      return 'Finding that now.';
    default:
      return 'I did not catch an action there.';
  }
}
