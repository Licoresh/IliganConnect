-- Database-owner acceptance. No Storage object DML; all metadata/content rolls back.
begin;
set local statement_timeout='30s';
update public.analytics_settings set include_samples=false;
do $tests$
declare
  owner_id uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); administrator uuid:=gen_random_uuid();
  reviewer uuid:=gen_random_uuid(); officer uuid:=gen_random_uuid(); outside_staff uuid:=gen_random_uuid();
  office_id uuid:=gen_random_uuid(); actual uuid:=gen_random_uuid(); sample_public uuid:=gen_random_uuid();
  sample_private uuid:=gen_random_uuid(); conversation uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
  actual_request uuid:=gen_random_uuid(); meeting_id uuid:=gen_random_uuid(); actual_meeting uuid:=gen_random_uuid();
  announcement uuid:=gen_random_uuid(); actual_announcement uuid:=gen_random_uuid();
  b uuid; outside_b uuid; category uuid; problem text; actor uuid; affected integer:=0; denied boolean;
  marker text:='rollback-'||left(owner_id::text,8); shared_path text; private_path text; actual_path text; hidden_path text;
  payload jsonb; mode boolean;
begin
  select id into b from public.barangays where name='Poblacion';
  select id into outside_b from public.barangays where id<>b order by name limit 1;
  select c.id,p.code into category,problem from public.report_categories c join public.report_problem_types p on p.category_id=c.id
    where c.active and p.code<>'other' order by c.name,p.sort_order limit 1;
  assert b is not null and outside_b is not null and category is not null,'Reference data missing';
  insert into auth.users(id,email) select id,id::text||'@example.invalid'
    from unnest(array[owner_id,viewer,administrator,reviewer,officer,outside_staff]) fixture(id);
  update public.profiles set barangay_id=b where id in(owner_id,viewer,reviewer);
  update public.profiles set role='admin' where id=administrator;
  update public.profiles set role='barangay' where id=reviewer;
  update public.profiles set role='barangay',barangay_id=outside_b where id=outside_staff;
  update public.profiles set role='office' where id=officer;
  insert into public.organizations(id,name,active) values(office_id,marker||' temporary office',true);
  insert into public.organization_memberships(user_id,organization_id) values(officer,office_id);
  insert into public.organization_access_rules(organization_id,category_id,barangay_id,assignment_only,enabled)
    values(office_id,category,b,false,true);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.reports(id,resident_id,category_id,problem_type,barangay_id,title,description,latitude,longitude,status,
    verified_at,public_summary,public_visible,is_demo)
    values(actual,owner_id,category,problem,b,marker||' actual report','Private actual-case text must never enter public discovery.',8.22947578,124.23688253,'verified',now(),marker||' actual public summary',true,false),
      (sample_public,owner_id,category,problem,b,marker||' sample report','Private sample-case text must never enter public discovery.',8.22947578,124.23688253,'verified',now(),marker||' sample public summary',true,true),
      (sample_private,owner_id,category,problem,b,marker||' pending sample','Private sample awaiting review, not published for discovery.',8.22947578,124.23688253,'submitted',null,null,false,true);
  shared_path:=owner_id::text||'/'||sample_public::text||'/illustrative.jpg';
  private_path:=owner_id::text||'/'||sample_public::text||'/private-evidence.jpg';
  actual_path:=owner_id::text||'/'||actual::text||'/actual-evidence.jpg';
  hidden_path:=owner_id::text||'/'||sample_private::text||'/unpublished.jpg';
  insert into public.report_attachments(report_id,owner_id,path,source_url,attribution,is_illustrative)
    values(sample_public,owner_id,shared_path,'https://example.invalid/photo','Rollback-only illustrative metadata; no file exists.',true),
      (sample_public,owner_id,private_path,null,null,false),
      (actual,owner_id,actual_path,'https://example.invalid/photo','Rollback-only actual-case metadata; no file exists.',true),
      (sample_private,owner_id,hidden_path,'https://example.invalid/photo','Rollback-only unpublished metadata; no file exists.',true);
  insert into public.consultations(id,barangay_id,title,body,status,created_by,is_sample)
    values(conversation,b,marker||' sample conversation','Rollback-only community content for sample mode checks.','open',administrator,true);
  insert into public.report_status_history(report_id,actor_id,new_status,public_note)
    select id,administrator,'verified',marker||' history' from unnest(array[actual,sample_public]) fixture(id);
  insert into public.report_assignments(report_id,organization_id,actor_id,reason)
    select id,office_id,administrator,marker||' assignment' from unnest(array[actual,sample_public]) fixture(id);
  insert into public.report_internal_notes(report_id,actor_id,body)
    select id,administrator,marker||' private note' from unnest(array[actual,sample_public]) fixture(id);
  insert into public.report_followers(report_id,user_id) values(actual,owner_id),(sample_public,owner_id);
  insert into public.report_duplicate_links(report_id,canonical_id,reason) values(sample_private,sample_public,marker||' duplicate');
  insert into public.meeting_requests(id,resident_id,barangay_id,title,body,status,decision_reason,is_sample)
    values(request_id,owner_id,b,marker||' sample meeting','Rollback-only sample meeting request for visibility checks.','approved','Rollback-only approval',true),
      (actual_request,owner_id,b,marker||' actual meeting','Rollback-only actual meeting request for visibility checks.','approved','Rollback-only approval',false);
  insert into public.meetings(id,request_id,starts_at,ends_at,venue)
    values(meeting_id,request_id,now()+interval '1 day',now()+interval '1 day'+interval '1 hour','Rollback-only sample venue'),
      (actual_meeting,actual_request,now()+interval '1 day',now()+interval '1 day'+interval '1 hour','Rollback-only actual venue');
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  insert into public.announcements(id,barangay_id,title,body,status,publish_at,created_by,is_sample)
    values(announcement,b,marker||' sample announcement','Rollback-only published sample announcement.','published',now()-interval '1 minute',administrator,true),
      (actual_announcement,b,marker||' actual announcement','Rollback-only published actual announcement.','published',now()-interval '1 minute',administrator,false);
  perform private.deliver_announcement(actual_announcement);
  insert into public.notifications(user_id,title,announcement_id)
    values(owner_id,'Rollback-only sample announcement notification',announcement);

  set local role authenticated;
  foreach mode in array array[false,true] loop
    perform set_config('request.jwt.claim.sub',administrator::text,true);
    update public.analytics_settings set include_samples=mode;
    assert private.sample_data_enabled()=mode,'Administrator mode change did not persist';
    foreach actor in array array[administrator,reviewer,officer] loop
      perform set_config('request.jwt.claim.sub',actor::text,true);
      assert (select count(*) from public.reports where id in(actual,sample_public,sample_private))=case when mode then 3 else 1 end,'Staff sample scope does not follow mode';
      assert (select count(*) from public.map_reports(124,8,125,9) where id in(actual,sample_public,sample_private))=case when mode then 3 else 1 end,'Map scope does not follow mode';
      assert (public.dashboard_counts()->>'total')::integer=(select count(*) from public.reports),'Dashboard total differs from authorized records';
    end loop;
    perform set_config('request.jwt.claim.sub',outside_staff::text,true);
    assert not exists(select 1 from public.reports where id in(actual,sample_public,sample_private)),'Other jurisdiction read fixture reports';
    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    assert (select count(*) from public.reports where id in(actual,sample_public,sample_private))=case when mode then 3 else 1 end,'Owner report visibility does not follow mode';
    assert (select count(*) from public.report_attachments where report_id in(sample_public,sample_private))=case when mode then 3 else 0 end,'Owner bypasses hidden sample attachment scope';
    assert exists(select 1 from public.report_attachments where path=actual_path),'Actual evidence disappeared when changing sample mode';
    assert exists(select 1 from public.meeting_requests where id=actual_request),'Actual request disappeared in sample mode';
    assert exists(select 1 from public.meetings where id=actual_meeting),'Actual meeting disappeared in sample mode';
    assert exists(select 1 from public.announcements where id=actual_announcement),'Actual announcement disappeared in sample mode';
    assert exists(select 1 from public.consultations where id=conversation)=mode,'Sample consultation mode mismatch';
    assert exists(select 1 from public.meeting_requests where id=request_id)=mode,'Sample request mode mismatch';
    assert exists(select 1 from public.meetings where id=meeting_id)=mode,'Sample meeting mode mismatch';
    assert exists(select 1 from public.announcements where id=announcement)=mode,'Sample announcement mode mismatch';
    assert exists(select 1 from public.notifications where announcement_id=announcement)=mode,'Sample notification mode mismatch';
    perform set_config('request.jwt.claim.sub',administrator::text,true);
    assert (select count(*) from public.report_attachments where report_id in(sample_public,sample_private))=case when mode then 3 else 0 end,'Administrator bypasses hidden sample attachment scope';
    assert exists(select 1 from public.report_status_history where report_id=actual),'Actual history disappeared';
    assert exists(select 1 from public.report_assignments where report_id=actual),'Actual assignment disappeared';
    assert exists(select 1 from public.report_internal_notes where report_id=actual),'Actual private note disappeared';
    assert exists(select 1 from public.report_status_history where report_id=sample_public)=mode,'Sample history mode mismatch';
    assert exists(select 1 from public.report_assignments where report_id=sample_public)=mode,'Sample assignment mode mismatch';
    assert exists(select 1 from public.report_internal_notes where report_id=sample_public)=mode,'Sample private note mode mismatch';
    assert exists(select 1 from public.report_duplicate_links where report_id=sample_private)=mode,'Sample duplicate mode mismatch';
    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    assert exists(select 1 from public.report_followers where report_id=actual),'Actual following disappeared';
    assert exists(select 1 from public.report_followers where report_id=sample_public)=mode,'Sample following mode mismatch';
    perform set_config('request.jwt.claim.sub',viewer::text,true);
    assert not exists(select 1 from public.reports where id in(actual,sample_public,sample_private)),'Other resident read private report rows';
    assert (select count(*) from public.public_report_by_id(sample_public))=case when mode then 1 else 0 end,'Direct public sample lookup mode mismatch';
    assert not exists(select 1 from public.public_report_by_id(sample_private)),'Unpublished sample leaked into discovery';
    assert exists(select 1 from public.public_report_by_id(actual)),'Actual public report disappeared';
    assert (select count(*) from public.public_reports() where id in(actual,sample_public))=case when mode then 2 else 1 end,'Legacy public feed mode mismatch';
    assert (select count(*) from public.public_report_page(p_search=>marker))=case when mode then 2 else 1 end,'Public page mode mismatch';
    assert (select count(*) from public.public_report_page(null,null,marker,0,'all',false))=case when mode then 2 else 1 end,'Filtered public page mode mismatch';
    assert (select all_count from public.public_report_filter_counts(null,null,marker,false))=case when mode then 2 else 1 end,'Public count mode mismatch';
    select to_jsonb(p) into payload from public.public_report_by_id(actual) p;
    assert not(payload ?| array['resident_id','description','landmark']),'Public projection includes private fields';
    assert (payload->>'latitude')::numeric=round(8.22947578::numeric,3),'Public location is not rounded';
    assert (select count(*) from public.report_attachments where path=shared_path)=case when mode then 1 else 0 end,'Illustrative attachment sharing mode mismatch';
    assert not exists(select 1 from public.report_attachments where path in(private_path,actual_path,hidden_path)),'Other resident read private or actual evidence metadata';
    assert private.sample_image_readable(shared_path)=mode,'Shared image helper mode mismatch';
    assert not private.sample_image_readable(private_path) and not private.sample_image_readable(actual_path)
      and not private.sample_image_readable(hidden_path),'Image sharing helper exposes private or actual evidence';
    affected:=0;
    begin update public.analytics_settings set include_samples=not mode;get diagnostics affected=row_count;
      exception when insufficient_privilege then null;end;
    assert affected=0 and private.sample_data_enabled()=mode,'Resident changed global sample mode';
  end loop;
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  perform public.set_account_status(viewer,'disabled');
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  assert not exists(select 1 from public.public_reports()),'Disabled account retains public discovery';
  assert not exists(select 1 from public.public_report_by_id(sample_public)),'Disabled account retains direct sample lookup';
  assert not exists(select 1 from public.report_attachments where path=shared_path),'Disabled account retains sample metadata';
  assert not private.sample_image_readable(shared_path),'Disabled account retains illustrative image access';
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  perform public.set_account_status(viewer,'pending');
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  assert not exists(select 1 from public.public_report_by_id(actual)),'Pending account retains actual discovery';
  assert not private.sample_image_readable(shared_path),'Pending account retains illustrative image access';
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  denied:=false;begin perform public.public_report_by_id(sample_public);exception when insufficient_privilege then denied:=true;end;
  assert denied,'Anonymous caller can invoke public sample lookup';
  denied:=false;begin perform private.sample_image_readable(shared_path);exception when insufficient_privilege then denied:=true;end;
  assert denied,'Anonymous caller can invoke sample image helper';
  reset role;
end $tests$;
rollback;
select 'PASS: sample mode, scoped reports/maps/counts, public privacy, illustrations, community, actual records and inactive/anonymous denial; all fixtures rolled back' as result;
