-- Run as database owner. All synthetic users, content, notifications and audits roll back.
begin;
do $$
declare
  owner_id uuid; local_barangay uuid; other_barangay uuid;
  opted_in uuid:=gen_random_uuid(); opted_out uuid:=gen_random_uuid(); disabled_id uuid:=gen_random_uuid(); outside_id uuid:=gen_random_uuid();
  future_id uuid:=gen_random_uuid(); due_id uuid:=gen_random_uuid(); draft_id uuid:=gen_random_uuid(); archived_id uuid:=gen_random_uuid();
  before_count integer; expected integer; actual integer;
begin
  select id into owner_id from public.profiles where role='admin' and account_status='active' limit 1;
  select id into local_barangay from public.barangays order by name limit 1;
  select id into other_barangay from public.barangays where id<>local_barangay order by name limit 1;
  if owner_id is null or other_barangay is null then raise exception 'Missing active administrator or reference data'; end if;
  insert into auth.users(id,email) values
    (opted_in,opted_in::text||'@example.invalid'),(opted_out,opted_out::text||'@example.invalid'),
    (disabled_id,disabled_id::text||'@example.invalid'),(outside_id,outside_id::text||'@example.invalid');
  update public.profiles set barangay_id=local_barangay,account_status='active',notifications_enabled=true where id in(opted_in,opted_out,disabled_id);
  update public.profiles set notifications_enabled=false where id=opted_out;
  update public.profiles set account_status='disabled' where id=disabled_id;
  update public.profiles set barangay_id=other_barangay,account_status='active',notifications_enabled=true where id=outside_id;

  insert into public.announcements(id,title,body,status,publish_at,barangay_id,created_by) values
    (future_id,'[DEMO TEST] Future delivery','Synthetic rollback-only scheduled announcement.','published',now()+interval '1 day',local_barangay,owner_id),
    (draft_id,'[DEMO TEST] Draft delivery','Synthetic rollback-only draft announcement.','draft',now()-interval '1 day',local_barangay,owner_id),
    (archived_id,'[DEMO TEST] Archived delivery','Synthetic rollback-only archived announcement.','archived',now()-interval '1 day',local_barangay,owner_id);
  if exists(select 1 from public.notifications where announcement_id in(future_id,draft_id,archived_id)) then raise exception 'Premature notification'; end if;
  if exists(select 1 from private.announcement_deliveries where announcement_id in(future_id,draft_id,archived_id)) then raise exception 'Premature delivery marker'; end if;
  if private.deliver_announcement(future_id)<>0 then raise exception 'Future helper delivered early'; end if;

  insert into public.announcements(id,title,body,status,publish_at,barangay_id,created_by)
    values(due_id,'[DEMO TEST] Due delivery','Synthetic rollback-only due announcement.','published',now()-interval '1 minute',local_barangay,owner_id);
  select count(*) into expected from public.profiles where barangay_id=local_barangay and notifications_enabled and account_status='active';
  select count(*) into actual from public.notifications where announcement_id=due_id;
  if actual<>expected or actual<1 then raise exception 'Immediate audience mismatch'; end if;
  if not exists(select 1 from public.notifications where announcement_id=due_id and user_id=opted_in) then raise exception 'Opted-in resident missed'; end if;
  if exists(select 1 from public.notifications where announcement_id=due_id and user_id in(opted_out,disabled_id,outside_id)) then raise exception 'Audience/preference/account restriction failed'; end if;

  -- Simulate an overdue publication missed by the trigger, using only this test's rows.
  delete from public.notifications where announcement_id=due_id;
  delete from private.announcement_deliveries where announcement_id=due_id;
  perform private.deliver_due_announcements();
  select count(*) into actual from public.notifications where announcement_id=due_id;
  if actual<>expected then raise exception 'Scheduled worker audience mismatch'; end if;
  perform private.deliver_due_announcements();
  perform private.deliver_announcement(due_id);
  update public.announcements set body=body||' Edited.' where id=due_id;
  update public.announcements set status='archived' where id=due_id;
  update public.announcements set status='published' where id=due_id;
  select count(*) into actual from public.notifications where announcement_id=due_id;
  if actual<>expected then raise exception 'Retry/edit/republish duplicated delivery'; end if;
  if exists(select 1 from public.notifications where announcement_id in(future_id,draft_id,archived_id)) then raise exception 'Worker delivered an ineligible announcement'; end if;

  update public.announcements set publish_at=now()-interval '1 second' where id=future_id;
  select count(*) into actual from public.notifications where announcement_id=future_id;
  if actual<>expected then raise exception 'Rescheduling to immediate publication failed'; end if;
  select count(*) into before_count from public.notifications where announcement_id in(due_id,future_id);
  perform private.deliver_due_announcements();
  if (select count(*) from public.notifications where announcement_id in(due_id,future_id))<>before_count then raise exception 'Worker is not idempotent'; end if;

  if has_function_privilege('authenticated','private.deliver_due_announcements()','EXECUTE')
    or has_function_privilege('anon','private.deliver_due_announcements()','EXECUTE')
    or has_function_privilege('authenticated','private.deliver_announcement(uuid)','EXECUTE')
    or has_table_privilege('authenticated','private.announcement_deliveries','SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'Delivery internals exposed to clients'; end if;
end $$;
rollback;
select 'PASS: immediate, scheduled, audience, preference, disabled-account, retry, edit, republish, reschedule and private-access checks; fixtures rolled back' as result;
