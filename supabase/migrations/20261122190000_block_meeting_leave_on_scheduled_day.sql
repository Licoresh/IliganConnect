create or replace function private.leave_meeting_request(p_request uuid)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_starts_at timestamptz;
begin
  if not private.active_resident() then
    raise exception 'An active resident account is required.' using errcode = '42501';
  end if;

  select m.starts_at into v_starts_at
  from public.meetings m
  where m.request_id = p_request
  for update;

  if v_starts_at is not null
     and (v_starts_at at time zone 'Asia/Manila')::date <= (now() at time zone 'Asia/Manila')::date then
    raise exception 'You can no longer leave this meeting on or after its scheduled date.' using errcode = '23514';
  end if;

  delete from public.meeting_resident_participants
  where request_id = p_request and resident_id = (select auth.uid());
end
$function$;
