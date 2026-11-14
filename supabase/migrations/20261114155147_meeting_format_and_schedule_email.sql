alter table public.meetings
  add column if not exists venue_type text not null default 'venue';

update public.meetings
   set venue_type = 'online'
 where meet_url is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'meetings_venue_type_values'
       and conrelid = 'public.meetings'::regclass
  ) then
    alter table public.meetings
      add constraint meetings_venue_type_values
      check (venue_type in ('venue', 'online'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'meetings_venue_type_link_consistency'
       and conrelid = 'public.meetings'::regclass
  ) then
    alter table public.meetings
      add constraint meetings_venue_type_link_consistency
      check (
        (venue_type = 'venue' and meet_url is null)
        or (venue_type = 'online' and meet_url is not null)
      );
  end if;
end;
$$;

comment on column public.meetings.venue_type is
  'Whether the approved meeting is held at a physical venue or online through Google Meet.';

create or replace function private.community_notifications()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_schedule_changed boolean := false;
  v_resident uuid;
  v_barangay uuid;
  v_sample boolean;
  v_request_status text;
begin
  if tg_table_name = 'consultation_comments' and new.official then
    insert into public.notifications(user_id, title, consultation_id)
    select p.id, 'An official response was posted to a consultation', new.consultation_id
      from public.profiles p
      join public.consultation_followers f on f.user_id = p.id
     where f.consultation_id = new.consultation_id
       and p.notifications_enabled and p.id <> new.author_id;
  elsif tg_table_name = 'meeting_requests' and new.status is distinct from old.status then
    insert into public.notifications(user_id, title, meeting_request_id)
    select p.id, 'A community meeting request has an update', new.id
      from public.profiles p
     where p.notifications_enabled
       and (p.id = new.resident_id or exists (
         select 1 from public.meeting_supporters s
          where s.request_id = new.id and s.user_id = p.id
       ));
  elsif tg_table_name = 'meetings' then
    if tg_op = 'INSERT' then
      v_schedule_changed := true;
    else
      v_schedule_changed := row(old.starts_at, old.venue, old.venue_type, old.meet_url)
        is distinct from row(new.starts_at, new.venue, new.venue_type, new.meet_url);
    end if;

    select r.resident_id, r.barangay_id, r.is_sample, r.status
      into v_resident, v_barangay, v_sample, v_request_status
      from public.meeting_requests r
     where r.id = new.request_id;

    if coalesce(v_sample, true) then
      return new;
    end if;

    if v_schedule_changed and v_request_status = 'approved' then
      insert into public.notifications(user_id, title, meeting_request_id)
      select p.id, 'Community meeting details have been updated', new.request_id
        from public.profiles p
       where p.id = v_resident and p.role = 'resident'
         and p.account_status = 'active' and p.notifications_enabled;

      insert into public.email_outbox(dedupe_key, recipient_id, event_key, meeting_request_id, notification_title)
      select 'meeting-schedule:' || new.id::text || ':' || gen_random_uuid()::text,
        p.id, 'meeting_update', new.request_id, 'Your meeting schedule has been confirmed'
        from public.profiles p
       where p.id = v_resident and p.role = 'resident'
         and p.account_status = 'active' and not p.notifications_enabled;

      insert into public.notifications(user_id, title, meeting_request_id)
      select p.id, 'Community meeting details have been updated', new.request_id
        from public.profiles p
       where p.role = 'barangay' and p.barangay_id = v_barangay
         and p.account_status = 'active' and p.notifications_enabled;
    elsif not v_schedule_changed then
      insert into public.notifications(user_id, title, meeting_request_id)
      select p.id, 'Community meeting details have been updated', new.request_id
        from public.profiles p
       where p.notifications_enabled and p.account_status = 'active'
         and (p.id = v_resident or p.barangay_id = v_barangay);
    end if;
  elsif tg_table_name = 'announcements' and new.status = 'published'
    and new.publish_at <= now()
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.notifications(user_id, title, announcement_id)
    select p.id, 'A new official announcement is available', new.id
      from public.profiles p
     where p.notifications_enabled and (new.barangay_id is null or p.barangay_id = new.barangay_id);
  end if;
  return new;
end;
$$;

create or replace function private.queue_email_from_notification()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_event text;
  v_required_meeting_schedule boolean;
begin
  v_required_meeting_schedule := new.meeting_request_id is not null
    and new.title = 'Your meeting schedule has been confirmed';
  if not exists (
    select 1 from public.profiles p
     where p.id = new.user_id and p.account_status = 'active'
  ) then
    return new;
  end if;
  if not v_required_meeting_schedule and not exists (
    select 1 from public.profiles p
     where p.id = new.user_id and p.notifications_enabled
  ) then
    return new;
  end if;

  if new.report_id is not null then
    if exists (select 1 from public.reports r where r.id = new.report_id and r.is_demo) then return new; end if;
    v_event := case
      when new.title ilike '%forwarded%' or new.title ilike '%assigned%' or new.title ilike '%new report%' then 'report_triage'
      else 'report_update' end;
  elsif new.meeting_request_id is not null then
    if exists (select 1 from public.meeting_requests m where m.id = new.meeting_request_id and m.is_sample) then return new; end if;
    v_event := case
      when new.title ilike '%all invited offices declined%' then 'meeting_declined'
      when new.title ilike '%you are invited to a community meeting%' then 'meeting_invitation'
      when new.title ilike '%resident requested a meeting%' then 'meeting_request'
      else 'meeting_update' end;
  elsif new.announcement_id is not null then
    if not exists (select 1 from public.announcements a where a.id = new.announcement_id and a.status = 'published' and not a.is_sample) then return new; end if;
    v_event := 'announcement';
  elsif new.consultation_id is not null then
    if exists (select 1 from public.consultations c where c.id = new.consultation_id and c.is_sample) then return new; end if;
    v_event := 'consultation';
  else
    return new;
  end if;

  insert into public.email_outbox(dedupe_key, notification_id, recipient_id, event_key, report_id,
    meeting_request_id, announcement_id, consultation_id, notification_title)
  values ('notification:' || new.id::text, new.id, new.user_id, v_event, new.report_id,
    new.meeting_request_id, new.announcement_id, new.consultation_id, new.title)
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

revoke all on function private.community_notifications() from public, anon, authenticated;
revoke all on function private.queue_email_from_notification() from public, anon, authenticated;
