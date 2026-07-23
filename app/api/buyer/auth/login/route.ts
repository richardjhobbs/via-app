import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { setBuyerAuthCookies, getUserBuyers } from '@/lib/app/buyer-auth';
import { clientIp, isRateLimited } from '@/lib/app/rate-limit';
import { db } from '@/lib/app/db';
import { claimAgentMemories } from '@/lib/app/agent-memory-claims';
import { attachRrgShell } from '@/lib/app/rrg-shell';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

// POST /api/buyer/auth/login : buyer email/password login
export async function POST(req: NextRequest) {
  try {
    if (isRateLimited(`buyer-login|${clientIp(req)}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many attempts. Please wait a minute and try again.' }, { status: 429 });
    }

    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    // One generic 401 for both bad credentials and valid-credentials-without-
    // profile, so the response never confirms a valid email + password pair.
    if (error || !data.session) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const buyers = await getUserBuyers(data.user.id);
    if (buyers.length === 0) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Migration safety net: an owner who already has a VIA account (e.g. a
    // seller, or a buyer created before) attaches their upgraded agent by
    // logging in, rather than being forced to make a second account. Claim any
    // unclaimed RRG snapshot for this email onto their primary buyer (memory +
    // room seats), and (re)create the linked RRG chat shell. Both are
    // idempotent and best-effort, so a normal login with nothing to claim is a
    // cheap no-op.
    const userEmail = String(data.user.email ?? '').toLowerCase();
    const primary = buyers[0];
    try {
      const claimed = await claimAgentMemories(primary.buyerId, userEmail);
      // Only stand up the RRG chat shell when this login actually absorbed a
      // migrated agent, so an ordinary or system-buyer login is a cheap no-op
      // and never gains an unwanted RRG presence.
      if (claimed.claims > 0) {
        const { data: b } = await db
          .from('app_buyers')
          .select('display_name, wallet_address, erc8004_agent_id')
          .eq('id', primary.buyerId)
          .maybeSingle();
        if (b?.wallet_address) {
          await attachRrgShell({
            buyerId: primary.buyerId,
            email: userEmail,
            name: (b.display_name as string) ?? primary.handle,
            handle: primary.handle,
            walletAddress: b.wallet_address as string,
            erc8004AgentId: (b.erc8004_agent_id as string | null) ?? null,
          });
        }
        console.log(`[buyer/login] attached ${claimed.claims} snapshot(s) to handle=${primary.handle} on login`);
      }
    } catch (err) {
      console.error('[buyer/login] claim/attach on login failed:', err);
    }

    const response = NextResponse.json({
      user: { id: data.user.id, email: data.user.email },
      buyers,
    });

    setBuyerAuthCookies(response, data.session.access_token, data.session.refresh_token);

    return response;
  } catch (err) {
    console.error('[/api/buyer/auth/login]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
