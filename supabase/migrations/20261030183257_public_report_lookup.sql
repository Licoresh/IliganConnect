-- Resolve old notification links without relying on the newest 500 map records.
create function private.published_report_by_id(p_id uuid)
returns table(id uuid,title text,category_id uuid,barangay_id uuid,status public.report_status,
  latitude float8,longitude float8,created_at timestamptz,is_demo boolean)
language sql stable security definer set search_path='' as $$
  select r.id,r.public_summary,r.category_id,r.barangay_id,r.status,
    round(r.latitude::numeric,3)::float8,round(r.longitude::numeric,3)::float8,
    r.created_at,r.is_demo
  from public.reports r
  where r.id=p_id and auth.uid() is not null
    and (private.active_resident() or private.active_staff())
    and not r.is_demo and r.public_visible and r.public_summary is not null
    and r.status not in ('rejected','duplicate')
$$;

create function public.public_report_by_id(p_id uuid)
returns table(id uuid,title text,category_id uuid,barangay_id uuid,status public.report_status,
  latitude float8,longitude float8,created_at timestamptz,is_demo boolean)
language sql stable security invoker set search_path='' as $$
  select * from private.published_report_by_id(p_id)
$$;

revoke all on function private.published_report_by_id(uuid),public.public_report_by_id(uuid) from public,anon;
grant execute on function private.published_report_by_id(uuid),public.public_report_by_id(uuid) to authenticated;
