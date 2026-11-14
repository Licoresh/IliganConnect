-- Scope/publishing acceptance. All users, content, notifications and audits roll back.
begin;
set local statement_timeout = '30s';
do $tests$
declare
  administrator uuid:=gen_random_uuid(); officer uuid:=gen_random_uuid();
  reviewer uuid:=gen_random_uuid(); resident uuid:=gen_random_uuid(); pending_officer uuid:=gen_random_uuid();
  organization uuid:=gen_random_uuid(); submission uuid:=gen_random_uuid(); local_update uuid:=gen_random_uuid(); office_publication uuid:=gen_random_uuid();
  b uuid; outside_b uuid; category uuid; denied boolean; affected integer;
begin
  select id into b from public.barangays order by name limit 1;
  select id into outside_b from public.barangays where id<>b order by name limit 1;
  select id into category from public.report_categories where active order by name limit 1;
  assert b is not null and outside_b is not null and category is not null, 'Reference data missing';
  insert into auth.users(id,email) select id,id::text||'@example.invalid'
    from unnest(array[administrator,officer,reviewer,resident,pending_officer]) as fixture(id);
  update public.profiles set role='admin' where id=administrator;
  update public.profiles set role='barangay',barangay_id=b where id=reviewer;
  update public.profiles set role='office' where id in(officer,pending_officer);
  update public.profiles set account_status='pending' where id=pending_officer;
  update public.profiles set barangay_id=b,notifications_enabled=true where id=resident;
  insert into public.organizations(id,name,active,can_publish) values(organization,'[ROLLBACK ONLY] '||organization,true,false);
  insert into public.organization_memberships(user_id,organization_id) values(officer,organization),(pending_officer,organization);
  insert into public.organization_access_rules(organization_id,category_id,barangay_id,enabled)
    values(organization,category,b,true);

  perform set_config('request.jwt.claim.sub',officer::text,true);
  set local role authenticated;
  insert into public.announcements(id,barangay_id,organization_id,title,body,status)
    values(submission,b,organization,'Rollback-only office submission','Transaction-only submission awaiting review','pending_review');
  assert exists(select 1 from public.announcements where id=submission and status='pending_review' and created_by=officer), 'Office submission was not saved with its author';
  update public.announcements set body='Transaction-only revised submission' where id=submission;
  get diagnostics affected=row_count;
  assert affected=1, 'Office cannot edit own pending submission';
  denied:=false;
  begin update public.announcements set status='published' where id=submission;
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Office without publishing capability published pending submission';
  denied:=false;
  begin insert into public.announcements(barangay_id,organization_id,title,body,status)
    values(outside_b,organization,'Rollback-only outside scope','Transaction-only unauthorized scope','pending_review');
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Office submitted outside approved jurisdiction';
  denied:=false;
  begin insert into public.announcements(barangay_id,organization_id,title,body,status,created_by)
    values(b,organization,'Rollback-only forged author','Transaction-only unauthorized author','pending_review',resident);
    exception when insufficient_privilege or check_violation then denied:=true; end;
  assert denied, 'Office forged pending submission author';

  perform set_config('request.jwt.claim.sub',resident::text,true);
  assert not exists(select 1 from public.announcements where id=submission), 'Resident can read pending review submission';
  assert not exists(select 1 from public.notifications where announcement_id=submission), 'Pending review sent resident notifications';
  denied:=false;
  begin insert into public.announcements(barangay_id,organization_id,title,body,status)
    values(b,organization,'Rollback-only resident publish','Transaction-only unauthorized resident publication','published');
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Resident can publish official announcements';
  perform set_config('request.jwt.claim.sub',pending_officer::text,true);
  denied:=false;
  begin insert into public.announcements(barangay_id,organization_id,title,body,status)
    values(b,organization,'Rollback-only pending officer','Transaction-only unapproved staff submission','pending_review');
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Unapproved staff submitted an announcement';

  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  insert into public.announcements(id,barangay_id,title,body,status)
    values(local_update,b,'Rollback-only barangay update','Transaction-only authorized barangay publication','published');
  assert exists(select 1 from public.announcements where id=local_update), 'Barangay publication failed';
  denied:=false;
  begin insert into public.announcements(barangay_id,organization_id,title,body,status)
    values(b,organization,'Rollback-only office impersonation','Transaction-only unauthorized office publication','published');
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Barangay published as an office';
  denied:=false;
  begin insert into public.announcements(barangay_id,title,body,status)
    values(outside_b,'Rollback-only other barangay','Transaction-only unauthorized barangay publication','published');
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Barangay published outside jurisdiction';

  perform set_config('request.jwt.claim.sub',administrator::text,true);
  denied:=false;
  begin insert into public.announcements(barangay_id,title,body,status,created_by)
    values(b,'Rollback-only publisher spoof','Transaction-only unauthorized authorship','published',resident);
    exception when check_violation then denied:=true; end;
  assert denied, 'Authorized publisher forged an author';
  denied:=false;
  begin update public.announcements set created_by=administrator where id=submission;
    exception when check_violation then denied:=true; end;
  assert denied, 'Reviewing administrator overwrote original author';
  update public.announcements set status='published' where id=submission;
  assert exists(select 1 from public.announcements where id=submission and status='published' and created_by=officer), 'Administrator did not publish original office submission';
  perform set_config('request.jwt.claim.sub',resident::text,true);
  assert exists(select 1 from public.announcements where id=submission), 'Published office update unavailable to resident';
  assert (select count(*)=1 from public.notifications where announcement_id=submission), 'Publication notification missing or duplicated';
  perform set_config('request.jwt.claim.sub',officer::text,true);
  update public.announcements set body='Unauthorized post-publication edit' where id=submission;
  get diagnostics affected=row_count;
  assert affected=0, 'Nonpublisher edited published content';
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  update public.organizations set can_publish=true where id=organization;
  perform set_config('request.jwt.claim.sub',officer::text,true);
  insert into public.announcements(id,barangay_id,organization_id,title,body,status)
    values(office_publication,b,organization,'Rollback-only authorized office','Transaction-only capability-approved office publication','published');
  assert exists(select 1 from public.announcements where id=office_publication and created_by=officer), 'Capability-approved office cannot publish';
  perform set_config('request.jwt.claim.sub',resident::text,true);
  assert exists(select 1 from public.announcements where id=office_publication), 'Resident cannot read capability-approved office publication';
  reset role;
end $tests$;
rollback;
select 'PASS: announcement submission, authorship, scope, pending-account, review, publishing and resident notification assertions; all fixtures rolled back' as result;
