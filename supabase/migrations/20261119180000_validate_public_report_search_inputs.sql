create function private.checked_public_report_search(value text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if length(coalesce(value, '')) > 160 then
    raise exception 'Search text must be 160 characters or fewer.' using errcode = '22023';
  end if;
  return coalesce(value, '');
end;
$$;
revoke all on function private.checked_public_report_search(text) from public, anon, authenticated;

create function private.checked_public_report_offset(value integer)
returns integer language plpgsql immutable set search_path = '' as $$
begin
  if value is null or value < 0 or value > 100000 then
    raise exception 'Report page offset must be between 0 and 100000.' using errcode = '22023';
  end if;
  return value;
end;
$$;
revoke all on function private.checked_public_report_offset(integer) from public, anon, authenticated;

create or replace function public.public_report_page(
  p_category uuid default null,
  p_barangay uuid default null,
  p_search text default '',
  p_offset integer default 0
) returns table(
  id uuid,
  title text,
  category_id uuid,
  barangay_id uuid,
  status public.report_status,
  latitude float8,
  longitude float8,
  created_at timestamptz,
  is_demo boolean
)
language sql stable security definer set search_path = '' as $$
  with input as materialized (
    select private.checked_public_report_search(p_search) as search,
      private.checked_public_report_offset(p_offset) as page_offset
  )
  select r.id, r.public_summary, r.category_id, r.barangay_id, r.status,
    round(r.latitude::numeric, 3)::float8, round(r.longitude::numeric, 3)::float8,
    r.created_at, r.is_demo
  from public.reports r
  cross join input i
  left join public.report_categories c on c.id = r.category_id
  left join public.barangays b on b.id = r.barangay_id
  where r.public_visible and r.public_summary is not null
    and r.status not in ('rejected', 'duplicate')
    and (p_category is null or r.category_id = p_category)
    and (p_barangay is null or r.barangay_id = p_barangay)
    and (nullif(trim(i.search), '') is null
      or r.public_summary ilike '%' || trim(i.search) || '%'
      or c.name ilike '%' || trim(i.search) || '%'
      or b.name ilike '%' || trim(i.search) || '%'
      or r.landmark ilike '%' || trim(i.search) || '%')
  order by r.created_at desc, r.id
  limit 30 offset (select page_offset from input)
$$;

create or replace function public.public_report_page(
  p_category uuid,
  p_barangay uuid,
  p_search text,
  p_offset integer,
  p_status text,
  p_recent boolean
) returns table(
  id uuid,
  title text,
  category_id uuid,
  barangay_id uuid,
  status public.report_status,
  latitude float8,
  longitude float8,
  created_at timestamptz,
  is_demo boolean
)
language sql stable security definer set search_path = '' as $$
  with input as materialized (
    select private.checked_public_report_search(p_search) as search,
      private.checked_public_report_offset(p_offset) as page_offset
  )
  select r.id, r.public_summary, r.category_id, r.barangay_id, r.status,
    round(r.latitude::numeric, 3)::float8, round(r.longitude::numeric, 3)::float8,
    r.created_at, r.is_demo
  from public.reports r
  cross join input i
  left join public.report_categories c on c.id = r.category_id
  left join public.barangays b on b.id = r.barangay_id
  where r.public_visible and r.public_summary is not null
    and r.status not in ('rejected', 'duplicate')
    and p_status in ('all', 'active', 'resolved')
    and (p_status = 'all' or (p_status = 'resolved' and r.status = 'resolved') or (p_status = 'active' and r.status <> 'resolved'))
    and (not p_recent or r.created_at >= now() - interval '30 days')
    and (p_category is null or r.category_id = p_category)
    and (p_barangay is null or r.barangay_id = p_barangay)
    and (nullif(trim(i.search), '') is null
      or r.public_summary ilike '%' || trim(i.search) || '%'
      or c.name ilike '%' || trim(i.search) || '%'
      or b.name ilike '%' || trim(i.search) || '%'
      or r.landmark ilike '%' || trim(i.search) || '%')
  order by r.created_at desc, r.id
  limit 30 offset (select page_offset from input)
$$;

create or replace function public.public_report_filter_counts(
  p_category uuid,
  p_barangay uuid,
  p_search text,
  p_recent boolean
) returns table(all_count bigint, active_count bigint, resolved_count bigint)
language sql stable security definer set search_path = '' as $$
  with input as materialized (
    select private.checked_public_report_search(p_search) as search
  )
  select count(*)::bigint,
    count(*) filter (where r.status <> 'resolved')::bigint,
    count(*) filter (where r.status = 'resolved')::bigint
  from public.reports r
  cross join input i
  left join public.report_categories c on c.id = r.category_id
  left join public.barangays b on b.id = r.barangay_id
  where r.public_visible and r.public_summary is not null
    and r.status not in ('rejected', 'duplicate')
    and (not p_recent or r.created_at >= now() - interval '30 days')
    and (p_category is null or r.category_id = p_category)
    and (p_barangay is null or r.barangay_id = p_barangay)
    and (nullif(trim(i.search), '') is null
      or r.public_summary ilike '%' || trim(i.search) || '%'
      or c.name ilike '%' || trim(i.search) || '%'
      or b.name ilike '%' || trim(i.search) || '%'
      or r.landmark ilike '%' || trim(i.search) || '%')
$$;

grant execute on function public.public_report_page(uuid, uuid, text, integer) to authenticated;
grant execute on function public.public_report_page(uuid, uuid, text, integer, text, boolean) to authenticated;
grant execute on function public.public_report_filter_counts(uuid, uuid, text, boolean) to authenticated;
revoke all on function public.public_report_page(uuid, uuid, text, integer) from public, anon;
