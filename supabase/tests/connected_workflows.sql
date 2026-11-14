-- Database-owner acceptance. Every fixture, notification and audit write rolls back.
begin;
update public.analytics_settings set include_samples=false;
set local statement_timeout = '30s';
do $tests$
declare
  resident uuid := gen_random_uuid(); other_resident uuid := gen_random_uuid();
  reviewer uuid := gen_random_uuid(); outside_staff uuid := gen_random_uuid();
  officer uuid := gen_random_uuid(); administrator uuid := gen_random_uuid();
  organization uuid := gen_random_uuid(); report uuid := gen_random_uuid();
  consultation uuid := gen_random_uuid(); comment uuid := gen_random_uuid();
  request uuid := gen_random_uuid(); meeting uuid := gen_random_uuid();
  announcement uuid := gen_random_uuid(); future_announcement uuid := gen_random_uuid();
  barangay uuid; other_barangay uuid; category uuid; problem text;
  affected integer; denied boolean; payload jsonb; demo_report uuid; inactive_actor uuid;
begin
  select id into barangay from public.barangays where name='Poblacion';
  select id into other_barangay from public.barangays where id<>barangay order by name limit 1;
  select c.id,p.code into category,problem from public.report_categories c
    join public.report_problem_types p on p.category_id=c.id
    where c.active and p.code<>'other' order by c.name,p.sort_order limit 1;
  assert barangay is not null and other_barangay is not null and category is not null, 'Reference data unavailable';
  insert into auth.users(id,email) select id,id::text||'@example.invalid'
    from unnest(array[resident,other_resident,reviewer,outside_staff,officer,administrator]) as u(id);
  update public.profiles set barangay_id=barangay,notifications_enabled=true
    where id in(resident,other_resident,reviewer);
  update public.profiles set role='barangay' where id=reviewer;
  update public.profiles set role='barangay',barangay_id=other_barangay where id=outside_staff;
  update public.profiles set role='office' where id=officer;
  update public.profiles set role='admin' where id=administrator;
  insert into public.organizations(id,name,active,can_consult,can_coordinate,can_publish)
    values(organization,'[ROLLBACK ONLY] '||organization,true,true,true,true);
  insert into public.organization_memberships(user_id,organization_id) values(officer,organization);
  insert into public.organization_access_rules(organization_id,category_id,barangay_id,assignment_only,can_review,can_update,can_refer,enabled)
    values(organization,category,barangay,true,true,true,true,true);

  perform set_config('request.jwt.claim.sub',resident::text,true);
  set local role authenticated;
  perform public.submit_report(report,category,barangay,'Rollback workflow concern',
    'Synthetic transaction-only concern. No actual local defect is alleged.',8.22947578,124.23688253,'Rollback-only location',problem);
  perform public.submit_report(report,category,barangay,'Rollback workflow concern',
    'Synthetic transaction-only concern. No actual local defect is alleged.',8.22947578,124.23688253,'Rollback-only location',problem);
  assert (select count(*)=1 from public.reports where id=report), 'Submission retry duplicated report';
  denied:=false;
  begin perform public.set_role(resident,'admin'); exception when raise_exception then denied:=sqlerrm='Not authorized'; end;
  assert denied, 'Resident role escalation allowed';
  denied:=false;
  begin perform public.change_report(report,'verified','Unauthorized verification',null,2); exception when insufficient_privilege then denied:=sqlerrm='Not authorized'; when raise_exception then denied:=sqlerrm='Not authorized'; end;
  assert denied, 'Resident verification allowed';
  perform set_config('request.jwt.claim.sub',other_resident::text,true);
  assert not exists(select 1 from public.reports where id=report), 'Other resident read private report';
  perform set_config('request.jwt.claim.sub',outside_staff::text,true);
  assert not exists(select 1 from public.reports where id=report), 'Other jurisdiction read private report';
  perform set_config('request.jwt.claim.sub',officer::text,true);
  assert not exists(select 1 from public.reports where id=report), 'Assignment-only office read unassigned report';

  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  assert exists(select 1 from public.reports where id=report), 'Barangay cannot read its report';
  perform public.change_report(report,'under_review','Rollback-only review started');
  perform public.change_report(report,'verified','Rollback-only assessed concern',null,2,null,'Rollback-only public summary',2);
  insert into public.report_internal_notes(report_id,body) values(report,'Private rollback-only assessment');
  assert exists(select 1 from public.referral_options(report) where id=organization), 'Approved referral target absent';
  perform public.change_report(report,'assigned','Rollback-only office referral',organization);
  perform set_config('request.jwt.claim.sub',officer::text,true);
  assert exists(select 1 from public.reports where id=report and organization_id=organization), 'Referral did not connect office';
  assert exists(select 1 from public.notifications where report_id=report), 'Office work notification absent';
  perform public.change_report(report,'scheduled','Rollback-only office inspection scheduled.',p_scheduled_at=>now()+interval '1 day');
  reset role;
  update public.reports set scheduled_at=((timezone('Asia/Manila',now())::date - 1)::timestamp at time zone 'Asia/Manila') where id=report;
  set local role authenticated;
  perform public.change_report(report,'in_progress','Rollback-only office work started');
  perform public.change_report(report,'resolved','Rollback-only office work completed');
  assert (select count(*)=6 from public.report_status_history where report_id=report), 'Workflow history incomplete';
  assert (select (public.dashboard_counts()->>'resolved')::integer>=1), 'Office dashboard disagrees with resolved case';

  perform set_config('request.jwt.claim.sub',resident::text,true);
  assert exists(select 1 from public.reports where id=report and status='resolved'), 'Resident cannot track resolution';
  assert not exists(select 1 from public.report_internal_notes where report_id=report), 'Resident read private staff notes';
  select to_jsonb(p) into payload from public.public_report_page(p_search=>'Rollback-only public summary') p where p.id=report;
  assert payload is not null, 'Verified report absent from public discovery';
  assert not (payload ?| array['resident_id','description','landmark']), 'Public discovery leaks private fields';
  assert exists(select 1 from public.notifications where report_id=report), 'Resident status notifications absent';
  update public.notifications set read_at=now() where user_id=resident and report_id=report;
  assert not exists(select 1 from public.notifications where report_id=report and read_at is null), 'Notification read failed';
  assert not exists(select 1 from public.notifications where user_id=officer), 'Resident read office notifications';

  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  insert into public.consultations(id,barangay_id,organization_id,title,body,status,report_id)
    values(consultation,barangay,organization,'Rollback-only consultation','Transaction-only community workflow','open',report);
  perform set_config('request.jwt.claim.sub',resident::text,true);
  insert into public.consultation_followers(consultation_id) values(consultation);
  insert into public.consultation_comments(id,consultation_id,body,official)
    values(comment,consultation,'Rollback-only resident comment',true);
  assert exists(select 1 from public.consultation_comments where id=comment and not official), 'Resident forged official badge';
  insert into public.comment_flags(comment_id,reason) values(comment,'Rollback-only moderation check');
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  assert exists(select 1 from public.comment_flags where comment_id=comment), 'Staff cannot review flag';
  insert into public.consultation_comments(consultation_id,body,parent_id)
    values(consultation,'Rollback-only official reply',comment);
  assert exists(select 1 from public.consultation_comments where parent_id=comment and official), 'Staff official badge absent';
  update public.consultation_comments set hidden=true,moderation_reason='Rollback-only moderation decision' where id=comment;
  perform set_config('request.jwt.claim.sub',resident::text,true);
  assert not exists(select 1 from public.consultation_comments where id=comment), 'Moderated comment visible';
  request:=public.submit_meeting_request('Rollback-only meeting request','Transaction-only coordination request',barangay,category,report,array[organization]);
  insert into public.meeting_supporters(request_id) values(request);
  update public.meeting_requests set status='approved',decision_reason='Unauthorized resident decision' where id=request;
  get diagnostics affected=row_count;
  assert affected=0, 'Resident approved own meeting';
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  update public.meeting_requests set status='approved',decision_reason=null where id=request;
  assert exists(select 1 from public.meeting_requests where id=request and status='approved'), 'Meeting approval failed';
  insert into public.meetings(id,request_id,starts_at,venue) values(meeting,request,now()+interval '1 day','Rollback-only venue');
  perform set_config('request.jwt.claim.sub',officer::text,true);
  perform public.respond_meeting_office_invitation(request,organization,true,null);
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  insert into public.meeting_action_items(meeting_id,organization_id,description)
    values(meeting,organization,'Rollback-only office follow-up');
  perform set_config('request.jwt.claim.sub',resident::text,true);
  assert exists(select 1 from public.meetings where id=meeting), 'Resident cannot see approved meeting schedule';
  assert exists(select 1 from public.meeting_action_items where meeting_id=meeting), 'Resident cannot see meeting actions';
  perform set_config('request.jwt.claim.sub',officer::text,true);
  assert public.community_permissions('meeting_requests',request), 'Assigned office cannot coordinate linked meeting';

  perform set_config('request.jwt.claim.sub',administrator::text,true);
  insert into public.announcements(id,barangay_id,title,body,status,publish_at)
    values(announcement,barangay,'Rollback-only announcement','Transaction-only published update','published',now()-interval '1 minute'),
      (future_announcement,barangay,'Rollback-only scheduled update','Transaction-only future update','published',now()+interval '1 day');
  perform set_config('request.jwt.claim.sub',resident::text,true);
  assert exists(select 1 from public.announcements where id=announcement), 'Resident cannot read published announcement';
  assert not exists(select 1 from public.announcements where id=future_announcement), 'Future publication visible early';
  assert exists(select 1 from public.notifications where announcement_id=announcement), 'Announcement notification absent';
  assert not exists(select 1 from public.notifications where announcement_id=future_announcement), 'Future announcement notified early';
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  perform public.set_account_status(officer,'disabled');
  perform set_config('request.jwt.claim.sub',officer::text,true);
  assert not exists(select 1 from public.reports where id=report), 'Disabled officer retained report access';
  assert not exists(select 1 from public.notifications), 'Disabled officer retained notification access';
  assert not coalesce((public.staff_context()->>'authorized')::boolean,true), 'Disabled staff remains authorized';
  reset role;
  -- Lookup must work for a published case older than the capped discovery feed.
  perform set_config('request.jwt.claim.sub','',true);
  update public.reports set created_at=now()-interval '1 year' where id=report;
  perform set_config('request.jwt.claim.sub',resident::text,true);
  alter table public.reports disable trigger report_rate;
  insert into public.reports(resident_id,category_id,problem_type,barangay_id,title,description,latitude,longitude,
    status,severity,verified_at,public_summary,public_visible)
    select resident,category,problem,barangay,'Rollback-only newer public record '||n,
      'Synthetic transaction-only records for discovery cap verification.',8.22947578,124.23688253,
      'verified'::public.report_status,2,now(),'Rollback-only newer public summary '||n,true
    from generate_series(1,500) as fixture(n);
  perform set_config('request.jwt.claim.sub',resident::text,true);
  set local role authenticated;
  assert not exists(select 1 from public.public_reports() where id=report), 'Lookup cap fixture did not exclude older feed record';
  select to_jsonb(p) into payload from public.public_report_by_id(report) p;
  assert payload is not null and payload->>'id'=report::text, 'Older published report lookup failed';
  assert not (payload ?| array['resident_id','description','landmark']), 'Public report lookup leaks private fields';
  assert (payload->>'latitude')::float8=round(8.22947578::numeric,3)::float8
    and (payload->>'longitude')::float8=round(124.23688253::numeric,3)::float8, 'Lookup exposes precise report coordinates';
  perform set_config('request.jwt.claim.sub',officer::text,true);
  assert not exists(select 1 from public.public_report_by_id(report)), 'Disabled account can use public lookup';
  reset role;
  select id into strict demo_report from public.reports where title='Rollback-only newer public record 1';
  update public.reports set is_demo=true,public_summary='Rollback-only demo lookup '||demo_report where id=demo_report;
  perform set_config('request.jwt.claim.sub',resident::text,true);
  set local role authenticated;
  assert not exists(select 1 from public.public_reports() where id=demo_report), 'Demo record exposed by capped public feed';
  assert not exists(select 1 from public.public_report_page(p_search=>'Rollback-only demo lookup '||demo_report)), 'Demo record exposed by legacy public page';
  assert not exists(select 1 from public.public_report_page(null,null,'Rollback-only demo lookup '||demo_report,0,'all',false)), 'Demo record exposed by filtered public page';
  assert (select all_count=0 from public.public_report_filter_counts(null,null,'Rollback-only demo lookup '||demo_report,false)), 'Demo record included in public filter counts';
  reset role;
  update public.profiles set account_status='pending' where id=reviewer;
  foreach inactive_actor in array array[officer,reviewer] loop
    perform set_config('request.jwt.claim.sub',inactive_actor::text,true);
    set local role authenticated;
    assert not exists(select 1 from public.public_reports()), 'Inactive account can read capped public feed';
    assert not exists(select 1 from public.public_report_page(p_search=>'')), 'Inactive account can read legacy public page';
    assert not exists(select 1 from public.public_report_page(null,null,'',0,'all',false)), 'Inactive account can read filtered public page';
    assert (select all_count=0 and active_count=0 and resolved_count=0 from public.public_report_filter_counts(null,null,'',false)), 'Inactive account can read public filter counts';
    assert not exists(select 1 from public.public_report_by_id(report)), 'Inactive account can read public lookup';
    assert not exists(select 1 from public.reports where id=report), 'Inactive account can read private report';
    reset role;
  end loop;
  perform set_config('request.jwt.claim.sub',resident::text,true);
  update public.reports set is_demo=true where id=report;
  perform set_config('request.jwt.claim.sub',resident::text,true);
  set local role authenticated;
  assert not exists(select 1 from public.public_report_by_id(report)), 'Demo record exposed by public lookup';
  reset role;
  update public.reports set is_demo=false,public_visible=false where id=report;
  set local role authenticated;
  assert not exists(select 1 from public.public_report_by_id(report)), 'Nonpublic record exposed by lookup';
  reset role;
  update public.reports set public_visible=true,status='rejected' where id=report;
  set local role authenticated;
  assert not exists(select 1 from public.public_report_by_id(report)), 'Rejected record exposed by lookup';
  reset role;
  update public.reports set status='duplicate' where id=report;
  set local role authenticated;
  assert not exists(select 1 from public.public_report_by_id(report)), 'Duplicate record exposed by lookup';
  reset role;
  denied:=false;
  set local role anon;
  begin perform public.public_report_by_id(report); exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Anonymous report lookup allowed';
  reset role;
  assert exists(select 1 from public.audit_logs where record_id=report::text), 'Workflow audit absent';
end $tests$;
rollback;
select 'PASS: connected resident, barangay, office, admin, report, community, meeting, notification, analytics and revocation assertions; all fixtures rolled back' as result;
