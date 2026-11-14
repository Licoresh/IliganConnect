create extension if not exists pg_net;

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  notification_id uuid references public.notifications(id) on delete set null,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null check (event_key in (
    'report_received','report_triage','report_update','meeting_request',
    'meeting_invitation','meeting_update','meeting_declined','announcement','consultation'
  )),
  report_id uuid references public.reports(id) on delete set null,
  meeting_request_id uuid references public.meeting_requests(id) on delete set null,
  announcement_id uuid references public.announcements(id) on delete set null,
  consultation_id uuid references public.consultations(id) on delete set null,
  notification_title text,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index email_outbox_due on public.email_outbox(next_attempt_at, created_at)
  where status in ('queued','sending');
create index email_outbox_recipient on public.email_outbox(recipient_id, created_at desc);
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from public, anon, authenticated;

do $vault$
begin
  if not exists (select 1 from vault.secrets where name = 'ilc_email_dispatch_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ilc_email_dispatch_token', 'Private authentication token for the Iligan Connect email dispatcher');
  end if;
end
$vault$;

create or replace function public.is_email_dispatch_authorized(p_token text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p_token <> '' and p_token = (
    select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'ilc_email_dispatch_token'
  ), false)
$$;
revoke all on function public.is_email_dispatch_authorized(text) from public, anon, authenticated;
grant execute on function public.is_email_dispatch_authorized(text) to service_role;

create or replace function public.claim_email_outbox(p_limit integer default 20)
returns table(
  id uuid, recipient_id uuid, event_key text, report_id uuid,
  meeting_request_id uuid, announcement_id uuid, consultation_id uuid,
  notification_title text
)
language plpgsql security definer set search_path = ''
as $$
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
              o.announcement_id, o.consultation_id, o.notification_title, o.created_at
  )
  select c.id, c.recipient_id, c.event_key, c.report_id, c.meeting_request_id,
         c.announcement_id, c.consultation_id, c.notification_title
    from claimed c order by c.created_at;
end
$$;
revoke all on function public.claim_email_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer) to service_role;

create or replace function public.finish_email_outbox(
  p_id uuid, p_success boolean, p_message_id text default null,
  p_error text default null, p_retryable boolean default false
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.email_outbox o
     set status = case
           when p_success then 'sent'
           when p_retryable and o.attempts < 5 then 'queued'
           when p_error = 'Recipient is inactive or notifications are disabled.'
             or p_error = 'Recipient has no confirmed email address.'
             or p_error = 'The linked record is unavailable or is presentation data.' then 'skipped'
           else 'failed'
         end,
         provider_message_id = case when p_success then nullif(left(p_message_id, 500), '') else null end,
         last_error = case when p_success then null else left(coalesce(p_error, 'Delivery failed.'), 1000) end,
         next_attempt_at = case when p_retryable and o.attempts < 5
           then now() + make_interval(mins => least(30, power(2, o.attempts)::integer))
           else o.next_attempt_at end,
         locked_at = null,
         sent_at = case when p_success then now() else null end
   where o.id = p_id and o.status = 'sending';
end
$$;
revoke all on function public.finish_email_outbox(uuid, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.finish_email_outbox(uuid, boolean, text, text, boolean) to service_role;

create or replace function private.queue_email_from_notification()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_event text;
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = new.user_id and p.account_status = 'active' and p.notifications_enabled
  ) then return new; end if;

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
end
$$;
revoke all on function private.queue_email_from_notification() from public, anon, authenticated;
create trigger queue_email_from_notification
  after insert on public.notifications
  for each row execute function private.queue_email_from_notification();

create or replace function private.queue_report_submission_email()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_demo then return new; end if;

  insert into public.email_outbox(dedupe_key, recipient_id, event_key, report_id)
  values ('report-received:' || new.id::text, new.resident_id, 'report_received', new.id)
  on conflict (dedupe_key) do nothing;

  insert into public.notifications(user_id, title, report_id)
  select p.id, 'A new report was submitted in your barangay', new.id
    from public.profiles p
   where p.role = 'barangay' and p.barangay_id = new.barangay_id
     and p.account_status = 'active' and p.notifications_enabled
     and p.id <> new.resident_id;
  return new;
end
$$;
revoke all on function private.queue_report_submission_email() from public, anon, authenticated;
create trigger queue_report_submission_email
  after insert on public.reports
  for each row execute function private.queue_report_submission_email();

create or replace function private.wake_email_dispatch()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text;
begin
  select s.decrypted_secret into v_token
    from vault.decrypted_secrets s where s.name = 'ilc_email_dispatch_token';
  if v_token is null then return; end if;
  perform net.http_post(
    url := 'https://kbihklfbqhmtowcqojir.supabase.co/functions/v1/email-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
    body := jsonb_build_object('source', 'email-outbox')
  );
exception when others then
  return;
end
$$;
revoke all on function private.wake_email_dispatch() from public, anon, authenticated;

create or replace function private.wake_email_dispatch_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('ilc-email-dispatch', 0)) then
    perform private.wake_email_dispatch();
  end if;
  return new;
end
$$;
revoke all on function private.wake_email_dispatch_after_insert() from public, anon, authenticated;
create trigger wake_email_dispatch_after_insert
  after insert on public.email_outbox
  for each row execute function private.wake_email_dispatch_after_insert();

do $cron$
begin
  if not exists (select 1 from cron.job where jobname = 'ilc-email-outbox-dispatch') then
    perform cron.schedule('ilc-email-outbox-dispatch', '* * * * *', 'select private.wake_email_dispatch()');
  end if;
end
$cron$;
