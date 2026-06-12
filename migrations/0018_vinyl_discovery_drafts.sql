-- 0018_vinyl_discovery_drafts.sql
--
-- Mint-on-purchase: draft listings are now discoverable (the on-chain drop is
-- created at settlement, not before). Relax the FTS RPC gate from
-- registered-only to draft + registered. Apply AFTER the matching app deploy
-- so search never surfaces a listing the deployed buy_product would reject.

create or replace function search_app_products_fts(
  q            text,
  result_limit int default 20
)
returns table(id uuid, seller_id uuid, rank real)
language sql stable as $$
  with raw_query as (
    select
      websearch_to_tsquery('simple',  q)                                    as q_simple,
      websearch_to_tsquery('english', q)                                    as q_english,
      websearch_to_tsquery('simple',  regexp_replace(q, '[\s\-]+', '', 'g')) as q_norm
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
