create function public.map_barangay_counts(
  p_category uuid default null,
  p_barangay uuid default null,
  p_report_state public.report_status default null,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_verified_only boolean default false,
  p_unresolved_only boolean default false,
  p_office uuid default null,
  p_recurring_only boolean default false
)
returns table(barangay_id uuid, barangay_name text, report_count bigint)
language sql stable security invoker set search_path=''
as $$
  select b.id, b.name, count(r.id)
  from public.barangays b
  left join public.reports r on r.barangay_id=b.id
    and r.status not in ('rejected','duplicate')
    and (p_category is null or r.category_id=p_category)
    and (p_report_state is null or r.status=p_report_state)
    and (p_since is null or r.created_at>=p_since)
    and (p_until is null or r.created_at<p_until)
    and (not p_verified_only or r.verified_at is not null)
    and (not p_unresolved_only or r.status not in ('resolved','rejected','duplicate'))
    and (p_office is null or r.organization_id=p_office)
    and (not p_recurring_only or exists (
      select 1 from public.reports x
      cross join public.analytics_settings settings
      where x.id<>r.id and x.category_id=r.category_id
        and x.status not in ('rejected','duplicate')
        and abs(extract(epoch from r.created_at-x.created_at))<=settings.window_days*86400
        and extensions.st_dwithin(r.location,x.location,settings.radius_m)
    ))
  where private.active_staff()
    and (p_barangay is null or b.id=p_barangay)
  group by b.id,b.name
  order by count(r.id) desc,b.name
$$;
revoke execute on function public.map_barangay_counts(uuid,uuid,public.report_status,timestamptz,timestamptz,boolean,boolean,uuid,boolean) from public,anon;
grant execute on function public.map_barangay_counts(uuid,uuid,public.report_status,timestamptz,timestamptz,boolean,boolean,uuid,boolean) to authenticated;
