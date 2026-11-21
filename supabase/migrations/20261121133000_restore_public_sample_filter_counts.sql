-- Apply the same sample-visibility rule to public filter totals as to result pages.
create or replace function public.public_report_filter_counts(
  p_category uuid,
  p_barangay uuid,
  p_search text,
  p_recent boolean
)
returns table(all_count bigint, active_count bigint, resolved_count bigint)
language sql stable security definer set search_path=''
as $$
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
    and (not r.is_demo or private.sample_data_enabled())
    and (not p_recent or r.created_at >= now() - interval '30 days')
    and (p_category is null or r.category_id = p_category)
    and (p_barangay is null or r.barangay_id = p_barangay)
    and (nullif(trim(i.search), '') is null
      or r.public_summary ilike '%' || trim(i.search) || '%'
      or c.name ilike '%' || trim(i.search) || '%'
      or b.name ilike '%' || trim(i.search) || '%'
      or r.landmark ilike '%' || trim(i.search) || '%')
$$;

grant execute on function public.public_report_filter_counts(uuid,uuid,text,boolean) to authenticated;
revoke all on function public.public_report_filter_counts(uuid,uuid,text,boolean) from public,anon;
notify pgrst,'reload schema';
