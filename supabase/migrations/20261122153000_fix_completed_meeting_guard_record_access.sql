-- The shared trigger runs on several tables with different row shapes.
-- Read optional fields from the JSON records so absent columns stay null.
create or replace function private.guard_completed_meeting_writes()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_old_request uuid;
  v_new_request uuid;
  v_old_meeting uuid;
  v_new_meeting uuid;
  v_request_status text;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;

  if tg_table_name = 'meeting_requests' then
    if v_old is not null then v_old_request := (v_old ->> 'id')::uuid; end if;
    if v_new is not null then v_new_request := (v_new ->> 'id')::uuid; end if;
  elsif tg_table_name = 'meetings' then
    if v_old is not null then v_old_request := (v_old ->> 'request_id')::uuid; end if;
    if v_new is not null then v_new_request := (v_new ->> 'request_id')::uuid; end if;
  elsif tg_table_name = 'meeting_action_items' then
    if v_old is not null then v_old_meeting := (v_old ->> 'meeting_id')::uuid; end if;
    if v_new is not null then v_new_meeting := (v_new ->> 'meeting_id')::uuid; end if;
    select m.request_id into v_old_request from public.meetings m where m.id = v_old_meeting;
    select m.request_id into v_new_request from public.meetings m where m.id = v_new_meeting;
  else
    if v_old is not null then v_old_request := (v_old ->> 'request_id')::uuid; end if;
    if v_new is not null then v_new_request := (v_new ->> 'request_id')::uuid; end if;
  end if;

  if (v_old_request is not null and exists (
        select 1 from public.meetings m where m.request_id = v_old_request and m.completed
      )) or (v_new_request is not null and exists (
        select 1 from public.meetings m where m.request_id = v_new_request and m.completed
      )) then
    raise exception 'This meeting is complete and its details can no longer be changed.' using errcode = '23514';
  end if;

  if tg_table_name = 'meeting_request_offices' and tg_op = 'UPDATE'
    and (v_old ->> 'status') = 'pending'
    and (v_new ->> 'status') in ('accepted', 'declined') then
    select r.status into v_request_status from public.meeting_requests r where r.id = v_new_request;
    if v_request_status is distinct from 'approved' then
      raise exception 'The barangay must approve this meeting request before an office can respond.' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;
