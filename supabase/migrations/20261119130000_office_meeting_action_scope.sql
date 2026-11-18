create or replace function private.meeting_office_action_access(p_meeting uuid, p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.meetings m
    join public.meeting_requests r on r.id = m.request_id and r.status = 'approved'
    join public.meeting_request_offices i on i.request_id = r.id and i.organization_id = p_organization and i.status = 'accepted'
    join public.organization_memberships membership on membership.organization_id = i.organization_id
    join public.organizations o on o.id = membership.organization_id and o.active
    join public.profiles p on p.id = membership.user_id
    where m.id = p_meeting
      and p.id = (select auth.uid())
      and p.role = 'office'
      and p.account_status = 'active'
  )
$function$;

revoke all on function private.meeting_office_action_access(uuid, uuid) from public, anon;
grant execute on function private.meeting_office_action_access(uuid, uuid) to authenticated;

create or replace function private.meeting_schedule_access(p_request uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.meeting_requests r
    join public.profiles p on p.id = (select auth.uid())
    where r.id = p_request
      and p.role = 'barangay'
      and p.account_status = 'active'
      and p.barangay_id = r.barangay_id
  )
$function$;

revoke all on function private.meeting_schedule_access(uuid) from public, anon;
grant execute on function private.meeting_schedule_access(uuid) to authenticated;

create or replace function private.protect_office_meeting_action_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'office'
  ) and (
    new.meeting_id is distinct from old.meeting_id
    or new.organization_id is distinct from old.organization_id
  ) then
    raise exception 'Office accounts cannot reassign meeting action items';
  end if;
  return new;
end
$function$;

revoke all on function private.protect_office_meeting_action_assignment() from public, anon, authenticated;
drop trigger if exists protect_office_meeting_action_assignment on public.meeting_action_items;
create trigger protect_office_meeting_action_assignment
before update on public.meeting_action_items
for each row execute function private.protect_office_meeting_action_assignment();

drop policy meetings_staff on public.meetings;
create policy meetings_staff on public.meetings
  for all to authenticated
  using (private.meeting_schedule_access(request_id))
  with check (
    private.meeting_schedule_access(request_id)
    and exists (
      select 1 from public.meeting_requests r
      where r.id = request_id and r.status = 'approved'
    )
  );

drop policy actions_staff on public.meeting_action_items;
create policy actions_staff on public.meeting_action_items
  for all to authenticated
  using (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id
        and private.meeting_request_decision_access(m.request_id)
    )
  )
  with check (
    exists (
      select 1 from public.meetings m
      join public.meeting_requests r on r.id = m.request_id and r.status = 'approved'
      where m.id = meeting_id
        and private.meeting_request_decision_access(m.request_id)
    )
  );

create policy actions_office_update on public.meeting_action_items
  for update to authenticated
  using (private.meeting_office_action_access(meeting_id, organization_id))
  with check (private.meeting_office_action_access(meeting_id, organization_id));
