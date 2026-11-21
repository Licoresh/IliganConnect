alter table public.meeting_requests
  add column participation_mode text not null default 'closed'
    check (participation_mode in ('open', 'closed'));

grant select (resident_id, participation_mode)
  on public.meeting_requests to authenticated;

create table public.meeting_request_barangays (
  request_id uuid not null references public.meeting_requests(id) on delete cascade,
  barangay_id uuid not null references public.barangays(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  invited_by uuid not null default auth.uid() references public.profiles(id),
  responded_by uuid references public.profiles(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (request_id, barangay_id),
  constraint meeting_request_barangays_response_consistent check (
    (status = 'pending' and responded_by is null and responded_at is null)
    or (status in ('accepted', 'declined') and responded_by is not null and responded_at is not null)
  )
);

create index meeting_request_barangays_barangay_status_idx
  on public.meeting_request_barangays (barangay_id, status, request_id);

alter table public.meeting_request_barangays enable row level security;
revoke all on public.meeting_request_barangays from public, anon, authenticated;
grant select (request_id, barangay_id, status, created_at)
  on public.meeting_request_barangays to authenticated;

create table public.meeting_resident_participants (
  request_id uuid not null references public.meeting_requests(id) on delete cascade,
  resident_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (request_id, resident_id)
);

create index meeting_resident_participants_resident_idx
  on public.meeting_resident_participants (resident_id, request_id);

alter table public.meeting_resident_participants enable row level security;
revoke all on public.meeting_resident_participants from public, anon, authenticated;
grant select (request_id, resident_id, joined_at)
  on public.meeting_resident_participants to authenticated;

create or replace function private.meeting_request_barangay_invitation_read_access(
  p_request uuid,
  p_barangay uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
    from public.meeting_request_barangays i
    join public.meeting_requests r on r.id = i.request_id
    join public.profiles p on p.id = (select auth.uid()) and p.account_status = 'active'
    where i.request_id = p_request
      and i.barangay_id = p_barangay
      and private.sample_request_visible(r.id)
      and (
        p.role = 'admin'
        or (p.role = 'barangay' and p.barangay_id in (r.barangay_id, i.barangay_id))
        or (p.role = 'resident' and (p.id = r.resident_id or p.barangay_id = r.barangay_id))
        or (p.role = 'resident' and p.barangay_id = i.barangay_id and (
          (i.status = 'accepted' and r.status = 'approved' and r.participation_mode = 'open')
          or exists (select 1 from public.meeting_resident_participants participant
            where participant.request_id = r.id and participant.resident_id = p.id)
        ))
      )
  )
$function$;

create or replace function private.meeting_request_invited_barangay_access(p_request uuid)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
    from public.meeting_request_barangays i
    join public.meeting_requests r on r.id = i.request_id
    join public.profiles p on p.id = (select auth.uid()) and p.account_status = 'active'
    where i.request_id = p_request
      and p.barangay_id = i.barangay_id
      and private.sample_request_visible(r.id)
      and (
        p.role = 'barangay'
        or (p.role = 'resident' and (
          (p.barangay_id = i.barangay_id and i.status = 'accepted'
            and r.status = 'approved' and r.participation_mode = 'open')
          or exists (select 1 from public.meeting_resident_participants participant
            where participant.request_id = r.id and participant.resident_id = p.id)
        ))
      )
  )
$function$;

create policy meeting_request_barangays_read
  on public.meeting_request_barangays for select to authenticated
  using (private.meeting_request_barangay_invitation_read_access(request_id, barangay_id));

create policy meeting_requests_invited_barangay_read
  on public.meeting_requests for select to authenticated
  using (private.meeting_request_invited_barangay_access(id));

create or replace function private.meeting_request_resident_can_join(p_request uuid)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
    from public.meeting_requests r
    join public.profiles p on p.id = (select auth.uid())
      and p.role = 'resident' and p.account_status = 'active'
    where r.id = p_request
      and r.status = 'approved'
      and r.participation_mode = 'open'
      and private.sample_request_visible(r.id)
      and not exists (
        select 1 from public.meetings m where m.request_id = r.id and m.completed
      )
      and (
        p.id = r.resident_id
        or p.barangay_id = r.barangay_id
        or exists (
          select 1 from public.meeting_request_barangays i
          where i.request_id = r.id and i.barangay_id = p.barangay_id and i.status = 'accepted'
        )
      )
  )
