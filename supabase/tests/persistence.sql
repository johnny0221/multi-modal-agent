begin;
set local role service_role;

insert into public.sources(id, filename, mime_type, storage_path, status) values
 ('00000000-0000-4000-8000-000000000001', 'first.pdf', 'application/pdf', 'test/first', 'ready'),
 ('00000000-0000-4000-8000-000000000002', 'other.pdf', 'application/pdf', 'test/other', 'ready'),
 ('00000000-0000-4000-8000-000000000003', 'processing.pdf', 'application/pdf', 'test/processing', 'processing');

insert into public.source_chunks(source_id, chunk_index, content, page_start, page_end, embedding) values
 ('00000000-0000-4000-8000-000000000001', 0, 'closest', 1, 1,
  (array[1::real, 0::real] || array_fill(0::real, array[1534]))::extensions.vector),
 ('00000000-0000-4000-8000-000000000001', 1, 'less similar', 2, 3,
  (array[0.8::real, 0.6::real] || array_fill(0::real, array[1534]))::extensions.vector),
 ('00000000-0000-4000-8000-000000000002', 0, 'other source must not leak', 1, 1,
  (array[1::real, 0::real] || array_fill(0::real, array[1534]))::extensions.vector),
 ('00000000-0000-4000-8000-000000000003', 0, 'not ready', 1, 1,
  (array[1::real, 0::real] || array_fill(0::real, array[1534]))::extensions.vector);

do $$
declare
  query_vector extensions.vector := (array[1::real, 0::real] || array_fill(0::real, array[1534]))::extensions.vector;
  selected uuid[] := array['00000000-0000-4000-8000-000000000001'::uuid];
  first_match record;
begin
  select * into first_match from public.match_source_chunks(query_vector, selected, 5) limit 1;
  assert first_match.content = 'closest', 'Cosine search must rank the closest chunk first';
  assert abs(first_match.similarity - 1) < 0.00001, 'Identical vectors must have similarity 1';
  assert (select count(*) = 2 from public.match_source_chunks(query_vector, selected, 5)), 'Search must be scoped to selected source';
  assert (select count(*) = 1 from public.match_source_chunks(query_vector, selected, 1)), 'Result limit must apply';
  assert (select count(*) = 0 from public.match_source_chunks(query_vector,
    array['00000000-0000-4000-8000-000000000003'::uuid], 5)), 'Processing sources must not be retrieved';

  begin
    perform public.match_source_chunks(query_vector, selected, 0);
    raise exception 'Invalid result limit accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.match_source_chunks(query_vector, array[]::uuid[], 5);
    raise exception 'Unscoped retrieval accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.match_source_chunks('[1,0]'::extensions.vector, selected, 5);
    raise exception 'Wrong vector dimensions accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.source_chunks(source_id, chunk_index, content, embedding)
      values(selected[1], 0, 'duplicate', query_vector);
    raise exception 'Duplicate chunk position accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.source_chunks(source_id, chunk_index, content, page_start, page_end, embedding)
      values(selected[1], 2, 'bad page range', 3, 2, query_vector);
    raise exception 'Invalid page range accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.source_chunks(source_id, chunk_index, content, embedding)
      values(selected[1], 2, 'zero vector', array_fill(0::real, array[1536])::extensions.vector);
    raise exception 'Zero vector accepted';
  exception when check_violation then null;
  end;

  assert not has_table_privilege('anon', 'public.sources', 'select'), 'Anonymous source access must be denied';
  assert not has_table_privilege('authenticated', 'public.source_chunks', 'select'), 'Browser chunk access must be denied';
  assert not has_function_privilege('anon', 'public.match_source_chunks(extensions.vector,uuid[],integer)', 'execute'), 'Anonymous RPC access must be denied';
  assert not has_function_privilege('authenticated', 'public.match_source_chunks(extensions.vector,uuid[],integer)', 'execute'), 'Authenticated browser RPC access must be denied';
  assert (select relrowsecurity from pg_class where oid = 'public.sources'::regclass), 'Sources RLS must be enabled';
  assert (select relrowsecurity from pg_class where oid = 'public.source_chunks'::regclass), 'Chunks RLS must be enabled';

  delete from public.sources where id = selected[1];
  assert not exists(select 1 from public.source_chunks where source_id = selected[1]), 'Deleting source must cascade to chunks';
end;
$$;

rollback;
