create function public.public_report_page(
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
    and p_status in ('all', 'active', 'resolved')
    and (p_status = 'all' or (p_status = 'resolved' and r.status = 'resolved') or (p_status = 'active' and r.status <> 'resolved'))
    and (not p_recent or r.created_at >= now() - interval '30 days')
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

grant execute on function public.public_report_page(uuid, uuid, text, integer, text, boolean) to authenticated;
revoke all on function public.public_report_page(uuid, uuid, text, integer, text, boolean) from public, anon;

create function public.public_report_filter_counts(
  p_category uuid,
  p_barangay uuid,
  p_search text,
  p_recent boolean
) returns table(all_count bigint, active_count bigint, resolved_count bigint)
language sql stable security definer set search_path='' as $$
  select count(*)::bigint,
    count(*) filter (where r.status <> 'resolved')::bigint,
    count(*) filter (where r.status = 'resolved')::bigint
  from public.reports r
  left join public.report_categories c on c.id = r.category_id
  left join public.barangays b on b.id = r.barangay_id
  where r.public_visible
    and r.public_summary is not null
    and r.status not in ('rejected', 'duplicate')
    and (not p_recent or r.created_at >= now() - interval '30 days')
    and (p_category is null or r.category_id = p_category)
    and (p_barangay is null or r.barangay_id = p_barangay)
    and (
      nullif(trim(coalesce(p_search, '')), '') is null
      or r.public_summary ilike '%' || left(trim(p_search), 160) || '%'
      or c.name ilike '%' || left(trim(p_search), 160) || '%'
      or b.name ilike '%' || left(trim(p_search), 160) || '%'
      or r.landmark ilike '%' || left(trim(p_search), 160) || '%'
    )
$$;

grant execute on function public.public_report_filter_counts(uuid, uuid, text, boolean) to authenticated;
revoke all on function public.public_report_filter_counts(uuid, uuid, text, boolean) from public, anon;