$function$;

create or replace function private.meeting_request_resident_can_view(p_request uuid)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
    from public.meeting_requests r
    join public.profiles p on p.id = (select auth.uid())
      and p.role = 'resident' and p.account_status = 'active'
    where r.id = p_request
      and private.sample_request_visible(r.id)
      and (
        p.id = r.resident_id
        or p.barangay_id = r.barangay_id
        or private.meeting_request_resident_can_join(r.id)
        or exists (
          select 1 from public.meeting_resident_participants participant
          where participant.request_id = r.id and participant.resident_id = p.id
        )
      )
  )
$function$;

create policy meeting_resident_participants_read
  on public.meeting_resident_participants for select to authenticated
  using (private.meeting_request_resident_can_view(request_id));

create or replace function private.invite_meeting_barangay(p_request uuid, p_barangay uuid)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_request public.meeting_requests%rowtype;
  v_profile public.profiles%rowtype;
  v_status text;
begin
  select * into v_profile from public.profiles p
  where p.id = (select auth.uid()) and p.account_status = 'active';
  select * into v_request from public.meeting_requests r where r.id = p_request for update;
  if v_request.id is null or not private.sample_request_visible(p_request) then
    raise exception 'This meeting request is unavailable.' using errcode = '42501';
  end if;
  if v_profile.id is null or not (
    v_profile.role = 'admin'
    or (v_profile.role = 'barangay' and v_profile.barangay_id = v_request.barangay_id)
  ) then
    raise exception 'Only the meeting barangay or an administrator can invite another barangay.' using errcode = '42501';
  end if;
  if v_request.participation_mode <> 'open' then
    raise exception 'Only open meetings can invite another barangay to participate.' using errcode = '23514';
  end if;
  if v_request.status not in ('pending', 'approved') then
    raise exception 'This meeting request is closed to new invitations.' using errcode = '23514';
  end if;
  if p_barangay is null or p_barangay = v_request.barangay_id
    or not exists (select 1 from public.barangays b where b.id = p_barangay) then
    raise exception 'Choose a different valid barangay to invite.' using errcode = '23514';
  end if;

  insert into public.meeting_request_barangays as existing(request_id, barangay_id, invited_by)
  values (p_request, p_barangay, v_profile.id)
  on conflict (request_id, barangay_id) do update
    set status = 'pending', invited_by = v_profile.id, responded_by = null,
        responded_at = null, created_at = now()
    where existing.status = 'declined'
  returning status into v_status;
  if not found then
    raise exception 'That barangay already has an active invitation.' using errcode = '23505';
  end if;
end
$function$;

create or replace function private.respond_meeting_barangay_invitation(
  p_request uuid,
  p_barangay uuid,
  p_accept boolean
)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_status text;
  v_request_status text;
  v_mode text;
begin
  select * into v_profile from public.profiles p
  where p.id = (select auth.uid()) and p.account_status = 'active';
  if not found or p_accept is null or not (
    v_profile.role = 'admin'
    or (v_profile.role = 'barangay' and v_profile.barangay_id = p_barangay)
  ) then
    raise exception 'Only the invited barangay or an administrator can respond.' using errcode = '42501';
  end if;
  select i.status, r.status, r.participation_mode
    into v_status, v_request_status, v_mode
  from public.meeting_request_barangays i
  join public.meeting_requests r on r.id = i.request_id
  where i.request_id = p_request and i.barangay_id = p_barangay
  for update of i, r;
  if not found then raise exception 'This barangay invitation no longer exists.' using errcode = 'P0002'; end if;
  if not private.sample_request_visible(p_request) then
    raise exception 'This meeting is outside your available records.' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'This barangay has already responded to the invitation.' using errcode = '23514';
  end if;
  if v_mode <> 'open' or v_request_status not in ('pending', 'approved') then
    raise exception 'This meeting request is closed to barangay invitations.' using errcode = '23514';
  end if;

  update public.meeting_request_barangays
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_by = v_profile.id,
      responded_at = now()
  where request_id = p_request and barangay_id = p_barangay;
