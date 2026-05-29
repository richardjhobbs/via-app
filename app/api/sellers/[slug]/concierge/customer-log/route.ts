import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { isConciergeAuthorized } from '@/lib/app/auth';
import { insertNotification } from '@/lib/app/notifications';

export const dynamic = 'force-dynamic';

interface Body {
  buyer_wallet?:   string;
  buyer_agent_id?: string;
  contact?:        string;
  channel?:        string;
  note:            string;
}

/**
 * POST /api/sellers/[slug]/concierge/customer-log
 *
 * The Hermes Sales Agent writes back a note about a buyer it just
 * interacted with. At least one of buyer_wallet / buyer_agent_id /
 * contact must be supplied so the seller can find the note later.
 * Also fires an in-app notification so the seller's bell picks it up.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!(await isConciergeAuthorized(req, slug))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const note    = typeof body.note === 'string' ? body.note.trim() : '';
  const wallet  = typeof body.buyer_wallet   === 'string' ? body.buyer_wallet.trim().toLowerCase() : null;
  const erc     = typeof body.buyer_agent_id === 'string' ? body.buyer_agent_id.trim()             : null;
  const contact = typeof body.contact        === 'string' ? body.contact.trim()                    : null;
  const channel = typeof body.channel        === 'string' && body.channel.trim().length > 0
                    ? body.channel.trim().slice(0, 40)
                    : 'concierge';

  if (note.length === 0 || note.length > 4000) {
    return NextResponse.json({ error: 'note must be 1-4000 characters' }, { status: 400 });
  }
  if (!wallet && !erc && !contact) {
    return NextResponse.json({ error: 'one of buyer_wallet, buyer_agent_id, or contact is required' }, { status: 400 });
  }

  const { data: seller } = await db
    .from('app_sellers')
    .select('id, name, owner_user_id')
    .eq('slug', slug)
    .maybeSingle();
  if (!seller) {
    return NextResponse.json({ error: 'seller not found' }, { status: 404 });
  }

  const { data, error } = await db
    .from('app_seller_customer_notes')
    .insert({
      seller_id:      seller.id,
      buyer_wallet:   wallet,
      buyer_agent_id: erc,
      contact:        contact,
      channel:        channel,
      note,
    })
    .select('id, created_at')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 });
  }

  // Surface to the seller's dashboard bell so they know the agent left
  // a customer note. Best-effort — failure here must not break the log.
  void insertNotification({
    ownerUserId: seller.owner_user_id as string,
    kind:        'enquiry',
    title:       'Sales Agent logged a customer note',
    body:        note.length > 240 ? `${note.slice(0, 240)}…` : note,
    link:        `/seller/${slug}/admin/sales-agent`,
    metadata:    {
      tool_name:      'customer_log',
      seller_id:      seller.id,
      buyer_wallet:   wallet,
      buyer_agent_id: erc,
      contact:        contact,
      channel,
      note_id:        data.id,
    },
  });

  return NextResponse.json({ ok: true, note_id: data.id, created_at: data.created_at });
}
