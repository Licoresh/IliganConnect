-- Direct publication, author scope, image staging, and resident visibility. All changes roll back.
begin;
set local statement_timeout = '30s';
do $tests$
declare
  administrator uuid:=gen_random_uuid(); officer uuid:=gen_random_uuid();
  barangay_staff uuid:=gen_random_uuid(); resident uuid:=gen_random_uuid(); pending_officer uuid:=gen_random_uuid();
  organization uuid:=gen_random_uuid(); publication uuid:=gen_random_uuid(); staged uuid:=gen_random_uuid();
  barangay_publication uuid:=gen_random_uuid(); citywide_publication uuid:=gen_random_uuid();
  b uuid; outside_b uuid; category uuid; denied boolean; affected integer;
begin
  select id into b from public.barangays order by name limit 1;
  select id into outside_b from public.barangays where id<>b order by name limit 1;
  select id into category from public.report_categories where active order by name limit 1;
  assert b is not null and outside_b is not null and category is not null, 'Reference data missing';
  insert into auth.users(id,email) select id,id::text||'@example.invalid'
    from unnest(array[administrator,officer,barangay_staff,resident,pending_officer]) as fixture(id);
  update public.profiles set role='admin' where id=administrator;
  update public.profiles set role='barangay',barangay_id=b where id=barangay_staff;
  update public.profiles set role='office' where id in(officer,pending_officer);
  update public.profiles set account_status='pending' where id=pending_officer;
  update public.profiles set barangay_id=b,notifications_enabled=true where id=resident;
  insert into public.organizations(id,name,active,can_publish) values(organization,'[ROLLBACK ONLY] '||organization,true,false);
  insert into public.organization_memberships(user_id,organization_id) values(officer,organization),(pending_officer,organization);
  insert into public.organization_access_rules(organization_id,category_id,barangay_id,enabled)
    values(organization,category,b,true);

  -- An office may publish directly through its permitted barangay scope, even without review capability.
  perform set_config('request.jwt.claim.sub',officer::text,true);
  set local role authenticated;
  insert into public.announcements(id,barangay_id,organization_id,title,body,status)
    values(publication,b,organization,'Road maintenance notice','Repairs begin near the market entrance this afternoon.','published');
  assert exists(select 1 from public.announcements where id=publication and status='published' and created_by=officer), 'Office announcement was not published directly';
  update public.announcements set body='Repairs begin near the market entrance tomorrow morning.' where id=publication;
  get diagnostics affected=row_count;
  assert affected=1, 'Author cannot edit own published announcement';
  denied:=false;
  begin update public.announcements set status='pending_review' where id=publication;
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Author moved a direct publication back to review';

  -- Image uploads use a private draft row, then publish only after upload succeeds.
  insert into public.announcements(id,barangay_id,organization_id,title,body,status,attachment_path)
    values(staged,b,organization,'Temporary image upload','Private staging row for an announcement image upload.','draft',staged::text||'/cover.webp');
  assert exists(select 1 from public.announcements where id=staged and status='draft'), 'Scoped image staging row was denied';
  update public.announcements set status='published' where id=staged;
  assert exists(select 1 from public.announcements where id=staged and status='published'), 'Staged announcement was not published after upload';

  denied:=false;
  begin insert into public.announcements(barangay_id,organization_id,title,body,status)
    values(outside_b,organization,'Out-of-scope notice','This office announcement is outside its configured area.','published');
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Office published outside approved jurisdiction';
  denied:=false;
  begin insert into public.announcements(barangay_id,organization_id,title,body,status,created_by)
    values(b,organization,'Forged author notice','An office cannot impersonate another account.','published',resident);
    exception when insufficient_privilege or check_violation then denied:=true; end;
  assert denied, 'Office forged the announcement author';

  perform set_config('request.jwt.claim.sub',resident::text,true);
  assert exists(select 1 from public.announcements where id=publication), 'Resident cannot read a live office announcement';
  assert (select count(*)=1 from public.notifications where announcement_id=publication), 'Immediate publication notification is missing or duplicated';
  denied:=false;
  begin insert into public.announcements(barangay_id,title,body,status)
    values(b,'Resident announcement','Residents cannot create an official announcement.','published');
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Resident published an official announcement';

  perform set_config('request.jwt.claim.sub',pending_officer::text,true);
  denied:=false;
  begin insert into public.announcements(barangay_id,organization_id,title,body,status)
    values(b,organization,'Pending staff notice','Inactive staff cannot publish an announcement.','published');
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Pending staff published an announcement';

  perform set_config('request.jwt.claim.sub',barangay_staff::text,true);
  insert into public.announcements(id,barangay_id,title,body,status)
    values(barangay_publication,b,'Barangay service notice','The barangay office will provide service at the covered court.','published');
  assert exists(select 1 from public.announcements where id=barangay_publication and created_by=barangay_staff), 'Barangay announcement did not publish directly';
  denied:=false;
  begin insert into public.announcements(barangay_id,organization_id,title,body,status)
    values(b,organization,'Office identity notice','Barangay staff cannot publish under another office.','published');
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Barangay published as an office';
  denied:=false;
  begin insert into public.announcements(barangay_id,title,body,status)
    values(outside_b,'Other barangay notice','Barangay staff cannot publish outside their assigned area.','published');
    exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Barangay published outside its jurisdiction';

  perform set_config('request.jwt.claim.sub',administrator::text,true);
  insert into public.announcements(id,title,body,status)
    values(citywide_publication,'Citywide service notice','City services will operate on the posted holiday schedule.','published');
  assert exists(select 1 from public.announcements where id=citywide_publication and created_by=administrator), 'Administrator could not publish citywide';
  denied:=false;
  begin insert into public.announcements(barangay_id,title,body,status,created_by)
    values(b,'Admin forged notice','Administrator authorship must remain truthful.','published',resident);
    exception when check_violation then denied:=true; end;
  assert denied, 'Administrator forged announcement authorship';

  perform set_config('request.jwt.claim.sub',barangay_staff::text,true);
  update public.announcements set body='Unauthorized update to another office notice.' where id=publication;
  get diagnostics affected=row_count;
  assert affected=0, 'A different stakeholder edited the office announcement';
end $tests$;
rollback;
select 'PASS: direct office, barangay, and administrator publishing; future scheduling is covered by announcement_delivery.sql; scope, author, image staging, resident visibility, and notifications; all fixtures rolled back' as result;
