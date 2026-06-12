-- 0017_vinyl_search_fts.sql
--
-- Full-text search over app_seller_products INCLUDING the metadata.vinyl block,
-- so a buying agent with a specific intent (artist / record title / label /
-- catalogue number / format / genre / pressing year / grade) gets ranked,
-- relevant matches across the network at scale, instead of the in-memory ILIKE
-- scan that breaks past ~1k rows and never looked at metadata.
--
-- Mirrors scripts/005-product-search-fts.sql (RRG, proven). Idempotent.
--
-- Weights: A = identity fields agents search by (title, artist, record title,
-- label, catalogue number raw + dash/space-stripped); B = format / genre /
-- pressing country / year / grades; C = catch-all (description prose, which
-- carries the Discogs tracklist + credits, plus the whole metadata json).

begin;

alter table app_seller_products drop column if exists search_tsv;

alter table app_seller_products add column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('simple',  coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple',  coalesce(metadata->'vinyl'->>'artist', '')), 'A') ||
    setweight(to_tsvector('simple',  coalesce(metadata->'vinyl'->>'title', '')), 'A') ||
    setweight(to_tsvector('simple',  coalesce(metadata->'vinyl'->>'label', '')), 'A') ||
    setweight(to_tsvector('simple',  coalesce(metadata->'vinyl'->>'catalogue_number', '')), 'A') ||
    setweight(to_tsvector('simple',  coalesce(regexp_replace(metadata->'vinyl'->>'catalogue_number', '[\s\-]+', '', 'g'), '')), 'A') ||

    setweight(to_tsvector('simple',  coalesce(metadata->'vinyl'->>'format', '')), 'B') ||
    setweight(to_tsvector('simple',  coalesce(metadata->'vinyl'->>'genres', '')), 'B') ||
    setweight(to_tsvector('simple',  coalesce(metadata->'vinyl'->>'pressing_country', '')), 'B') ||
    setweight(to_tsvector('simple',  coalesce(metadata->'vinyl'->>'pressing_year', '')), 'B') ||
    setweight(to_tsvector('simple',  coalesce(metadata->'vinyl'->>'media_grade', '')), 'B') ||
    setweight(to_tsvector('simple',  coalesce(metadata->'vinyl'->>'sleeve_grade', '')), 'B') ||

    setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('simple',  coalesce(metadata::text, '')), 'C')
  ) stored;

create index if not exists idx_app_seller_products_search_tsv
  on app_seller_products using gin (search_tsv);

-- Ranked FTS hits. Gated to the same buyable rule as the rest of discovery
-- (active, not admin-removed, on-chain registered). When mint-on-purchase lands
-- (workstream 2) this WHERE is relaxed to surface discoverable drafts.
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
    and s.on_chain_status = 'registered'
    and (
      s.search_tsv @@ rq.q_simple
      or s.search_tsv @@ rq.q_english
      or s.search_tsv @@ rq.q_norm
    )
  order by rank desc
  limit result_limit;
$$;

grant execute on function search_app_products_fts(text, int) to anon, authenticated, service_role;

commit;
