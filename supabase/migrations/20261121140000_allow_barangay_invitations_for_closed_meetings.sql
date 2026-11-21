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
begin
  select * into v_profile from public.profiles p
  where p.id = (select auth.uid()) and p.account_status = 'active';
  if not found or p_accept is null or not (
    v_profile.role = 'admin'
    or (v_profile.role = 'barangay' and v_profile.barangay_id = p_barangay)
  ) then
    raise exception 'Only the invited barangay or an administrator can respond.' using errcode = '42501';
  end if;
  select i.status, r.status
    into v_status, v_request_status
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
  if v_request_status not in ('pending', 'approved') then
    raise exception 'This meeting request is closed to barangay invitations.' using errcode = '23514';
  end if;

  update public.meeting_request_barangays
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_by = v_profile.id,
      responded_at = now()
  where request_id = p_request and barangay_id = p_barangay;
end
$function$;

create or replace function private.notify_meeting_barangay_invitation()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_resident uuid;
  v_participation_mode text;
begin
  select r.resident_id, r.participation_mode into v_resident, v_participation_mode
  from public.meeting_requests r where r.id = new.request_id;
  if exists (select 1 from public.meeting_requests r where r.id = new.request_id and r.is_sample) then return new; end if;
  if tg_op = 'INSERT' then
    insert into public.notifications(user_id, title, meeting_request_id)
    select p.id, case when v_participation_mode = 'open'
      then 'Your barangay was invited to join an open community meeting'
      else 'Your barangay was invited to a community meeting' end, new.request_id
    from public.profiles p where p.role = 'barangay' and p.barangay_id = new.barangay_id
      and p.account_status = 'active' and p.notifications_enabled;
  elsif new.status is distinct from old.status and new.status = 'pending' then
    insert into public.notifications(user_id, title, meeting_request_id)
    select p.id, case when v_participation_mode = 'open'
      then 'Your barangay was invited to join an open community meeting'
      else 'Your barangay was invited to a community meeting' end, new.request_id
    from public.profiles p where p.role = 'barangay' and p.barangay_id = new.barangay_id
      and p.account_status = 'active' and p.notifications_enabled;
  elsif new.status is distinct from old.status then
    insert into public.notifications(user_id, title, meeting_request_id)
    select p.id, case
      when new.status = 'accepted' and v_participation_mode = 'open'
        then 'A barangay accepted the invitation to your open meeting'
      when new.status = 'declined' and v_participation_mode = 'open'
        then 'A barangay declined the invitation to your open meeting'
      when new.status = 'accepted' then 'A barangay accepted the invitation to your meeting'
      else 'A barangay declined the invitation to your meeting' end, new.request_id
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
