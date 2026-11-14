alter table public.meetings
  add column if not exists ends_at timestamptz;

-- Preserve existing schedules as one-hour meetings without sending new update alerts.
alter table public.meetings disable trigger user;
update public.meetings
   set ends_at = starts_at + interval '1 hour'
 where ends_at is null;
alter table public.meetings enable trigger user;

alter table public.meetings
  alter column ends_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'meetings_time_window_valid'
       and conrelid = 'public.meetings'::regclass
  ) then
    alter table public.meetings
      add constraint meetings_time_window_valid
      check (
        ends_at > starts_at
        and ends_at <= starts_at + interval '12 hours'
        and ends_at between timestamptz '0001-01-01 00:00:00+00'
                        and timestamptz '9999-12-31 23:59:59.999999+00'
      );
  end if;
end;
$$;

comment on column public.meetings.ends_at is
  'Scheduled meeting end time. Meetings must last longer than zero and no more than 12 hours.';

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
  if tg_table_name = 'consultation_comments' then
    if not new.official then return new; end if;
    insert into public.notifications(user_id, title, consultation_id)
    select p.id, 'An official response was posted to a consultation', new.consultation_id
      from public.profiles p
      join public.consultation_followers f on f.user_id = p.id
     where f.consultation_id = new.consultation_id
       and p.notifications_enabled and p.id <> new.author_id;
  elsif tg_table_name = 'meeting_requests' then
    if new.status is not distinct from old.status then return new; end if;
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
      v_schedule_changed := row(old.starts_at, old.ends_at, old.venue, old.venue_type, old.meet_url)
        is distinct from row(new.starts_at, new.ends_at, new.venue, new.venue_type, new.meet_url);
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
