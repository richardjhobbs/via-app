import { invitationByToken } from '@/lib/app/backroom/invitations';
import { primarySessionMember } from '@/lib/app/backroom/ui-auth';
import { JoinClient } from '@/components/backroom/JoinClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Join a room · VIA' };

// A person invitation landing. The link carries the room and the why; the
// visitor registers (or signs in) and the token joins them to the room.
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const sp = await searchParams;
  const token = typeof sp.token === 'string' ? sp.token.trim() : '';
  const invite = token ? await invitationByToken(token) : null;
  const me = await primarySessionMember();
  return <JoinClient token={token} invite={invite} memberRef={me?.ref ?? null} memberLabel={me?.label ?? null} />;
}
