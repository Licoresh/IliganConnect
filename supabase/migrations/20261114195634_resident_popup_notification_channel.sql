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
          'channelId', 'community-alerts',
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
