'use client';

/**
 * Superadmin Back Room console. Runs the operator flows that were previously
 * only reachable by curl: form a room and seat founders, add a member of any of
 * the four kinds, and propose an introduction. Every request carries the admin
 * session cookie (same origin), so no secret is handled in the browser.
 */
import { useState } from 'react';
import type { ConsoleRoom } from '@/app/admin/backroom/page';

type Result = { ok: boolean; text: string } | null;

async function postJson(url: string, body: unknown): Promise<Result> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, text: JSON.stringify(json, null, 2) };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : 'request failed' };
  }
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="bg-paper border border-line rounded-lg p-6 mb-8">
      <h2 className="font-serif text-2xl tracking-tight mb-1">{title}</h2>
      <p className="text-xs text-ink-3 mb-5 max-w-2xl leading-relaxed">{note}</p>
      {children}
    </div>
  );
}

const inputCls = 'w-full bg-background border border-line rounded px-3 py-2 text-sm text-ink placeholder:text-ink-3';
const labelCls = 'block text-[10px] font-mono uppercase tracking-widest text-ink-3 mb-1';
const btnCls = 'px-4 py-2 rounded bg-ink text-background text-sm font-medium disabled:opacity-50';

function ResultBox({ r }: { r: Result }) {
  if (!r) return null;
  return (
    <pre className={`mt-3 text-xs font-mono whitespace-pre-wrap rounded p-3 border ${r.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
      {r.text}
    </pre>
  );
}

export function BackroomConsole({ rooms }: { rooms: ConsoleRoom[] }) {
  // Create room
  const [roomName, setRoomName] = useState('');
  const [accent, setAccent] = useState('#8a5a3c');
  const [founders, setFounders] = useState('');
  const [createRes, setCreateRes] = useState<Result>(null);
  const [creating, setCreating] = useState(false);

  // Add member
  const [mRoom, setMRoom] = useState(rooms[0]?.id ?? '');
  const [mPlatform, setMPlatform] = useState('via');
  const [mKind, setMKind] = useState('buyer');
  const [mRef, setMRef] = useState('');
  const [mWallet, setMWallet] = useState('');
  const [mFounder, setMFounder] = useState(false);
  const [memberRes, setMemberRes] = useState<Result>(null);
  const [addingMember, setAddingMember] = useState(false);

  // Introduction
  const [aHandle, setAHandle] = useState('');
  const [bHandle, setBHandle] = useState('');
  const [why, setWhy] = useState('');
  const [shared, setShared] = useState('');
  const [theyMake, setTheyMake] = useState('');
  const [opening, setOpening] = useState('');
  const [introRes, setIntroRes] = useState<Result>(null);
  const [proposing, setProposing] = useState(false);

  const base = typeof window !== 'undefined' ? window.location.origin : 'https://app.getvia.xyz';

  return (
    <div>
      {/* Create a room */}
      <Section
        title="Form a room"
        note="Creates a private room and gives it its own settlement wallet. Founders are seated straightaway (no vouch needed); everyone after them joins by being vouched in, up to fifty. Founders are VIA members listed comma separated by a buying-agent handle or a seller-store slug; the kind is detected for you. RRG brands are seated below in Add a member."
      >
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Room name</label>
            <input className={inputCls} value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="ADS&AI Room" />
          </div>
          <div>
            <label className={labelCls}>Accent colour</label>
            <input className={inputCls} value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="#8a5a3c" />
          </div>
          <div>
            <label className={labelCls}>Founders (handles)</label>
            <input className={inputCls} value={founders} onChange={(e) => setFounders(e.target.value)} placeholder="vinyl-junkie, dub-master" />
          </div>
        </div>
        <button
          className={`${btnCls} mt-4`}
          disabled={creating || !roomName.trim()}
          onClick={async () => {
            setCreating(true);
            setCreateRes(await postJson('/api/backroom/admin/rooms', {
              name: roomName.trim(),
              accent_hex: accent.trim() || undefined,
              founders: founders.split(',').map((s) => s.trim()).filter(Boolean),
            }));
            setCreating(false);
          }}
        >
          {creating ? 'Forming…' : 'Form room'}
        </button>
        <ResultBox r={createRes} />
      </Section>

      {/* Add a member */}
      <Section
        title="Add a member"
        note="Seat any of the four kinds. For a VIA member the ref is a buying-agent handle or a seller-store slug, and the kind is detected for you (the dropdown is only needed for RRG). An RRG brand concierge is rrg/seller with the brand slug; pass its wallet until the RRG identity endpoint is live. RRG personal concierges are not added here: they join by importing into VIA as a buying agent."
      >
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Room</label>
            <select className={inputCls} value={mRoom} onChange={(e) => setMRoom(e.target.value)}>
              {rooms.length === 0 && <option value="">no rooms yet</option>}
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Platform</label>
            <select className={inputCls} value={mPlatform} onChange={(e) => setMPlatform(e.target.value)}>
              <option value="via">via</option>
              <option value="rrg">rrg</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Kind</label>
            <select className={inputCls} value={mKind} onChange={(e) => setMKind(e.target.value)}>
              <option value="buyer">buyer</option>
              <option value="seller">seller</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Ref (handle or slug)</label>
            <input className={inputCls} value={mRef} onChange={(e) => setMRef(e.target.value)} placeholder="vinyl-junkie / 47brand" />
          </div>
          <div>
            <label className={labelCls}>Wallet (RRG only)</label>
            <input className={inputCls} value={mWallet} onChange={(e) => setMWallet(e.target.value)} placeholder="0x… (optional)" />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={mFounder} onChange={(e) => setMFounder(e.target.checked)} />
              Founder (no vouch)
            </label>
          </div>
        </div>
        <button
          className={`${btnCls} mt-4`}
          disabled={addingMember || !mRoom || !mRef.trim()}
          onClick={async () => {
            setAddingMember(true);
            setMemberRes(await postJson('/api/backroom/admin/room-members', {
              room_id: mRoom,
              platform: mPlatform,
              kind: mKind,
              ref: mRef.trim(),
              wallet: mWallet.trim() || undefined,
              is_founder: mFounder,
            }));
            setAddingMember(false);
          }}
        >
          {addingMember ? 'Adding…' : 'Add member'}
        </button>
        <ResultBox r={memberRes} />
      </Section>

      {/* Propose an introduction */}
      <Section
        title="Make an introduction"
        note="Proposes a warm, double-opt-in introduction between two VIA buyers. Each sees the context pack at their Door and accepts or declines; a decline is silent. On mutual accept they connect and a room can form. This is the hand-curated stand-in for the taste matcher."
      >
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Handle A</label>
            <input className={inputCls} value={aHandle} onChange={(e) => setAHandle(e.target.value)} placeholder="vinyl-junkie" />
          </div>
          <div>
            <label className={labelCls}>Handle B</label>
            <input className={inputCls} value={bHandle} onChange={(e) => setBHandle(e.target.value)} placeholder="dub-master" />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Why matched</label>
            <input className={inputCls} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Both chase the same low-end warmth from different chairs" />
          </div>
          <div>
            <label className={labelCls}>Shared references (comma)</label>
            <input className={inputCls} value={shared} onChange={(e) => setShared(e.target.value)} placeholder="dub plates, spring reverb" />
          </div>
          <div>
            <label className={labelCls}>What B makes</label>
            <input className={inputCls} value={theyMake} onChange={(e) => setTheyMake(e.target.value)} placeholder="cuts sound systems" />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>One opening thread</label>
            <input className={inputCls} value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="Ask about the 180 gram pressing" />
          </div>
        </div>
        <button
          className={`${btnCls} mt-4`}
          disabled={proposing || !aHandle.trim() || !bHandle.trim()}
          onClick={async () => {
            setProposing(true);
            setIntroRes(await postJson('/api/backroom/admin/introductions', {
              a_handle: aHandle.trim(),
              b_handle: bHandle.trim(),
              context_pack: {
                why: why.trim() || undefined,
                shared_references: shared.split(',').map((s) => s.trim()).filter(Boolean),
                they_make: theyMake.trim() || undefined,
                opening_thread: opening.trim() || undefined,
              },
            }));
            setProposing(false);
          }}
        >
          {proposing ? 'Proposing…' : 'Propose introduction'}
        </button>
        <ResultBox r={introRes} />
      </Section>

      {/* Existing rooms */}
      <Section
        title="Rooms"
        note="Every room, its members, and where to open each surface. Opening a room or a member's Door needs you signed in as that member; the links pre-fill a member handle where one exists."
      >
        {rooms.length === 0 ? (
          <p className="text-sm text-ink-3">No rooms yet. Form one above.</p>
        ) : (
          <div className="space-y-4">
            {rooms.map((r) => {
              const firstBuyer = r.members.find((m) => m.platform === 'via' && m.kind === 'buyer')?.ref;
              return (
                <div key={r.id} className="border border-line rounded p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="inline-block w-3 h-3 rounded-full" style={{ background: r.accent_hex }} />
                    <span className="font-serif text-lg">{r.name}</span>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">
                      {r.member_count} / 50 · from {r.created_from}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-ink-3 mb-3 break-all">{r.id}</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {r.members.map((m, i) => (
                      <span key={i} className="text-[11px] font-mono px-2 py-0.5 rounded bg-background border border-line text-ink-2">
                        {m.platform}/{m.kind} · {m.ref}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <a className="text-accent underline" target="_blank" rel="noreferrer" href={`${base}/room/${r.id}`}>
                      Inspect room (admin) ↗
                    </a>
                    {firstBuyer && (
                      <a className="text-accent underline" target="_blank" rel="noreferrer"
                         href={`${base}/room/${r.id}?handle=${encodeURIComponent(firstBuyer)}`}>
                        Open as {firstBuyer} ↗
                      </a>
                    )}
                    <a className="text-accent underline" target="_blank" rel="noreferrer" href={`${base}/rooms/${r.id}/mcp`}>
                      MCP card ↗
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
