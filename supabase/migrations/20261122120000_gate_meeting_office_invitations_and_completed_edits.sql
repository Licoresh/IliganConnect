-- Hold office invitations until the assigned barangay approves the request.
-- Completed meetings remain readable but cannot be changed.

create or replace function private.meeting_request_office_read_access(p_request uuid, p_organization uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $function$
select exists (
  select 1
  from public.meeting_requests r
  join public.profiles p on p.id = (select auth.uid()) and p.account_status = 'active'
  where r.id = p_request
    and private.sample_request_visible(r.id)
    and (
      p.role = 'admin'
      or (p.role = 'barangay' and p.barangay_id = r.barangay_id)
      or (p.role = 'resident' and p.id = r.resident_id)
      or (p.role = 'office' and r.status = 'approved' and exists (
        select 1
        from public.meeting_request_offices i
        join public.organization_memberships m on m.organization_id = i.organization_id
        join public.organizations o on o.id = m.organization_id and o.active
        where i.request_id = r.id and i.organization_id = p_organization
          and m.user_id = p.id
      ))
    )
)
$function$;

create or replace function private.meeting_invited_office_access(p_request uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $function$
select exists (
  select 1
  from public.meeting_request_offices i
  join public.meeting_requests r on r.id = i.request_id and r.status = 'approved'
  join public.organization_memberships m on m.organization_id = i.organization_id
  join public.organizations o on o.id = m.organization_id and o.active
  join public.profiles p on p.id = m.user_id and p.role = 'office' and p.account_status = 'active'
  where i.request_id = p_request and p.id = (select auth.uid())
)
$function$;

-- The older scope path also granted offices access to matching requests without
-- an invitation. Keep its category and jurisdiction checks, but require both
-- barangay approval and an invitation to one of the member's offices.
create or replace function private.meeting_access(r uuid, action text default 'read')
returns boolean
language sql stable security definer
set search_path = ''
as $function$
select exists (
  select 1
  from public.meeting_requests req
  join public.profiles p on p.id = (select auth.uid())
  where req.id = r and p.account_status = 'active'
    and (
      p.role = 'admin'
      or (p.role = 'barangay' and p.barangay_id = req.barangay_id)
      or (p.role = 'office' and req.status = 'approved' and exists (
        select 1
        from public.organization_memberships m
        join public.organizations o on o.id = m.organization_id and o.active and o.can_coordinate
        join public.organization_access_rules a on a.organization_id = o.id and a.enabled
        join public.meeting_request_offices i on i.request_id = req.id and i.organization_id = o.id
        left join public.reports linked on linked.id = req.report_id
        where m.user_id = p.id
          and (a.barangay_id is null or a.barangay_id = req.barangay_id)
          and a.category_id = coalesce(linked.category_id, req.category_id)
          and (not a.assignment_only or linked.organization_id = o.id)
          and (action = 'read' or a.can_review)
      ))
    )
)
$function$;

revoke all on function private.meeting_request_office_read_access(uuid, uuid) from public, anon;
revoke all on function private.meeting_invited_office_access(uuid) from public, anon;
grant execute on function private.meeting_request_office_read_access(uuid, uuid) to authenticated;
grant execute on function private.meeting_invited_office_access(uuid) to authenticated;

-- Invitation rows may be prepared while a request is pending, but office
-- accounts cannot see them or respond until the request is approved.
create or replace function private.meeting_request_office_notification()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_sample boolean;
  v_request_status text;
begin
  select r.is_sample, r.status into v_sample, v_request_status
  from public.meeting_requests r where r.id = new.request_id;
  if not found or v_sample or v_request_status <> 'approved' then return new; end if;

  if tg_op = 'INSERT' or (old.status = 'declined' and new.status = 'pending') then
    insert into public.notifications(user_id, title, meeting_request_id)
    select distinct p.id, 'You are invited to a community meeting', new.request_id
    from public.organization_memberships m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = new.organization_id and p.role = 'office'
      and p.account_status = 'active' and p.notifications_enabled;
  elsif old.status is distinct from new.status then
    insert into public.notifications(user_id, title, meeting_request_id)
    select p.id,
      case new.status when 'accepted' then 'An invited office accepted a meeting' else 'An invited office declined a meeting' end,
      new.request_id
    from public.profiles p
    join public.meeting_requests r on r.id = new.request_id
    where p.notifications_enabled and p.account_status = 'active'
      and (p.id = r.resident_id or (p.role = 'barangay' and p.barangay_id = r.barangay_id));
  end if;
  return new;
end
$function$;

create or replace function private.notify_meeting_offices_after_approval()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
begin
  if old.status is not distinct from new.status or new.status <> 'approved' or new.is_sample then
    return new;
  end if;

  insert into public.notifications(user_id, title, meeting_request_id)
  select distinct p.id, 'You are invited to a community meeting', new.id
  from public.meeting_request_offices i
  join public.organization_memberships m on m.organization_id = i.organization_id
  join public.profiles p on p.id = m.user_id
  where i.request_id = new.id and i.status = 'pending'
    and p.role = 'office' and p.account_status = 'active' and p.notifications_enabled;
  return new;
end
$function$;

revoke all on function private.notify_meeting_offices_after_approval() from public, anon, authenticated;
drop trigger if exists meeting_request_offices_after_approval on public.meeting_requests;
create trigger meeting_request_offices_after_approval
  after update of status on public.meeting_requests
  for each row execute function private.notify_meeting_offices_after_approval();

-- Guard direct table writes too, so stale clients cannot bypass read-only UI.
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
    and old.status = 'pending' and new.status in ('accepted', 'declined') then
    select r.status into v_request_status from public.meeting_requests r where r.id = new.request_id;
    if v_request_status is distinct from 'approved' then
      raise exception 'The barangay must approve this meeting request before an office can respond.' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

revoke all on function private.guard_completed_meeting_writes() from public, anon, authenticated;

drop trigger if exists meeting_requests_completed_guard on public.meeting_requests;
create trigger meeting_requests_completed_guard
  before update or delete on public.meeting_requests
  for each row execute function private.guard_completed_meeting_writes();
drop trigger if exists meetings_completed_guard on public.meetings;
create trigger meetings_completed_guard
  before insert or update or delete on public.meetings
  for each row execute function private.guard_completed_meeting_writes();
drop trigger if exists meeting_actions_completed_guard on public.meeting_action_items;
create trigger meeting_actions_completed_guard
  before insert or update or delete on public.meeting_action_items
  for each row execute function private.guard_completed_meeting_writes();
drop trigger if exists meeting_office_invites_completed_guard on public.meeting_request_offices;
create trigger meeting_office_invites_completed_guard
  before insert or update or delete on public.meeting_request_offices
  for each row execute function private.guard_completed_meeting_writes();
drop trigger if exists meeting_barangay_invites_completed_guard on public.meeting_request_barangays;
create trigger meeting_barangay_invites_completed_guard
  before insert or update or delete on public.meeting_request_barangays
  for each row execute function private.guard_completed_meeting_writes();

notify pgrst, 'reload schema';
