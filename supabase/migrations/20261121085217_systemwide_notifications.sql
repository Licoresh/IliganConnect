-- Give report submitters an in-app receipt as well as the existing receipt email.
create or replace function private.queue_report_submission_email()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  if new.is_demo then return new; end if;

  if new.resident_id is not null and new.submission_source = 'resident' then
    insert into public.email_outbox(dedupe_key, recipient_id, event_key, report_id)
    values ('report-received:' || new.id::text, new.resident_id, 'report_received', new.id)
    on conflict (dedupe_key) do nothing;

    insert into public.notifications(user_id, title, report_id)
    select p.id, 'Your report was received', new.id
      from public.profiles p
     where p.id = new.resident_id and p.role = 'resident'
       and p.account_status = 'active' and p.notifications_enabled;
  end if;

  insert into public.notifications(user_id, title, report_id)
  select p.id, 'A new report was submitted in your barangay', new.id
    from public.profiles p
   where p.role = 'barangay' and p.barangay_id = new.barangay_id
     and p.account_status = 'active' and p.notifications_enabled
     and p.id is distinct from new.created_by;
  return new;
end
$function$;

-- The report_received outbox event already sends the receipt email. Avoid queuing
-- a second report_update email from the notification trigger.
create or replace function private.queue_email_from_notification()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
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
    if new.title = 'Your report was received' then return new; end if;
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
end
$function$;

create or replace function private.notify_consultation_lifecycle()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_opened boolean;
begin
  if new.is_sample then return new; end if;

  if tg_op = 'INSERT' then
    v_opened := new.status = 'open';
  else
    v_opened := new.status = 'open' and old.status is distinct from new.status;
  end if;

  if v_opened then
    if new.closes_at > now() then
      insert into public.notifications(user_id, title, consultation_id)
      select p.id,
        case when new.opens_at > now()
          then 'A community consultation is scheduled'
          else 'A new community consultation is open' end,
        new.id
        from public.profiles p
       where p.role = 'resident' and p.account_status = 'active'
         and p.notifications_enabled and p.barangay_id = new.barangay_id
         and p.id is distinct from new.created_by;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'open'
    and new.status in ('closed', 'archived') then
    insert into public.notifications(user_id, title, consultation_id)
    select p.id, 'A consultation you follow has closed', new.id
      from public.consultation_followers f
      join public.profiles p on p.id = f.user_id
     where f.consultation_id = new.id and p.account_status = 'active'
       and p.notifications_enabled and p.id is distinct from auth.uid();
  elsif tg_op = 'UPDATE' and new.status = 'open'
    and row(new.title, new.body, new.opens_at, new.closes_at)
      is distinct from row(old.title, old.body, old.opens_at, old.closes_at) then
    insert into public.notifications(user_id, title, consultation_id)
    select p.id, 'A consultation you follow has been updated', new.id
      from public.consultation_followers f
      join public.profiles p on p.id = f.user_id
     where f.consultation_id = new.id and p.account_status = 'active'
       and p.notifications_enabled and p.id is distinct from auth.uid();
  end if;
  return new;
end
$function$;

revoke all on function private.notify_consultation_lifecycle() from public, anon, authenticated;
drop trigger if exists consultation_lifecycle_notification on public.consultations;
create trigger consultation_lifecycle_notification
  after insert or update on public.consultations
  for each row execute function private.notify_consultation_lifecycle();
