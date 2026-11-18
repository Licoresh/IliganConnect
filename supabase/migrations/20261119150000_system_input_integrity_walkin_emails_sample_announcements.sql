create function private.valid_person_name(value text, minimum integer, maximum integer)
returns boolean language sql immutable strict parallel safe set search_path = '' as $$
  with normalized as (
    select regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g') as name
  )
  select private.valid_input_text(name, minimum, maximum)
    and name ~ '^[[:alpha:]]+([.])?([[:space:]][[:alpha:]]+([.])?|[-''’][[:alpha:]]+([.])?)*$'
    and name !~ '[-''’]{2,}|[.]{2,}|[-''’][[:space:]]|[[:space:]][-''’]'
    and name !~ '[^[:alpha:][:space:]''’.-]'
  from normalized
$$;
revoke all on function private.valid_person_name(text, integer, integer) from public, anon;
grant execute on function private.valid_person_name(text, integer, integer) to authenticated;

create function private.valid_email_address(value text)
returns boolean language sql immutable strict parallel safe set search_path = '' as $$
  select length(value) between 6 and 254
    and value = btrim(value)
    and length(split_part(value, '@', 1)) between 1 and 64
    and value !~ '[[:space:][:cntrl:]]'
    and value ~* '^[A-Z0-9!#$%&''*+/=?^_`{|}~-]+(\.[A-Z0-9!#$%&''*+/=?^_`{|}~-]+)*@[A-Z0-9]([A-Z0-9-]{0,61}[A-Z0-9])?(\.[A-Z0-9]([A-Z0-9-]{0,61}[A-Z0-9])?)+$'
    and length(split_part(split_part(value, '@', 2), '.', array_length(string_to_array(split_part(value, '@', 2), '.'), 1))) >= 2
$$;
revoke all on function private.valid_email_address(text) from public, anon;
grant execute on function private.valid_email_address(text) to authenticated;

create or replace function private.sync_profile_name_parts()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
    and row(old.first_name, old.middle_name, old.last_name)
      is not distinct from row(new.first_name, new.middle_name, new.last_name) then
    return new;
  end if;
  if new.first_name is null and new.middle_name is null and new.last_name is null then
    return new;
  end if;

  new.first_name := regexp_replace(btrim(new.first_name), '[[:space:]]+', ' ', 'g');
  new.middle_name := nullif(regexp_replace(btrim(coalesce(new.middle_name, '')), '[[:space:]]+', ' ', 'g'), '');
  new.last_name := regexp_replace(btrim(new.last_name), '[[:space:]]+', ' ', 'g');
  if not coalesce(private.valid_person_name(new.first_name, 1, 60), false)
    or not coalesce(private.valid_person_name(new.last_name, 1, 60), false)
    or (new.middle_name is not null and not coalesce(private.valid_person_name(new.middle_name, 1, 60), false)) then
    raise exception 'Names may contain letters, spaces, hyphens, apostrophes, and a final initial period.' using errcode = '23514';
  end if;
  new.display_name := concat_ws(' ', new.first_name, new.middle_name, new.last_name);
  if not coalesce(private.valid_input_text(new.display_name, 2, 100), false) then
    raise exception 'The full name must be no longer than 100 characters.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.sync_profile_name_parts() from public, anon;
grant execute on function private.sync_profile_name_parts() to authenticated;

create function private.validate_walk_in_reporter_name()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.reporter_name := regexp_replace(btrim(new.reporter_name), '[[:space:]]+', ' ', 'g');
  if not coalesce(private.valid_person_name(new.reporter_name, 2, 100), false) then
    raise exception 'Enter a valid reporter name using letters, spaces, hyphens, or apostrophes.' using errcode = '23514';
  end if;
  new.reporter_email := nullif(lower(btrim(coalesce(new.reporter_email, ''))), '');
  if new.reporter_email is not null and not private.valid_email_address(new.reporter_email) then
    raise exception 'Enter a valid reporter email address.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_walk_in_reporter_name() from public, anon, authenticated;
alter table private.walk_in_reporter_details drop constraint if exists walk_in_reporter_email_format;
alter table private.walk_in_reporter_details add constraint walk_in_reporter_email_format
  check (reporter_email is null or private.valid_email_address(reporter_email));
create trigger validate_walk_in_reporter_name
  before insert or update of reporter_name, reporter_email on private.walk_in_reporter_details
  for each row execute function private.validate_walk_in_reporter_name();

drop policy announcement_image_read on storage.objects;
create policy announcement_image_read on storage.objects for select to authenticated using (
  bucket_id = 'announcement-media' and exists (
    select 1 from public.announcements a
    where a.id::text = (storage.foldername(name))[1]
      and (
        (private.active_staff() and private.community_access(a.barangay_id, a.organization_id, 'read'))
        or (private.active_resident() and a.status = 'published' and a.publish_at <= now()
          and (a.barangay_id is null or a.barangay_id = (select p.barangay_id from public.profiles p where p.id = auth.uid())))
      )
  )
);

