begin;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  filename text not null check (char_length(filename) between 1 and 512),
  mime_type text not null check (char_length(mime_type) between 1 and 255),
  storage_path text not null unique check (char_length(storage_path) > 0),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'failed')),
  -- This corpus uses one embedding space. Changing model requires a migration/re-embedding.
  embedding_model text not null default 'text-embedding-3-small'
    check (embedding_model = 'text-embedding-3-small'),
  created_at timestamptz not null default now()
);

create table public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(btrim(content)) > 0),
  page_start integer,
  page_end integer,
  embedding extensions.vector(1536) not null check (extensions.vector_norm(embedding) > 0),
  unique (source_id, chunk_index),
  check (
    (page_start is null and page_end is null) or
    (page_start is not null and page_end is not null and page_start >= 1 and page_end >= page_start)
  )
);

-- No browser access in this local, single-user checkpoint.
-- Secret/service-role keys bypass RLS: never expose the backend publicly without authorization.
alter table public.sources enable row level security;
alter table public.source_chunks enable row level security;
revoke all on public.sources, public.source_chunks from public, anon, authenticated;
grant select, insert, update, delete on public.sources, public.source_chunks to service_role;
grant usage on schema extensions to service_role;

create function public.match_source_chunks(
  p_query_embedding extensions.vector(1536),
  p_source_ids uuid[],
  p_limit integer default 5
)
returns table (
  id uuid,
  source_id uuid,
  chunk_index integer,
  content text,
  page_start integer,
  page_end integer,
  similarity double precision
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_query_embedding is null
    or extensions.vector_dims(p_query_embedding) <> 1536
    or extensions.vector_norm(p_query_embedding) = 0 then
    raise exception 'Query embedding must be a nonzero 1536-dimensional vector' using errcode = '22023';
  end if;
  if p_source_ids is null or cardinality(p_source_ids) not between 1 and 20 then
    raise exception 'Select between 1 and 20 sources' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 20 then
    raise exception 'Result limit must be between 1 and 20' using errcode = '22023';
  end if;

  -- Exact cosine search first. Add an index only after measuring real data/latency.
  return query
    select c.id, c.source_id, c.chunk_index, c.content, c.page_start, c.page_end,
      1 - (c.embedding operator(extensions.<=>) p_query_embedding) as similarity
    from public.source_chunks c
    join public.sources s on s.id = c.source_id
    where c.source_id = any(p_source_ids) and s.status = 'ready'
    order by c.embedding operator(extensions.<=>) p_query_embedding, c.id
    limit p_limit;
end;
$$;

-- Functions allow PUBLIC execution by default; explicitly close that privilege.
revoke all on function public.match_source_chunks(extensions.vector, uuid[], integer)
  from public, anon, authenticated;
grant execute on function public.match_source_chunks(extensions.vector, uuid[], integer)
  to service_role;

commit;
