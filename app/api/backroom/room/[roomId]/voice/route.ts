/**
 * The Room voice loop. Hold to speak in the room; the member's words go to
 * their agent, which resolves them into ONE room action and performs it as the
 * member. A quiet result comes back. The agent never posts on its own; it only
 * ever does what its human just said (hard invariant 1).
 *
 * POST multipart { handle, audio } , transcribe, resolve, execute, refresh.
 *
 * Money out is never here: errand_purchase is not in the voice-resolvable set;
 * paying needs a deliberate press (handled by the errand flow). Inviting only
 * stages a vouch; joining needs the confirm press.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { transcribe, SttError } from '@/lib/app/backroom/voice';
import { resolveUtterance } from '@/lib/app/backroom/resolve';
import { loadRoom, placeObject, sayToRoom, listTable } from '@/lib/app/backroom/rooms';
import { requireRoomMember } from '@/lib/app/backroom/ui-auth';
import { dryRunMatch } from '@/lib/app/buyer-matching';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface MemberLlm {
  llm_byo_provider:      string | null;
  llm_byo_key_encrypted: string | null;
  llm_byo_model:         string | null;
}

export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return NextResponse.json({ error: 'room not found' }, { status: 404 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 }); }
  const handle = String(form.get('handle') ?? '').trim();
  const target = String(form.get('target') ?? '').trim(); // 'chat' | 'table' | '' (smart)
  const audio = form.get('audio');
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: 'missing audio' }, { status: 400 });

  const auth = await requireRoomMember(handle, roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Transcribe.
  let transcript = '';
  try {
    const stt = await transcribe(await audio.arrayBuffer(), audio.type || 'audio/webm');
    transcript = stt.text;
  } catch (err) {
    if (err instanceof SttError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[room/voice] transcription failed:', err);
    return NextResponse.json({ error: 'could not transcribe' }, { status: 500 });
  }
  if (!transcript) {
    return NextResponse.json({ transcript: '', action: { tool: null, say: 'I did not catch that.' }, objects: await listTable(roomId) });
  }

  // Explicit target: the member chose Chat or Table on the speak toggle, so
  // skip the LLM and send the words straight there (predictable, no ambiguity).
  if (target === 'chat') {
    await sayToRoom(roomId, auth.member, transcript);
    return NextResponse.json({ transcript, action: { tool: 'room_say', say: 'Added to chat.' }, objects: await listTable(roomId) });
  }
  if (target === 'table') {
    const isUrl = /^https?:\/\/\S+$/i.test(transcript) || /^www\.\S+\.\S+$/i.test(transcript);
    await placeObject(roomId, auth.member, { object_type: isUrl ? 'link' : 'note', content: transcript });
    return NextResponse.json({ transcript, action: { tool: 'room_place_object', say: 'On the table.' }, objects: await listTable(roomId) });
  }

  // Resolve through the member's agent.
  const { data } = await db
    .from('app_buyers')
    .select('llm_byo_provider, llm_byo_key_encrypted, llm_byo_model')
    .eq('handle', handle)
    .maybeSingle();
  const action = await resolveUtterance(transcript, (data as MemberLlm) ?? undefined);

  // Execute the single resolved action as the member.
  let extra: Record<string, unknown> = {};
  switch (action.tool) {
    case 'room_place_object': {
      const a = action.arguments as { object_type?: string; content?: string; corner?: string };
      if (a.content) {
        const placed = await placeObject(roomId, auth.member, {
          object_type: a.object_type ?? 'note',
          content: a.content,
          corner: a.corner ?? null,
        });
        extra = { placed: { object_id: placed.id } };
      }
      break;
    }
    case 'room_say': {
      const a = action.arguments as { text?: string };
      if (a.text) { const said = await sayToRoom(roomId, auth.member, a.text); extra = { said: { event_id: said.id } }; }
      break;
    }
    case 'errand_request_quote': {
      const a = action.arguments as { request?: string };
      if (a.request) { const { results } = await dryRunMatch(a.request); extra = { quotes: results }; }
      break;
    }
    case 'room_invite': {
      const a = action.arguments as { name?: string };
      extra = { invite: { invitee: a.name ?? '', status: 'vouch_pending', requires: 'human_press' } };
      break;
    }
    default:
      break;
  }

  return NextResponse.json({
    transcript,
    action: { tool: action.tool, say: action.say },
    ...extra,
    objects: await listTable(roomId),
  });
}
