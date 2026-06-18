import { notFound } from 'next/navigation';
import { db } from '@/lib/app/db';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { getBalance, usdToCredits } from '@/lib/app/buyer-credits';
import BuyerDashboardClient, { type BriefRow, type MatchRow, type PitchRow } from './BuyerDashboardClient';

export const dynamic = 'force-dynamic';

const OPEN_STATUSES = ['open', 'broadcast', 'matched'];

/**
 * Buying Agent dashboard. Every figure here is real: identity (name, agent
 * code, MCP endpoint) plus the buyer's own briefs (app_buyer_intents) and
 * trained preferences (app_buyer_memories). There is intentionally no live
 * negotiation/spend panel , that data has no backing store yet, so we show the
 * agent's real state and route untrained agents to training rather than
 * fabricating activity.
 */
export default async function BuyerAdminPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const { data: buyer, error } = await db
    .from('app_buyers')
    .select('id, handle, display_name, owner_user_id')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !buyer) return notFound();

  const user = await getBuyerUser();
  if (user?.id !== buyer.owner_user_id) return notFound();

  const buyerId = buyer.id as string;

  const [{ data: intents }, { count: prefsCount }, { data: matchData }, { count: matchCount }, { count: newCount }, { data: pitchData }, { count: offersCount }] = await Promise.all([
    db
      .from('app_buyer_intents')
      .select('id, intent_text, status, created_at, structured')
      .eq('buyer_id', buyerId)
      .order('created_at', { ascending: false })
      .limit(12),
    db
      .from('app_buyer_memories')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', buyerId)
      .eq('active', true),
    db
      .from('app_buyer_intent_matches')
      .select('id, title, seller_name, price_usdc, currency, product_url, created_at')
      .eq('buyer_id', buyerId)
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('app_buyer_intent_matches')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', buyerId),
    db
      .from('app_buyer_intent_matches')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', buyerId)
      .eq('status', 'new'),
    db
      .from('app_buyer_brief_pitches')
      .select('id, intent_id, product, verdict, seller_identity, seller_id, seller_slug, seller_name, status, created_at, app_buyer_intents!inner(intent_text)')
      .eq('buyer_id', buyerId)
      .order('created_at', { ascending: false })
      .limit(60),
    db
      .from('app_buyer_brief_pitches')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', buyerId),
  ]);

  // How many offers the buyer wants to see per brief (set during clarification).
  const DEFAULT_OPTION_COUNT = 5;
  const optionCountByIntent = new Map<string, number>();
  for (const i of (intents ?? []) as Array<{ id: string; structured: Record<string, unknown> | null }>) {
    const oc = (i.structured ?? {})['option_count'];
    optionCountByIntent.set(i.id, typeof oc === 'number' && oc > 0 ? oc : DEFAULT_OPTION_COUNT);
  }

  // Per-brief offer tally, so a broadcast brief with zero offers shows a clear
  // "broadcast, no offers yet, stays open" state instead of looking like a failure.
  const countByIntent = new Map<string, number>();
  for (const p of (pitchData ?? []) as { intent_id: string }[]) {
    countByIntent.set(p.intent_id, (countByIntent.get(p.intent_id) ?? 0) + 1);
  }

  // Resolve a buyable VIA product page for each offer so the dashboard can show a
  // real "Buy now" CTA that lands on the checkout panel (wallet + card via
  // thirdweb). An offer is buyable when its seller is a transactable VIA store
  // (has an agent wallet) and a fixed-price product can be identified , by the
  // product_id the seller now sends, or by matching the offer title for older
  // offers that predate that field. Non-VIA offers (e.g. RRG) keep their own link.
  const pitchRows = (pitchData ?? []) as Array<Record<string, unknown>>;
  const offerSellerIds = [...new Set(pitchRows.map((p) => p.seller_id as string | null).filter(Boolean))] as string[];
  const sellerMap = new Map<string, { slug: string | null; transactable: boolean }>();
  if (offerSellerIds.length) {
    const { data: sellerRows } = await db
      .from('app_sellers')
      .select('id, slug, agent_wallet_address')
      .in('id', offerSellerIds);
    for (const s of (sellerRows ?? []) as Array<Record<string, unknown>>) {
      sellerMap.set(s.id as string, { slug: (s.slug as string | null), transactable: Boolean(s.agent_wallet_address) });
    }
  }
  // Legacy offers (no product_id) from transactable sellers: resolve the product
  // id by matching the offer title against the seller's catalogue. Bounded by the
  // titles on screen, so a large catalogue is never pulled in full.
  const resolvedPid = new Map<string, string>(); // `${seller_id}|${title}` -> product_id
  const needResolve = pitchRows.filter((p) => {
    const product = (p.product ?? {}) as Record<string, unknown>;
    const sid = p.seller_id as string | null;
    return Boolean(sid && sellerMap.get(sid)?.transactable && !product.product_id && typeof product.title === 'string');
  });
  if (needResolve.length) {
    const titles = [...new Set(needResolve.map((p) => (p.product as Record<string, unknown>).title as string))];
    const sids = [...new Set(needResolve.map((p) => p.seller_id as string))];
    const { data: prodRows } = await db
      .from('app_seller_products')
      .select('id, seller_id, title, price_minor, pricing_mode, active, admin_removed, on_chain_status')
      .in('seller_id', sids)
      .in('title', titles);
    for (const pr of (prodRows ?? []) as Array<Record<string, unknown>>) {
      const buyable = pr.active === true
        && pr.admin_removed !== true
        && pr.price_minor !== null
        && ((pr.pricing_mode as string | null) ?? 'fixed') !== 'configurable'
        && ['draft', 'registered'].includes(pr.on_chain_status as string);
      if (buyable) resolvedPid.set(`${pr.seller_id as string}|${pr.title as string}`, pr.id as string);
    }
  }

  function offerBuyUrl(p: Record<string, unknown>, product: Record<string, unknown>): string | null {
    const sid = p.seller_id as string | null;
    const info = sid ? sellerMap.get(sid) : undefined;
    if (!info?.transactable || !info.slug) return null;
    const pid = (typeof product.product_id === 'string' && product.product_id)
      ? product.product_id
      : (sid ? resolvedPid.get(`${sid}|${(product.title as string) ?? ''}`) ?? null : null);
    return pid ? `/sellers/${info.slug}/products/${pid}` : null;
  }

  // OFFERS: seller offers against this buyer's briefs , now the primary result
  // list. Built from app_buyer_brief_pitches, attributed to the seller, ranked by
  // the judge score and capped per brief to the buyer's option_count.
  const allOffers: (PitchRow & { intentId: string })[] = pitchRows.map((p) => {
    const product = (p.product ?? {}) as Record<string, unknown>;
    const verdict = (p.verdict ?? {}) as Record<string, unknown>;
    const ident = (p.seller_identity ?? {}) as Record<string, unknown>;
    const briefRel = p.app_buyer_intents as { intent_text?: string } | { intent_text?: string }[] | null;
    const brief = Array.isArray(briefRel) ? briefRel[0] : briefRel;
    const sellerName = (p.seller_name as string | null)
      ?? (typeof ident.via_agent_id === 'string' || typeof ident.via_agent_id === 'number' ? `Agent ${ident.via_agent_id}` : null)
      ?? 'A seller agent';
    const fits = verdict.fits === true;
    const met = Array.isArray(verdict.met) ? (verdict.met as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const unmet = Array.isArray(verdict.unmet) ? (verdict.unmet as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    // fit = every hard requirement met; partial = some met, some not; no-fit = none.
    const tier: 'fit' | 'partial' | 'nofit' = fits ? 'fit' : met.length > 0 ? 'partial' : 'nofit';
    return {
      id: p.id as string,
      intentId: p.intent_id as string,
      productTitle: (product.title as string) ?? 'Untitled',
      priceUsdc: typeof product.price_usdc === 'number' ? product.price_usdc : null,
      url: (product.url as string | null) ?? null,
      buyUrl: offerBuyUrl(p, product),
      seller: sellerName,
      fits,
      tier,
      met,
      unmet,
      score: typeof verdict.score === 'number' ? verdict.score : 0,
      reason: (verdict.reason as string) ?? '',
      briefText: brief?.intent_text ?? '',
      createdAt: p.created_at as string,
    };
  });

  // Rank per brief (genuine fits first, then by judge score) and cap each brief to
  // its option_count, so the buyer sees the best N offers per brief, not a flood.
  const offersByIntent = new Map<string, (PitchRow & { intentId: string })[]>();
  for (const o of allOffers) {
    const arr = offersByIntent.get(o.intentId) ?? [];
    arr.push(o);
    offersByIntent.set(o.intentId, arr);
  }
  const pitches: PitchRow[] = [];
  for (const [intentId, group] of offersByIntent) {
    // SELECTION keeps the best N per brief by fit then score (so the strongest
    // offers survive the per-brief cap)...
    group.sort((a, b) => (Number(b.fits) - Number(a.fits)) || (b.score - a.score));
    const cap = optionCountByIntent.get(intentId) ?? DEFAULT_OPTION_COUNT;
    for (const o of group.slice(0, cap)) pitches.push(o);
  }
  // ...but the FEED itself shows most-recent first, so a freshly-arrived offer is
  // at the top rather than buried under older "fits"/Buy-now pitches.
  pitches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const newPitchCount = ((pitchData ?? []) as Array<{ status?: string }>).filter((p) => p.status === 'new').length;

  // Viewing the dashboard clears the new-results flash: mark this buyer's unseen
  // matches AND pitches as seen (the nav dot polls status='new'). Non-fatal.
  if ((newCount ?? 0) > 0) {
    await db.from('app_buyer_intent_matches').update({ status: 'seen' }).eq('buyer_id', buyerId).eq('status', 'new');
  }
  if (newPitchCount > 0) {
    await db.from('app_buyer_brief_pitches').update({ status: 'seen' }).eq('buyer_id', buyerId).eq('status', 'new');
  }

  const briefs: BriefRow[] = (intents ?? []).map((i) => ({
    id: i.id as string,
    text: i.intent_text as string,
    status: i.status as string,
    createdAt: i.created_at as string,
    matchCount: countByIntent.get(i.id as string) ?? 0,
  }));
  const openBriefs = briefs.filter((b) => OPEN_STATUSES.includes(b.status)).length;

  const creditsBalance = usdToCredits(await getBalance(buyerId));

  const matches: MatchRow[] = (matchData ?? []).map((m) => ({
    id: m.id as string,
    title: m.title as string,
    sellerName: m.seller_name as string,
    priceUsdc: (m.price_usdc as number | null),
    currency: m.currency as string,
    productUrl: m.product_url as string,
    createdAt: m.created_at as string,
  }));

  const name = (buyer.display_name as string | null) ?? (buyer.handle as string);
  const agentCode = `${(buyer.handle as string).toUpperCase().replace(/[^A-Z0-9]/g, '')}·BA`;
  const mcpUrl = `https://app.getvia.xyz/buyers/${buyer.handle}/mcp`;

  return (
    <BuyerDashboardClient
      name={name}
      handle={buyer.handle as string}
      buyerId={buyerId}
      agentCode={agentCode}
      mcpUrl={mcpUrl}
      prefsCount={prefsCount ?? 0}
      openBriefs={openBriefs}
      briefs={briefs}
      matches={matches}
      matchCount={matchCount ?? 0}
      newCount={newCount ?? 0}
      pitches={pitches}
      offersCount={offersCount ?? 0}
      newPitchCount={newPitchCount}
      credits={creditsBalance}
    />
  );
}
