create table public.device_push_tokens (
  expo_push_token text primary key check (length(expo_push_token) between 20 and 255),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  updated_at timestamptz not null default now()
);

alter table public.device_push_tokens enable row level security;
revoke all on public.device_push_tokens from anon, authenticated;
grant insert, update, delete on public.device_push_tokens to authenticated;

create policy "Residents register their own push devices"
  on public.device_push_tokens for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'resident'
        and p.account_status = 'active'
    )
  );

create policy "Residents update their own push devices"
  on public.device_push_tokens for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Residents remove their own push devices"
  on public.device_push_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

create index device_push_tokens_user_id_idx on public.device_push_tokens(user_id);

create or replace function private.deliver_resident_push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token text;
  v_body text := 'Open Iligan Connect to view this update.';
  v_data jsonb;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.user_id
      and p.role = 'resident'
      and p.account_status = 'active'
      and p.notifications_enabled
  ) then
    return new;
  end if;

  v_data := jsonb_strip_nulls(jsonb_build_object(
    'notificationId', new.id,
    'reportId', new.report_id,
    'meetingRequestId', new.meeting_request_id,
    'consultationId', new.consultation_id,
    'announcementId', new.announcement_id
  ));

  for v_token in
    select t.expo_push_token
    from public.device_push_tokens t
    where t.user_id = new.user_id
  loop
    begin
      perform net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb,
        body := jsonb_build_object(
          'to', v_token,
          'title', new.title,
          'body', v_body,
          'sound', 'default',
          'priority', 'high',
          'channelId', 'community-updates',
          'data', v_data
        ),
        timeout_milliseconds := 10000
      );
    exception when others then
      raise warning 'Could not queue device push for notification %: %', new.id, sqlerrm;
    end;
  end loop;

  return new;
end
$function$;

revoke all on function private.deliver_resident_push_notification() from public, anon, authenticated;
drop trigger if exists deliver_resident_push_notification on public.notifications;
create trigger deliver_resident_push_notification
  after insert on public.notifications
  for each row execute function private.deliver_resident_push_notification();

comment on table public.device_push_tokens is 'Expo push tokens for resident devices that opted in to phone notifications.';
