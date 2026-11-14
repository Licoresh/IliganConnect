alter table public.meeting_requests
  add column coordination_status text not null default 'open'
    check (coordination_status in ('open', 'unavailable'));

create table public.meeting_request_offices (
  request_id uuid not null references public.meeting_requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  decline_reason text
    check (private.valid_input_text(decline_reason, 0, 500)),
  invited_by uuid not null default auth.uid() references public.profiles(id),
  responded_by uuid references public.profiles(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (request_id, organization_id),
  constraint meeting_request_offices_response_consistent check (
    (status = 'pending' and responded_by is null and responded_at is null and decline_reason is null)
    or (status = 'accepted' and responded_by is not null and responded_at is not null and decline_reason is null)
    or (status = 'declined' and responded_by is not null and responded_at is not null)
  )
);

create index meeting_request_offices_org_status_idx
  on public.meeting_request_offices (organization_id, status, request_id);
create index meeting_request_offices_request_status_idx
  on public.meeting_request_offices (request_id, status);

alter table public.meeting_request_offices enable row level security;
revoke all on public.meeting_request_offices from anon, authenticated;
grant select on public.meeting_request_offices to authenticated;

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
      or (p.role = 'office' and exists (
        select 1 from public.organization_memberships m
        join public.organizations o on o.id = m.organization_id and o.active
        where m.user_id = p.id and m.organization_id = p_organization
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
  join public.organization_memberships m on m.organization_id = i.organization_id
  join public.organizations o on o.id = m.organization_id and o.active
  join public.profiles p on p.id = m.user_id and p.role = 'office' and p.account_status = 'active'
  where i.request_id = p_request and p.id = (select auth.uid())
)
$function$;

create or replace function private.meeting_request_decision_access(p_request uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $function$
select exists (
  select 1
  from public.meeting_requests r
  join public.profiles p on p.id = (select auth.uid()) and p.account_status = 'active'
  where r.id = p_request
    and (p.role = 'admin' or (p.role = 'barangay' and p.barangay_id = r.barangay_id))
)
$function$;

revoke all on function private.meeting_request_office_read_access(uuid, uuid) from public, anon;
revoke all on function private.meeting_invited_office_access(uuid) from public, anon;
revoke all on function private.meeting_request_decision_access(uuid) from public, anon;
grant execute on function private.meeting_request_office_read_access(uuid, uuid) to authenticated;
grant execute on function private.meeting_invited_office_access(uuid) to authenticated;
grant execute on function private.meeting_request_decision_access(uuid) to authenticated;

create policy meeting_request_offices_read on public.meeting_request_offices
  for select to authenticated
  using (private.meeting_request_office_read_access(request_id, organization_id));

drop policy requests_read on public.meeting_requests;
create policy requests_read on public.meeting_requests for select to authenticated
  using (
    private.meeting_access(id)
    or (private.active_resident() and (
      resident_id = (select auth.uid())
      or barangay_id = (select p.barangay_id from public.profiles p where p.id = (select auth.uid()))
    ))
    or private.meeting_invited_office_access(id)
  );

drop policy requests_staff on public.meeting_requests;
create policy requests_staff on public.meeting_requests for update to authenticated
  using (private.meeting_request_decision_access(id))
  with check (private.meeting_request_decision_access(id));

revoke insert on public.meeting_requests from anon, authenticated;
revoke insert, update, delete on public.meeting_participants from authenticated;

create or replace function private.enforce_meeting_report_barangay()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_barangay uuid;
begin
  if new.report_id is null then return new; end if;
  select r.barangay_id into v_barangay
  from public.reports r where r.id = new.report_id;
  if not found or v_barangay is null then
    raise exception 'The linked report has no valid barangay. Remove the report link or contact support.' using errcode = '23514';
  end if;
  new.barangay_id := v_barangay;
  return new;
end
$function$;
revoke all on function private.enforce_meeting_report_barangay() from public, anon, authenticated;
create trigger meeting_report_barangay_route
  before insert or update of report_id, barangay_id on public.meeting_requests
  for each row execute function private.enforce_meeting_report_barangay();

update public.meeting_requests r
set barangay_id = linked.barangay_id
from public.reports linked
where r.report_id = linked.id and r.barangay_id is distinct from linked.barangay_id;

create or replace function private.refresh_meeting_coordination_status()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_request uuid;
  v_before text;
  v_after text;
begin
  v_request := case when tg_op = 'DELETE' then old.request_id else new.request_id end;
  select coordination_status into v_before from public.meeting_requests where id = v_request;
  if not found then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  update public.meeting_requests r
  set coordination_status = case
    when exists (select 1 from public.meeting_request_offices i where i.request_id = v_request)
      and not exists (select 1 from public.meeting_request_offices i where i.request_id = v_request and i.status <> 'declined')
      then 'unavailable'
    else 'open'
  end
  where r.id = v_request
  returning coordination_status into v_after;

  if v_before is distinct from v_after and v_after = 'unavailable' then
    insert into public.notifications(user_id, title, meeting_request_id)
    select p.id, 'All invited offices declined the meeting', v_request
    from public.profiles p
    join public.meeting_requests r on r.id = v_request
    where p.notifications_enabled and p.account_status = 'active'
      and (p.id = r.resident_id or (p.role = 'barangay' and p.barangay_id = r.barangay_id));
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end
$function$;
revoke all on function private.refresh_meeting_coordination_status() from public, anon, authenticated;
create trigger meeting_request_office_refresh_status
  after insert or update or delete on public.meeting_request_offices
  for each row execute function private.refresh_meeting_coordination_status();

create or replace function private.meeting_request_created_notification()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
begin
  if not new.is_sample then
    insert into public.notifications(user_id, title, meeting_request_id)
    select p.id, 'A resident requested a meeting in your barangay', new.id
    from public.profiles p
    where p.role = 'barangay' and p.barangay_id = new.barangay_id
      and p.account_status = 'active' and p.notifications_enabled;
  end if;
  return new;
end
$function$;
revoke all on function private.meeting_request_created_notification() from public, anon, authenticated;
create trigger meeting_request_created_notification
  after insert on public.meeting_requests
  for each row execute function private.meeting_request_created_notification();

create or replace function private.meeting_request_office_notification()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_sample boolean;
begin
  select is_sample into v_sample from public.meeting_requests where id = new.request_id;
  if v_sample then return new; end if;

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
revoke all on function private.meeting_request_office_notification() from public, anon, authenticated;
create trigger meeting_request_office_notification
  after insert or update on public.meeting_request_offices
  for each row execute function private.meeting_request_office_notification();

create or replace function private.submit_meeting_request(
  p_title text,
  p_body text,
  p_barangay uuid,
  p_category uuid,
  p_report uuid,
  p_organizations uuid[]
)
returns uuid
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_barangay uuid := p_barangay;
  v_category uuid := p_category;
  v_report_barangay uuid;
  v_report_category uuid;
  v_organizations uuid[] := coalesce(p_organizations, '{}'::uuid[]);
  v_request uuid;
  v_valid bigint;
begin
  if not private.active_resident() then
    raise exception 'An active resident account is required to request a meeting.' using errcode = '42501';
  end if;
  if not private.valid_input_text(p_title, 8, 160) then
    raise exception 'Meeting topic must be 8–160 meaningful characters.' using errcode = '23514';
  end if;
  if not private.valid_input_text(p_body, 20, 4000) then
    raise exception 'Meeting purpose must be 20–4,000 meaningful characters.' using errcode = '23514';
  end if;
  if cardinality(v_organizations) > 10 then
    raise exception 'Invite no more than 10 offices to a meeting.' using errcode = '23514';
  end if;
  if cardinality(v_organizations) <> (select count(distinct o) from unnest(v_organizations) as u(o)) then
    raise exception 'Each office can only be invited once.' using errcode = '23514';
  end if;
  select count(*) into v_valid from public.organizations o
  where o.id = any(v_organizations) and o.active and (o.can_consult or o.can_coordinate);
  if v_valid <> cardinality(v_organizations) then
    raise exception 'Choose only active offices that can participate in community meetings.' using errcode = '23514';
  end if;
  if p_report is not null then
    select r.barangay_id, r.category_id into v_report_barangay, v_report_category
    from public.reports r
    where r.id = p_report and r.resident_id = v_user
      and (not r.is_demo or private.sample_data_enabled());
    if not found then
      raise exception 'Choose a report that belongs to your account.' using errcode = '42501';
    end if;
    v_barangay := v_report_barangay;
    v_category := coalesce(v_category, v_report_category);
  end if;
  if v_barangay is null or not exists (select 1 from public.barangays b where b.id = v_barangay) then
    raise exception 'Choose a barangay for this meeting request.' using errcode = '23514';
  end if;

  insert into public.meeting_requests(resident_id, barangay_id, title, body, category_id, report_id)
  values (v_user, v_barangay, btrim(p_title), btrim(p_body), v_category, p_report)
  returning id into v_request;

  insert into public.meeting_request_offices(request_id, organization_id, invited_by)
  select v_request, chosen, v_user from unnest(v_organizations) as u(chosen);
  return v_request;
end
$function$;

create or replace function private.invite_meeting_office(p_request uuid, p_organization uuid)
returns void
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_status text;
begin
  if not exists (
    select 1 from public.profiles p join public.meeting_requests r on r.id = p_request
    where p.id = auth.uid() and p.account_status = 'active'
      and (p.role = 'admin' or (p.role = 'barangay' and p.barangay_id = r.barangay_id))
  ) then
    raise exception 'Only the assigned barangay or an administrator can invite offices.' using errcode = '42501';
  end if;
  if not private.sample_request_visible(p_request) then
    raise exception 'This meeting is outside your available records.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_organization and o.active and (o.can_consult or o.can_coordinate)) then
    raise exception 'Choose an active office that can participate in community meetings.' using errcode = '23514';
  end if;
  select status into v_status from public.meeting_requests where id = p_request for update;
  if not found or v_status not in ('pending', 'approved') then
    raise exception 'This meeting request is closed to new invitations.' using errcode = '23514';
  end if;

  insert into public.meeting_request_offices as existing(request_id, organization_id, invited_by)
  values (p_request, p_organization, auth.uid())
  on conflict (request_id, organization_id) do update
    set status = 'pending', decline_reason = null, invited_by = auth.uid(),
        responded_by = null, responded_at = null, created_at = now()
    where existing.status = 'declined'
  returning status into v_status;
  if not found then
    raise exception 'That office already has an active invitation.' using errcode = '23505';
  end if;
end
$function$;

create or replace function private.remove_meeting_office_invitation(p_request uuid, p_organization uuid)
returns void
language plpgsql security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from public.profiles p join public.meeting_requests r on r.id = p_request
    where p.id = auth.uid() and p.account_status = 'active'
      and (p.role = 'admin' or (p.role = 'barangay' and p.barangay_id = r.barangay_id))
  ) then
    raise exception 'Only the assigned barangay or an administrator can manage office invitations.' using errcode = '42501';
  end if;
  delete from public.meeting_request_offices
  where request_id = p_request and organization_id = p_organization and status = 'pending';
  if not found then
    raise exception 'Only a pending office invitation can be removed.' using errcode = '23514';
  end if;
end
$function$;

create or replace function private.respond_meeting_office_invitation(
  p_request uuid,
  p_organization uuid,
  p_accept boolean,
  p_reason text
)
returns void
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_status text;
  v_request_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_profile from public.profiles p where p.id = auth.uid() and p.account_status = 'active';
  if not found or v_profile.role <> 'office' then
    raise exception 'An active office account is required to respond to this invitation.' using errcode = '42501';
  end if;
  if p_accept is null then
    raise exception 'Choose whether the office can participate.' using errcode = '23514';
  end if;
  if v_reason is not null and not private.valid_input_text(v_reason, 0, 500) then
    raise exception 'A decline reason must be no longer than 500 meaningful characters.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id and o.active
    where m.user_id = v_profile.id and m.organization_id = p_organization
  ) then
    raise exception 'Your account is not a member of the invited office.' using errcode = '42501';
  end if;
  select i.status, r.status into v_status, v_request_status
  from public.meeting_request_offices i
  join public.meeting_requests r on r.id = i.request_id
  where i.request_id = p_request and i.organization_id = p_organization
  for update of i;
  if not found then raise exception 'This office invitation no longer exists.' using errcode = 'P0002'; end if;
  if not private.sample_request_visible(p_request) then
    raise exception 'This meeting is outside your available records.' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'This office has already responded to the invitation.' using errcode = '23514';
  end if;
  if v_request_status not in ('pending', 'approved') then
    raise exception 'This meeting request is closed.' using errcode = '23514';
  end if;

  update public.meeting_request_offices
  set status = case when p_accept then 'accepted' else 'declined' end,
      decline_reason = case when p_accept then null else v_reason end,
      responded_by = v_profile.id,
      responded_at = now()
  where request_id = p_request and organization_id = p_organization;
end
$function$;

create or replace function public.submit_meeting_request(
  p_title text,
  p_body text,
  p_barangay uuid,
  p_category uuid default null,
  p_report uuid default null,
  p_organizations uuid[] default '{}'::uuid[]
)
returns uuid language sql security invoker set search_path = ''
as $function$ select private.submit_meeting_request(p_title, p_body, p_barangay, p_category, p_report, p_organizations) $function$;

create or replace function public.invite_meeting_office(p_request uuid, p_organization uuid)
returns void language sql security invoker set search_path = ''
as $function$ select private.invite_meeting_office(p_request, p_organization) $function$;

create or replace function public.remove_meeting_office_invitation(p_request uuid, p_organization uuid)
returns void language sql security invoker set search_path = ''
as $function$ select private.remove_meeting_office_invitation(p_request, p_organization) $function$;

create or replace function public.respond_meeting_office_invitation(
  p_request uuid, p_organization uuid, p_accept boolean, p_reason text default null
)
returns void language sql security invoker set search_path = ''
as $function$ select private.respond_meeting_office_invitation(p_request, p_organization, p_accept, p_reason) $function$;

revoke all on function private.submit_meeting_request(text, text, uuid, uuid, uuid, uuid[]) from public, anon;
revoke all on function private.invite_meeting_office(uuid, uuid) from public, anon;
revoke all on function private.remove_meeting_office_invitation(uuid, uuid) from public, anon;
revoke all on function private.respond_meeting_office_invitation(uuid, uuid, boolean, text) from public, anon;
grant execute on function private.submit_meeting_request(text, text, uuid, uuid, uuid, uuid[]) to authenticated;
grant execute on function private.invite_meeting_office(uuid, uuid) to authenticated;
grant execute on function private.remove_meeting_office_invitation(uuid, uuid) to authenticated;
grant execute on function private.respond_meeting_office_invitation(uuid, uuid, boolean, text) to authenticated;

revoke all on function public.submit_meeting_request(text, text, uuid, uuid, uuid, uuid[]) from public, anon;
revoke all on function public.invite_meeting_office(uuid, uuid) from public, anon;
revoke all on function public.remove_meeting_office_invitation(uuid, uuid) from public, anon;
revoke all on function public.respond_meeting_office_invitation(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.submit_meeting_request(text, text, uuid, uuid, uuid, uuid[]) to authenticated;
grant execute on function public.invite_meeting_office(uuid, uuid) to authenticated;
grant execute on function public.remove_meeting_office_invitation(uuid, uuid) to authenticated;
grant execute on function public.respond_meeting_office_invitation(uuid, uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
