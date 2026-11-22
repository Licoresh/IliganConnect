-- Let residents open the safe report summary attached to a meeting they can view.
create or replace function private.meeting_linked_report_by_request(p_request uuid)
returns table(
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
language sql stable security definer set search_path = '' as $function$
  select r.id,
    coalesce(nullif(btrim(r.public_summary), ''), r.title),
    r.category_id,
    r.barangay_id,
    r.status,
    round(r.latitude::numeric, 3)::float8,
    round(r.longitude::numeric, 3)::float8,
    r.created_at,
    r.is_demo
  from public.meeting_requests mr
  join public.reports r on r.id = mr.report_id
  where mr.id = p_request
    and mr.status = 'approved'
    and auth.uid() is not null
    and private.active_resident()
    and private.meeting_request_resident_can_view(mr.id)
    and (not r.is_demo or private.sample_data_enabled())
    and r.status not in ('rejected', 'duplicate')
$function$;

create or replace function public.meeting_linked_report_by_request(p_request uuid)
returns table(
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
language sql stable security invoker set search_path = '' as $function$
  select * from private.meeting_linked_report_by_request(p_request)
$function$;

revoke all on function private.meeting_linked_report_by_request(uuid), public.meeting_linked_report_by_request(uuid) from public, anon;
grant execute on function private.meeting_linked_report_by_request(uuid), public.meeting_linked_report_by_request(uuid) to authenticated;
