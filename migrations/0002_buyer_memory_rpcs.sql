-- via-app: Buying Agent memory RPCs (Stage 2).
--
-- Mirrors the app_seller_memory_* RPCs from 0001, scoped to
-- app_buyer_memories + app_buyers.handle. app_buyer_memories has no
-- valid_until column, so there is no expiry filter here.
--
-- Run with: psql $SUPABASE_DB_URL -f migrations/0002_buyer_memory_rpcs.sql
-- Or via the Supabase dashboard SQL editor.

begin;

create or replace function app_buyer_memory_list(
  p_handle  text,
  p_type    text default null,
  p_tag     text default null,
  p_limit   integer default 100
) returns setof app_buyer_memories
language plpgsql security definer set search_path = public
as $$
declare
  v_buyer_id uuid;
begin
  select id into v_buyer_id from app_buyers where handle = p_handle;
  if v_buyer_id is null then
    return;
  end if;
  return query
    select * from app_buyer_memories
    where buyer_id = v_buyer_id
      and active
      and (p_type is null or type = p_type)
      and (p_tag  is null or p_tag = any (tags))
    order by created_at desc
    limit p_limit;
end;
$$;

create or replace function app_buyer_memory_upsert(
  p_handle      text,
  p_type        text,
  p_title       text,
  p_body        text,
  p_structured  jsonb default '{}'::jsonb,
  p_tags        text[] default '{}',
  p_id          uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_buyer_id  uuid;
  v_memory_id uuid;
begin
  select id into v_buyer_id from app_buyers where handle = p_handle;
  if v_buyer_id is null then
    raise exception 'app_buyer_memory_upsert: unknown buyer handle %', p_handle;
  end if;

  if p_id is not null then
    update app_buyer_memories
      set type = p_type, title = p_title, body = p_body,
          structured = p_structured, tags = p_tags, active = true
      where id = p_id and buyer_id = v_buyer_id
      returning id into v_memory_id;
    if v_memory_id is null then
      raise exception 'app_buyer_memory_upsert: memory % not owned by buyer %', p_id, p_handle;
    end if;
  else
    insert into app_buyer_memories (buyer_id, type, title, body, structured, tags)
      values (v_buyer_id, p_type, p_title, p_body, p_structured, p_tags)
      returning id into v_memory_id;
  end if;

  return v_memory_id;
end;
$$;

create or replace function app_buyer_memory_forget(
  p_handle  text,
  p_id      uuid
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_buyer_id uuid;
  v_rows     integer;
begin
  select id into v_buyer_id from app_buyers where handle = p_handle;
  if v_buyer_id is null then
    return false;
  end if;
  update app_buyer_memories set active = false
    where id = p_id and buyer_id = v_buyer_id;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

commit;