alter table public.email_outbox
  alter column recipient_id drop not null,
  add column recipient_email text,
  add column recipient_name text,
  add constraint email_outbox_recipient_identity check (
    (recipient_id is not null and recipient_email is null and recipient_name is null)
    or (recipient_id is null and recipient_email is not null
      and recipient_email = lower(btrim(recipient_email))
      and private.valid_email_address(recipient_email)
      and (recipient_name is null or private.valid_person_name(recipient_name, 2, 100)))
  );
create index email_outbox_external_recipient on public.email_outbox(recipient_email, created_at desc)
  where recipient_id is null;

drop function public.claim_email_outbox(integer);
create function public.claim_email_outbox(p_limit integer default 20)
returns table(
  id uuid, recipient_id uuid, event_key text, report_id uuid,
  meeting_request_id uuid, announcement_id uuid, consultation_id uuid,
  notification_title text, recipient_email text, recipient_name text
)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with candidates as (
    select o.id
    from public.email_outbox o
    where (o.status = 'queued' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.locked_at < now() - interval '10 minutes')
    order by o.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 40))
  ), claimed as (
    update public.email_outbox o
       set status = 'sending', attempts = least(o.attempts + 1, 5), locked_at = now(), last_error = null
      from candidates c
     where o.id = c.id
    returning o.id, o.recipient_id, o.event_key, o.report_id, o.meeting_request_id,
      o.announcement_id, o.consultation_id, o.notification_title, o.recipient_email,
      o.recipient_name, o.created_at
  )
  select c.id, c.recipient_id, c.event_key, c.report_id, c.meeting_request_id,
    c.announcement_id, c.consultation_id, c.notification_title, c.recipient_email,
    c.recipient_name
  from claimed c order by c.created_at;
end;
$$;
revoke all on function public.claim_email_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer) to service_role;

create function private.queue_walk_in_report_update_email()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_name text;
begin
  select lower(btrim(details.reporter_email)), details.reporter_name
    into v_email, v_name
    from public.reports report
    join private.walk_in_reporter_details details on details.report_id = report.id
   where report.id = new.report_id
     and report.submission_source = 'walk_in'
     and not report.is_demo
     and nullif(btrim(details.reporter_email), '') is not null;
  if v_email is null then return new; end if;

  insert into public.email_outbox(
    dedupe_key, recipient_email, recipient_name, event_key, report_id, notification_title
  ) values (
    'walk-in-update:' || new.id::text, v_email, v_name, 'report_update', new.report_id,
    'Your walk-in report has an update'
  ) on conflict (dedupe_key) do nothing;
  return new;
end;
$$;
revoke all on function private.queue_walk_in_report_update_email() from public, anon, authenticated;
create trigger queue_walk_in_report_update_email
  after insert on public.report_status_history
  for each row execute function private.queue_walk_in_report_update_email();

create or replace function private.deliver_announcement(p_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  a public.announcements;
  claimed uuid;
  recipients integer;
begin
  select * into a from public.announcements where id = p_id for update;
  if not found or a.status <> 'published' or a.publish_at > now() or a.is_sample then return 0; end if;
  insert into private.announcement_deliveries(announcement_id) values (a.id)
    on conflict do nothing returning announcement_id into claimed;
  if claimed is null then return 0; end if;
  insert into public.notifications(user_id, title, announcement_id)
    select p.id, 'A new official announcement is available', a.id
    from public.profiles p
    where p.notifications_enabled and p.account_status = 'active'
      and (a.barangay_id is null or p.barangay_id = a.barangay_id);
  get diagnostics recipients = row_count;
  return recipients;
end;
$$;
revoke all on function private.deliver_announcement(uuid) from public, anon, authenticated, service_role;

create or replace function private.deliver_due_announcements() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  a record;
  recipients integer := 0;
begin
  for a in
    select announcement.id from public.announcements announcement
    where announcement.status = 'published' and announcement.publish_at <= now()
      and not announcement.is_sample
      and not exists(select 1 from private.announcement_deliveries d where d.announcement_id = announcement.id)
    order by announcement.publish_at, announcement.id
    limit 100 for update of announcement skip locked
  loop
    recipients := recipients + private.deliver_announcement(a.id);
  end loop;
  return recipients;
end;
$$;
revoke all on function private.deliver_due_announcements() from public, anon, authenticated, service_role;

insert into public.announcements(title, body, kind, status, publish_at, created_by, is_sample)
select 'Keep neighborhood drains clear before heavy rain',
  'Please avoid placing household waste near drainage openings and report blocked inlets through Iligan Connect. Clear drainage helps water flow during periods of rain.',
  'Public service advisory', 'published', now(), admin.id, true
from public.profiles admin
where admin.role = 'admin' and admin.account_status = 'active'
  and not exists (select 1 from public.announcements where title = 'Keep neighborhood drains clear before heavy rain' and is_sample)
order by admin.id limit 1;

insert into public.announcements(title, body, kind, status, publish_at, created_by, is_sample)
select 'What to include when submitting a community report',
  'Choose the closest issue category, describe what you observed, and place the map pin near the location. You can follow the report in Iligan Connect to see review and progress updates.',
  'Resident information', 'published', now(), admin.id, true
from public.profiles admin
where admin.role = 'admin' and admin.account_status = 'active'
  and not exists (select 1 from public.announcements where title = 'What to include when submitting a community report' and is_sample)
order by admin.id limit 1;

notify pgrst, 'reload schema';
