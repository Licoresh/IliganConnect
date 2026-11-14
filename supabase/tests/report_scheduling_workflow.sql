begin;
set local statement_timeout='30s';
do $tests$
declare
  resident uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); officer uuid:=gen_random_uuid();
  area uuid; category uuid; problem text; org uuid:=gen_random_uuid(); local_report uuid:=gen_random_uuid(); office_report uuid:=gen_random_uuid();
  denied boolean; states text[]; original_schedule timestamptz;
begin
  select id into strict area from public.barangays where name='Poblacion';
  select c.id,p.code into strict category,problem from public.report_categories c
    join public.report_problem_types p on p.category_id=c.id
    where c.active and p.code<>'other' order by c.name,p.sort_order limit 1;
  insert into auth.users(id,email) select id,id::text||'@example.invalid' from unnest(array[resident,reviewer,officer]) f(id);
  update public.profiles set barangay_id=area,notifications_enabled=true where id=resident;
  update public.profiles set role='barangay',barangay_id=area where id=reviewer;
  update public.profiles set role='office' where id=officer;
  insert into public.organizations(id,name,active) values(org,'Rollback scheduling office '||left(org::text,8),true);
  insert into public.organization_memberships(user_id,organization_id) values(officer,org);
  insert into public.organization_access_rules(organization_id,category_id,barangay_id,assignment_only,can_review,can_update,can_refer,enabled)
    values(org,category,area,true,false,true,false,true);

  perform set_config('request.jwt.claim.sub',resident::text,true);
  set local role authenticated;
  perform public.submit_report(local_report,category,area,'Rollback local schedule','A rollback-only report for testing the barangay schedule and completion flow.',8.22947578,124.23688253,'',problem);
  perform public.submit_report(office_report,category,area,'Rollback office schedule','A rollback-only report for testing the routed office schedule and completion flow.',8.22947578,124.23688253,'',problem);

  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  denied:=false;
  begin perform public.change_report(local_report,'resolved','A new case cannot start resolved.'); exception when others then denied:=true; end;
  assert denied and (select status='submitted' from public.reports where id=local_report),'New report bypassed review and resolution stages';
  perform public.change_report(local_report,'under_review','Barangay opened the report for review.');
  perform public.change_report(local_report,'verified','Impact and urgency confirmed for local handling.',null,3,null,null,2);
  denied:=false;
  begin perform public.change_report(local_report,'in_progress','Work cannot start before scheduling.'); exception when others then denied:=true; end;
  assert denied and (select status='verified' from public.reports where id=local_report),'Verified report skipped its schedule';
  denied:=false;
  begin perform public.change_report(local_report,'scheduled','Schedule missing a date.'); exception when check_violation then denied:=true; end;
  assert denied,'Scheduled status accepted without a date';
  denied:=false;
  begin perform public.change_report(local_report,'scheduled','Past date must be rejected.',p_scheduled_at=>now()-interval '1 day'); exception when check_violation then denied:=true; end;
  assert denied,'Scheduled status accepted a past date';
  perform public.change_report(local_report,'scheduled','Barangay field work is scheduled.',p_scheduled_at=>now()+interval '1 day');
  select scheduled_at into original_schedule from public.reports where id=local_report;
  denied:=false;
  begin perform public.change_report(local_report,'in_progress','Work cannot start before the scheduled Philippine date.'); exception when check_violation then denied:=true; end;
  assert denied and (select status='scheduled' from public.reports where id=local_report),'Scheduled work started before its Philippine date';
  denied:=false;
  begin perform public.change_report(local_report,'resolved','Work cannot be completed before the scheduled Philippine date.'); exception when check_violation then denied:=true; end;
  assert denied and (select status='scheduled' from public.reports where id=local_report),'Scheduled work was completed before its Philippine date';
  denied:=false;
  begin perform public.change_report(local_report,'scheduled','A reschedule must use a new time.',p_scheduled_at=>original_schedule); exception when check_violation then denied:=true; end;
  assert denied,'Reschedule accepted the unchanged appointment';
  perform public.change_report(local_report,'scheduled','Heavy rain requires a new visit date.',p_scheduled_at=>now()+interval '2 days');
  reset role;
  assert (select count(*)=1 from public.notifications where report_id=local_report and user_id=resident and title='Work on your report has been rescheduled'),'Resident did not receive the reschedule notification';
  assert (select count(*)=1 from public.email_outbox where report_id=local_report and recipient_id=resident and event_key='report_update' and notification_title='Work on your report has been rescheduled'),'Reschedule notification was not connected to the email outbox';
  update public.reports set scheduled_at=((pg_catalog.timezone('Asia/Manila',now())::date - 1)::timestamp at time zone 'Asia/Manila') where id=local_report;
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  set local role authenticated;
  perform public.change_report(local_report,'resolved','Work is complete and the reported area has been checked.');
  reset role;
  select array_agg(new_status::text order by id) into states from public.report_status_history where report_id=local_report and action_kind<>'progress_update';
  assert states=array['under_review','verified','scheduled','scheduled','resolved'],'Local report history is not in workflow order';
  assert (select scheduled_at is not null and status='resolved' from public.reports where id=local_report),'Resolved case lost its planned schedule';

  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  set local role authenticated;
  perform public.change_report(office_report,'under_review','Barangay opened the routed report for review.');
  perform public.change_report(office_report,'assigned','Verified and routed to the responsible office.',org,3,null,null,2);
  perform set_config('request.jwt.claim.sub',officer::text,true);
  denied:=false;
  begin perform public.change_report(office_report,'in_progress','Office cannot skip scheduling.'); exception when others then denied:=true; end;
  assert denied and (select status='assigned' from public.reports where id=office_report),'Assigned report skipped its office schedule';
  perform public.change_report(office_report,'scheduled','Office inspection is scheduled.',p_scheduled_at=>now()+interval '1 day');
  denied:=false;
  begin perform public.change_report(office_report,'in_progress','Office work cannot start before the scheduled Philippine date.'); exception when check_violation then denied:=true; end;
  assert denied and (select status='scheduled' from public.reports where id=office_report),'Office work started before its Philippine date';
  reset role;
  update public.reports set scheduled_at=((pg_catalog.timezone('Asia/Manila',now())::date - 1)::timestamp at time zone 'Asia/Manila') where id=office_report;
  perform set_config('request.jwt.claim.sub',officer::text,true);
  set local role authenticated;
  perform public.change_report(office_report,'in_progress','Office started the scheduled inspection.');
  perform public.change_report(office_report,'resolved','Office completed the corrective work and follow-up.');
  reset role;
  assert (select status='resolved' and scheduled_at is not null from public.reports where id=office_report),'Office completion did not retain its schedule';
  raise notice 'PASS: barangay review, routing, Philippine schedule-day gating, direct completion, rescheduling notifications, and office work';
end $tests$;
rollback;
select 'PASS: report scheduling workflow fixtures rolled back' result;
