import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import type { Agent } from './types';

const AGENT_SESSION_COOKIE = 'via_agent_session';

/** Set agent owner session cookie. */
export async function setAgentSession(agentId: string) {
  const cookieStore = await cookies();
  cookieStore.set(AGENT_SESSION_COOKIE, agentId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
}

/** Get current agent from session cookie. Returns null if not authenticated. */
export async function getSessionAgent(): Promise<Agent | null> {
  const cookieStore = await cookies();
  const agentId = cookieStore.get(AGENT_SESSION_COOKIE)?.value;
  if (!agentId) return null;

  const { data } = await db
    .from('agent_agents')
    .select('*')
    .eq('id', agentId)
    .single();

  return (data as Agent) ?? null;
}

/** Clear agent session. */
export async function clearAgentSession() {
  const cookieStore = await cookies();
  cookieStore.delete(AGENT_SESSION_COOKIE);
}

/** Admin auth check — same pattern as RRG. */
export async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token === process.env.ADMIN_SECRET;
}

export function adminUnauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
