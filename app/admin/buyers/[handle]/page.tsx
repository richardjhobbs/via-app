import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/app/db';
import { isAdminFromCookies } from '@/lib/app/auth';
import { BuyerDetailClient } from './BuyerDetailClient';

export const dynamic = 'force-dynamic';

export default async function AdminBuyerDetailPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  if (!(await isAdminFromCookies())) {
    const { handle } = await params;
    redirect(`/admin/login?next=/admin/buyers/${handle}`);
  }

  const { handle } = await params;

  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name, wallet_address, erc8004_buyer_id, erc8004_agent_id, public, delegation_caps, created_at, updated_at')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !buyer) return notFound();

  const buyerId = buyer.id as string;

  const [memoriesRes, intentsRes, interactionsRes] = await Promise.all([
    db.from('app_buyer_memories')
      .select('id, type, title, body, tags, active, created_at')
      .eq('buyer_id', buyerId)
      .order('created_at', { ascending: false })
      .limit(50),
    db.from('app_buyer_intents')
      .select('id, intent_text, status, broadcast_at, resolved_at, created_at')
      .eq('buyer_id', buyerId)
      .order('created_at', { ascending: false })
      .limit(30),
    db.from('app_mcp_interactions')
      .select('id, tool_name, agent_identity, status_code, duration_ms, created_at')
      .eq('buyer_id', buyerId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const caps = (buyer.delegation_caps ?? {}) as Record<string, unknown>;

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/admin" aria-label="Admin overview" className="inline-flex items-center gap-3">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">
              <span aria-hidden>&larr;</span> Overview
            </span>
          </Link>
          <form action="/api/admin/auth/logout" method="post">
            <button className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Buyer</p>
          <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-2">
            {(buyer.display_name as string | null) ?? buyer.handle as string}
          </h1>
          <p className="text-sm text-neutral-600 mb-8 font-mono">
            @{buyer.handle as string} · onboarded {new Date(buyer.created_at as string).toISOString().slice(0, 10)}
          </p>

          <BuyerDetailClient
            buyer={{
              id:                buyerId,
              handle:            buyer.handle as string,
              display_name:      buyer.display_name as string | null,
              wallet_address:    buyer.wallet_address as string,
              erc8004_buyer_id:  buyer.erc8004_buyer_id as string | null,
              erc8004_agent_id:  buyer.erc8004_agent_id as string | null,
              public:            buyer.public as boolean,
              delegation_caps:   caps,
            }}
            memories={(memoriesRes.data ?? []) as Array<{
              id: string; type: string; title: string; body: string; tags: string[]; active: boolean; created_at: string;
            }>}
            intents={(intentsRes.data ?? []) as Array<{
              id: string; intent_text: string; status: string; broadcast_at: string | null; resolved_at: string | null; created_at: string;
            }>}
            interactions={(interactionsRes.data ?? []) as Array<{
              id: string; tool_name: string; agent_identity: Record<string, unknown>; status_code: number | null; duration_ms: number | null; created_at: string;
            }>}
          />
        </div>
      </section>
    </main>
  );
}
