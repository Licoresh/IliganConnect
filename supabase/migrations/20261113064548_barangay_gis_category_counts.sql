create function public.map_barangay_category_counts(
  p_barangay uuid default null,
  p_report_state public.report_status default null,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns table(
  barangay_id uuid,
  barangay_name text,
  category_id uuid,
  category_name text,
  report_count bigint
)
language sql stable security invoker set search_path=''
as $$
  select b.id, b.name, c.id, c.name, count(r.id)
  from public.barangays b
  join public.reports r on r.barangay_id=b.id
    and r.status not in ('rejected','duplicate')
    and (p_report_state is null or r.status=p_report_state)
    and (p_since is null or r.created_at>=p_since)
    and (p_until is null or r.created_at<p_until)
  join public.report_categories c on c.id=r.category_id
  where private.active_staff()
    and (p_barangay is null or b.id=p_barangay)
  group by b.id,b.name,c.id,c.name
  order by b.name,c.name
$$;

revoke execute on function public.map_barangay_category_counts(uuid,public.report_status,timestamptz,timestamptz) from public,anon;
grant execute on function public.map_barangay_category_counts(uuid,public.report_status,timestamptz,timestamptz) to authenticated;
