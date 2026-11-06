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
language sql stable security definer set search_path='' as $$
  select r.id,
    r.public_summary,
    r.category_id,
    r.barangay_id,
    r.status,
    round(r.latitude::numeric, 3)::float8,
    round(r.longitude::numeric, 3)::float8,
    r.created_at,
    r.is_demo
  from public.reports r
  left join public.report_categories c on c.id = r.category_id
  left join public.barangays b on b.id = r.barangay_id
  where r.public_visible
    and r.public_summary is not null
    and r.status not in ('rejected', 'duplicate')
    and (p_category is null or r.category_id = p_category)
    and (p_barangay is null or r.barangay_id = p_barangay)
    and (
      nullif(trim(coalesce(p_search, '')), '') is null
      or r.public_summary ilike '%' || left(trim(p_search), 160) || '%'
      or c.name ilike '%' || left(trim(p_search), 160) || '%'
      or b.name ilike '%' || left(trim(p_search), 160) || '%'
      or r.landmark ilike '%' || left(trim(p_search), 160) || '%'
    )
  order by r.created_at desc, r.id
  limit 30 offset greatest(0, p_offset)
$$;

grant execute on function public.public_report_page(uuid, uuid, text, integer) to authenticated;
