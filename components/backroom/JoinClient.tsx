'use client';

/**
 * Person-invitation landing. Shows the room and the why, then joins the
 * signed-in member, or points a visitor to sign in / create an agent first.
 */
import { useState } from 'react';
import Link from 'next/link';

interface TokenInvite { room_id: string; room_name: string; inviter_ref: string; why: string; inviter_card_slug?: string | null; }

export function JoinClient({ token, invite, memberRef, memberLabel }: {
  token: string;
  invite: TokenInvite | null;
  memberRef: string | null;
  memberLabel: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function join() {
    if (!memberRef) return;
    setBusy(true); setErr(null);
    const res = await fetch('/api/backroom/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ref: memberRef }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.room_id) {
      window.location.href = `/room/${json.room_id}`;
    } else {
      setErr(json.message || json.error || 'could not join');
      setBusy(false);
    }
  }

  const back = encodeURIComponent(`/backroom/join?token=${token}`);

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '64px 20px 120px' }}>
      <p className="br-sans" style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>An invitation</p>

      {!invite ? (
        <p className="br-serif" style={{ fontSize: 24, color: 'var(--ink-2)', marginTop: 24 }}>
          This invitation is not valid or has expired.
        </p>
      ) : (
        <>
          <h1 className="br-serif" style={{ fontSize: 32, fontWeight: 400, margin: '10px 0 6px', lineHeight: 1.15 }}>
            You are invited to {invite.room_name}.
          </h1>
          <p className="br-sans" style={{ fontSize: 15, color: 'var(--ink-3)', margin: '0 0 16px' }}>
            Vouched by {invite.inviter_ref}.
            {invite.inviter_card_slug && (
              <>
                {' '}
                <a href={`/taste/${invite.inviter_card_slug}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                  See who they are, in their own words
                </a>
              </>
            )}
          </p>
          {invite.why && (
            <p className="br-serif" style={{ fontSize: 19, color: 'var(--ink)', lineHeight: 1.5, borderLeft: '2px solid var(--accent)', paddingLeft: 14, margin: '0 0 28px' }}>
              {invite.why}
            </p>
          )}

          {memberRef ? (
            <>
              <button type="button" onClick={join} disabled={busy} className="br-sans"
                style={{ padding: '14px 28px', borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 15, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Joining…' : `Join as ${memberLabel ?? memberRef}`}
              </button>
              {err && <p className="br-sans" style={{ fontSize: 14, color: 'var(--danger)', marginTop: 12 }}>{err}</p>}
            </>
          ) : (
            <div>
              <p className="br-sans" style={{ fontSize: 15, color: 'var(--ink-2)', marginBottom: 14, lineHeight: 1.6 }}>
                Create your buying agent or sign in, then open this invitation again to join the room.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link href={`/onboard?role=buyer&next=${back}`} className="br-sans"
                  style={{ display: 'inline-block', padding: '12px 24px', borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--bg)', fontSize: 14, textDecoration: 'none' }}>
                  Create an agent
                </Link>
                <Link href={`/buyer/login?next=${back}`} className="br-sans"
                  style={{ display: 'inline-block', padding: '12px 24px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink)', fontSize: 14, textDecoration: 'none' }}>
                  Sign in
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