end
$function$;

create or replace function private.join_meeting_request(p_request uuid)
returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  if not private.meeting_request_resident_can_join(p_request) then
    raise exception 'This open meeting is not available for your account or barangay.' using errcode = '42501';
  end if;
  insert into public.meeting_resident_participants(request_id, resident_id)
  values (p_request, (select auth.uid()))
  on conflict (request_id, resident_id) do nothing;
end
$function$;

create or replace function private.leave_meeting_request(p_request uuid)
returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  if not private.active_resident() then
    raise exception 'An active resident account is required.' using errcode = '42501';
  end if;
  delete from public.meeting_resident_participants
  where request_id = p_request and resident_id = (select auth.uid());
end
$function$;

create or replace function private.meeting_request_participants(p_requests uuid[])
returns table (
  request_id uuid,
  resident_id uuid,
  resident_name text,
  joined_at timestamptz,
  participant_count bigint
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not private.active_resident() then
    raise exception 'An active resident account is required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_requests), 0) > 20 then
    raise exception 'Request no more than 20 meeting participant lists at once.' using errcode = '23514';
  end if;
  return query
    with ranked as (
      select participant.request_id, participant.resident_id, profile.display_name as resident_name,
        participant.joined_at,
        count(*) over (partition by participant.request_id) as participant_count,
        row_number() over (partition by participant.request_id order by participant.joined_at, participant.resident_id) as participant_order
      from public.meeting_resident_participants participant
      join public.profiles profile on profile.id = participant.resident_id
      where participant.request_id = any(coalesce(p_requests, '{}'::uuid[]))
        and private.meeting_request_resident_can_view(participant.request_id)
    )
    select ranked.request_id, ranked.resident_id, ranked.resident_name, ranked.joined_at, ranked.participant_count
    from ranked where ranked.participant_order <= 100
    order by ranked.request_id, ranked.participant_order;
end
$function$;

create or replace function public.meeting_request_participants(p_requests uuid[])
returns table (
  request_id uuid,
  resident_id uuid,
  resident_name text,
  joined_at timestamptz,
  participant_count bigint
)
language sql stable security invoker set search_path = ''
as $function$ select * from private.meeting_request_participants(p_requests) $function$;

create or replace function public.invite_meeting_barangay(p_request uuid, p_barangay uuid)
returns void language sql security invoker set search_path = ''
as $function$ select private.invite_meeting_barangay(p_request, p_barangay) $function$;

create or replace function public.respond_meeting_barangay_invitation(p_request uuid, p_barangay uuid, p_accept boolean)
returns void language sql security invoker set search_path = ''
as $function$ select private.respond_meeting_barangay_invitation(p_request, p_barangay, p_accept) $function$;

create or replace function public.join_meeting_request(p_request uuid)
returns void language sql security invoker set search_path = ''
as $function$ select private.join_meeting_request(p_request) $function$;

create or replace function public.leave_meeting_request(p_request uuid)
returns void language sql security invoker set search_path = ''
as $function$ select private.leave_meeting_request(p_request) $function$;

drop function public.submit_meeting_request(text, text, uuid, uuid, uuid, uuid[]);
drop function private.submit_meeting_request(text, text, uuid, uuid, uuid, uuid[]);

create or replace function private.submit_meeting_request(
  p_title text,
  p_body text,
  p_barangay uuid,
  p_category uuid default null,
  p_report uuid default null,
  p_organizations uuid[] default '{}'::uuid[],
  p_participation_mode text default 'closed'
)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_barangay uuid := p_barangay;
  v_category uuid := p_category;
  v_report_barangay uuid;
  v_report_category uuid;
  v_organizations uuid[] := coalesce(p_organizations, '{}'::uuid[]);
  v_mode text := coalesce(nullif(btrim(p_participation_mode), ''), 'closed');
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
  if v_mode not in ('open', 'closed') then
    raise exception 'Choose whether residents can join this meeting.' using errcode = '23514';
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

  insert into public.meeting_requests(resident_id, barangay_id, title, body, category_id, report_id, participation_mode)
  values (v_user, v_barangay, btrim(p_title), btrim(p_body), v_category, p_report, v_mode)
  returning id into v_request;

  insert into public.meeting_request_offices(request_id, organization_id, invited_by)
  select v_request, chosen, v_user from unnest(v_organizations) as u(chosen);
  return v_request;
end
$function$;

create or replace function public.submit_meeting_request(
  p_title text,
  p_body text,
  p_barangay uuid,
  p_category uuid default null,
  p_report uuid default null,
  p_organizations uuid[] default '{}'::uuid[],
  p_participation_mode text default 'closed'
)
returns uuid language sql security invoker set search_path = ''
as $function$
  select private.submit_meeting_request(p_title, p_body, p_barangay, p_category, p_report, p_organizations, p_participation_mode)
$function$;

revoke all on function private.meeting_request_barangay_invitation_read_access(uuid, uuid) from public, anon;
revoke all on function private.meeting_request_invited_barangay_access(uuid) from public, anon;
revoke all on function private.meeting_request_resident_can_join(uuid) from public, anon;
revoke all on function private.meeting_request_resident_can_view(uuid) from public, anon;
revoke all on function private.invite_meeting_barangay(uuid, uuid) from public, anon;
revoke all on function private.respond_meeting_barangay_invitation(uuid, uuid, boolean) from public, anon;
revoke all on function private.join_meeting_request(uuid) from public, anon;
revoke all on function private.leave_meeting_request(uuid) from public, anon;
revoke all on function private.meeting_request_participants(uuid[]) from public, anon;
revoke all on function public.meeting_request_participants(uuid[]) from public, anon;
revoke all on function public.invite_meeting_barangay(uuid, uuid) from public, anon;
revoke all on function public.respond_meeting_barangay_invitation(uuid, uuid, boolean) from public, anon;
revoke all on function public.join_meeting_request(uuid) from public, anon;
revoke all on function public.leave_meeting_request(uuid) from public, anon;
revoke all on function private.submit_meeting_request(text, text, uuid, uuid, uuid, uuid[], text) from public, anon;
revoke all on function public.submit_meeting_request(text, text, uuid, uuid, uuid, uuid[], text) from public, anon;

grant execute on function private.meeting_request_barangay_invitation_read_access(uuid, uuid) to authenticated;
grant execute on function private.meeting_request_invited_barangay_access(uuid) to authenticated;
grant execute on function private.meeting_request_resident_can_join(uuid) to authenticated;
grant execute on function private.meeting_request_resident_can_view(uuid) to authenticated;
grant execute on function private.invite_meeting_barangay(uuid, uuid) to authenticated;
grant execute on function private.respond_meeting_barangay_invitation(uuid, uuid, boolean) to authenticated;
grant execute on function private.join_meeting_request(uuid) to authenticated;
grant execute on function private.leave_meeting_request(uuid) to authenticated;
grant execute on function private.meeting_request_participants(uuid[]) to authenticated;
grant execute on function public.meeting_request_participants(uuid[]) to authenticated;
grant execute on function public.invite_meeting_barangay(uuid, uuid) to authenticated;
grant execute on function public.respond_meeting_barangay_invitation(uuid, uuid, boolean) to authenticated;
grant execute on function public.join_meeting_request(uuid) to authenticated;
grant execute on function public.leave_meeting_request(uuid) to authenticated;
grant execute on function private.submit_meeting_request(text, text, uuid, uuid, uuid, uuid[], text) to authenticated;
grant execute on function public.submit_meeting_request(text, text, uuid, uuid, uuid, uuid[], text) to authenticated;

create or replace function private.notify_meeting_barangay_invitation()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_resident uuid;
begin
  select r.resident_id into v_resident from public.meeting_requests r where r.id = new.request_id;
  if exists (select 1 from public.meeting_requests r where r.id = new.request_id and r.is_sample) then return new; end if;
  if tg_op = 'INSERT' then
    insert into public.notifications(user_id, title, meeting_request_id)
    select p.id, 'Your barangay was invited to join an open community meeting', new.request_id
    from public.profiles p where p.role = 'barangay' and p.barangay_id = new.barangay_id
      and p.account_status = 'active' and p.notifications_enabled;
  elsif new.status is distinct from old.status and new.status = 'pending' then
    insert into public.notifications(user_id, title, meeting_request_id)
    select p.id, 'Your barangay was invited to join an open community meeting', new.request_id
    from public.profiles p where p.role = 'barangay' and p.barangay_id = new.barangay_id
      and p.account_status = 'active' and p.notifications_enabled;
  elsif new.status is distinct from old.status then
    insert into public.notifications(user_id, title, meeting_request_id)
    select p.id, case when new.status = 'accepted'
      then 'A barangay accepted the invitation to your open meeting'
      else 'A barangay declined the invitation to your open meeting' end, new.request_id
    from public.profiles p
    where p.notifications_enabled and (
      p.id = v_resident
      or exists (select 1 from public.meeting_resident_participants participant
        where participant.request_id = new.request_id and participant.resident_id = p.id)
    );
  end if;
  return new;
end
$function$;

create trigger meeting_request_barangay_invitation_notifications
after insert or update on public.meeting_request_barangays
for each row execute function private.notify_meeting_barangay_invitation();

create or replace function private.notify_meeting_resident_join()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_owner uuid;
begin
  select r.resident_id into v_owner from public.meeting_requests r where r.id = new.request_id;
  if exists (select 1 from public.meeting_requests r where r.id = new.request_id and r.is_sample) then return new; end if;
  insert into public.notifications(user_id, title, meeting_request_id)
  select p.id, 'You joined an open community meeting', new.request_id
  from public.profiles p where p.id = new.resident_id and p.notifications_enabled;
  insert into public.notifications(user_id, title, meeting_request_id)
  select p.id, 'A resident joined an open community meeting', new.request_id
  from public.profiles p
  where p.notifications_enabled and p.id <> new.resident_id
    and (p.id = v_owner or exists (
      select 1 from public.meeting_resident_participants participant
      where participant.request_id = new.request_id and participant.resident_id = p.id
    ) or exists (
      select 1 from public.meeting_requests request
      where request.id = new.request_id and p.role = 'barangay' and p.barangay_id = request.barangay_id
    ));
  return new;
end
$function$;

create trigger meeting_resident_participant_notifications
after insert on public.meeting_resident_participants
for each row execute function private.notify_meeting_resident_join();

create or replace function private.notify_meeting_participants_of_updates()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_title text;
  v_request uuid;
begin
  if tg_table_name = 'meeting_requests' then
    v_request := new.id;
    if new.status is not distinct from old.status
      and new.decision_reason is not distinct from old.decision_reason
      and new.participation_mode is not distinct from old.participation_mode then return new; end if;
    v_title := 'An open community meeting has a new update';
  else
    v_request := new.request_id;
    if tg_op = 'UPDATE' and new.starts_at is not distinct from old.starts_at
      and new.ends_at is not distinct from old.ends_at
      and new.venue is not distinct from old.venue
      and new.venue_type is not distinct from old.venue_type
      and new.meet_url is not distinct from old.meet_url
      and new.completed is not distinct from old.completed then return new; end if;
    v_title := case when new.completed then 'An open community meeting was marked complete'
      else 'An open community meeting schedule or venue was updated' end;
  end if;
  if exists (select 1 from public.meeting_requests r where r.id = v_request and r.is_sample) then return new; end if;
  insert into public.notifications(user_id, title, meeting_request_id)
  select p.id, v_title, v_request
  from public.meeting_resident_participants participant
  join public.profiles p on p.id = participant.resident_id and p.notifications_enabled
  join public.meeting_requests r on r.id = participant.request_id
  where participant.request_id = v_request and p.id <> r.resident_id;
  return new;
end
$function$;

create trigger meeting_request_participant_updates
after update of status, decision_reason, participation_mode on public.meeting_requests
for each row execute function private.notify_meeting_participants_of_updates();

create trigger meeting_schedule_participant_updates
after insert or update of starts_at, ends_at, venue, venue_type, meet_url, completed on public.meetings
for each row execute function private.notify_meeting_participants_of_updates();

revoke execute on all functions in schema private from public, anon;
notify pgrst, 'reload schema';
