-- 0030_seller_scoped_fts.sql
--
-- Per-seller full-text search over app_seller_products. The network FTS
-- (search_app_products_fts, migration 0017) ranks across ALL sellers and caps
-- at result_limit BEFORE any seller filter, so it cannot retrieve one large
-- store's matches. The per-seller MCP list_products only paged the newest 250,
-- so a seller agent for a 6k-27k catalogue (e.g. the vinyl stores) never saw the
-- specific record a buyer asked for. This scopes the same indexed FTS to one
-- seller so the agent reaches the WHOLE catalogue by relevance, not a newest-N
-- window. Reuses the existing search_tsv generated column + GIN index (0017):
-- function add only, no table rewrite or lock.
--
-- Mirrors search_app_products_fts but adds the seller_id filter and the buyable
-- on_chain_status set ('draft','registered') per the mint-on-purchase rule (0024).

create or replace function search_app_products_fts_seller(
  q            text,
  p_seller_id  uuid,
  result_limit int default 200
)
returns table(id uuid, rank real)
language sql stable as $$
  with raw_query as (
    select
      websearch_to_tsquery('simple',  q)                                     as q_simple,
      websearch_to_tsquery('english', q)                                     as q_english,
      websearch_to_tsquery('simple',  regexp_replace(q, '[\s\-]+', '', 'g'))  as q_norm
  )
  select s.id,
    greatest(
      ts_rank(s.search_tsv, rq.q_simple),
      ts_rank(s.search_tsv, rq.q_english),
      ts_rank(s.search_tsv, rq.q_norm)
    ) as rank
  from app_seller_products s
  cross join raw_query rq
  where s.seller_id = p_seller_id
    and s.active = true
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

grant execute on function search_app_products_fts_seller(text, uuid, int) to anon, authenticated, service_role;
