-- Keep presentation reports out of public search while sample visibility is disabled.
create or replace function public.public_report_page(
  p_category uuid default null,
  p_barangay uuid default null,
  p_search text default '',
  p_offset integer default 0
)
returns table(
  id uuid,
  title text,
  category_id uuid,
  barangay_id uuid,
  status public.report_status,
  latitude double precision,
  longitude double precision,
  created_at timestamptz,
  is_demo boolean
)
language sql stable security definer set search_path=''
as $$
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
    and (not r.is_demo or private.sample_data_enabled())
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
)
returns table(
  id uuid,
  title text,
  category_id uuid,
  barangay_id uuid,
  status public.report_status,
  latitude double precision,
  longitude double precision,
  created_at timestamptz,
  is_demo boolean
)
language sql stable security definer set search_path=''
as $$
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
    and (not r.is_demo or private.sample_data_enabled())
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

notify pgrst, 'reload schema';
