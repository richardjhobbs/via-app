-- 0024_fts_include_drafts.sql
--
-- search_app_products_fts filtered to on_chain_status = 'registered', but the
-- catalogue's buyable rule (lib/app/seller-catalog.ts buyableProducts) treats
-- on_chain_status IN ('draft','registered') as buyable under mint-on-purchase.
-- So buyable DRAFT listings were invisible to discovery FTS. Align the RPC with
-- the buyable rule.
--
-- Multi-word semantic discovery (e.g. "sourdough bread", where no product carries
-- every word) is NOT solved here: lexical FTS term frequency floods such queries
-- (a popular cross-vertical word like "bread" buries the intended category). That
-- is handled by the agentic matcher (extract intent -> single-word recall ->
-- cross-vertical gate -> AI judge) behind find_seller / submit_intent, not by FTS.
-- The strict AND tsquery is kept for lexical precision.
create or replace function search_app_products_fts(
  q            text,
  result_limit int default 20
)
returns table(id uuid, seller_id uuid, rank real)
language sql stable as $$
  with raw_query as (
    select
      websearch_to_tsquery('simple',  q)                                     as q_simple,
      websearch_to_tsquery('english', q)                                     as q_english,
      websearch_to_tsquery('simple',  regexp_replace(q, '[\s\-]+', '', 'g'))  as q_norm
  )
  select s.id, s.seller_id,
    greatest(
      ts_rank(s.search_tsv, rq.q_simple),
      ts_rank(s.search_tsv, rq.q_english),
      ts_rank(s.search_tsv, rq.q_norm)
    ) as rank
  from app_seller_products s
  cross join raw_query rq
  where s.active = true
    and s.admin_removed = false
    and s.on_chain_status in ('draft', 'registered')
    and (
      s.search_tsv @@ rq.q_simple
      or s.search_tsv @@ rq.q_english
      or s.search_tsv @@ rq.q_norm
    )
  order by rank desc
  limit result_limit;
$$;

grant execute on function search_app_products_fts(text, int) to anon, authenticated, service_role;
