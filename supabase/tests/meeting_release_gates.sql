-- Rollback-only coverage for office approval gating and completed meeting locks.
begin;
set local statement_timeout = '30s';
do $tests$
declare
  v_resident_id uuid := gen_random_uuid();
  v_barangay_id uuid;
  v_barangay_staff_id uuid := gen_random_uuid();
  v_office_user_id uuid := gen_random_uuid();
  v_category_id uuid;
  v_organization_id uuid;
  v_request_id uuid;
  v_meeting_id uuid;
  v_visible_count integer;
  v_office_notice_count integer;
  v_rejected boolean;
begin
  select b.id into strict v_barangay_id from public.barangays b where b.name = 'Tibanga';
  select c.id into strict v_category_id from public.report_categories c where c.active order by c.name limit 1;
  select o.id into strict v_organization_id from public.organizations o
   where o.active and o.can_coordinate order by o.name limit 1;

  insert into auth.users(id,email) values
    (v_resident_id,v_resident_id::text || '@example.invalid'),
    (v_barangay_staff_id,v_barangay_staff_id::text || '@example.invalid'),
    (v_office_user_id,v_office_user_id::text || '@example.invalid');
  update public.profiles p set role='resident', account_status='active', barangay_id=v_barangay_id
   where p.id=v_resident_id;
  update public.profiles p set role='barangay', account_status='active', barangay_id=v_barangay_id
   where p.id=v_barangay_staff_id;
  update public.profiles p set role='office', account_status='active', notifications_enabled=true
   where p.id=v_office_user_id;
  insert into public.organization_memberships(user_id,organization_id)
   values(v_office_user_id,v_organization_id);

  perform set_config('request.jwt.claim.sub',v_resident_id::text,true);
  set local role authenticated;
  v_request_id := public.submit_meeting_request(
    'Rollback-only office invitation gate',
    'Temporary test for barangay approval before office participation.',
    v_barangay_id,v_category_id,null,'{}'::uuid[]
  );
  reset role;

  perform set_config('request.jwt.claim.sub',v_barangay_staff_id::text,true);
  set local role authenticated;
  perform public.invite_meeting_office(v_request_id,v_organization_id);
  reset role;
  select count(*) into v_office_notice_count from public.notifications n
   where n.user_id=v_office_user_id and n.meeting_request_id=v_request_id;
  assert v_office_notice_count=0,'Office was notified before barangay approval';

  perform set_config('request.jwt.claim.sub',v_office_user_id::text,true);
  set local role authenticated;
  assert not private.meeting_request_office_read_access(v_request_id,v_organization_id),
    'Office invitation read helper exposed a pending request';
  assert not private.meeting_invited_office_access(v_request_id),
    'Office invitation access helper exposed a pending request';
  select count(*) into v_visible_count from public.meeting_requests r where r.id=v_request_id;
  assert v_visible_count=0,'Office can see a meeting request before barangay approval';
  select count(*) into v_visible_count from public.meeting_request_offices i
   where i.request_id=v_request_id and i.organization_id=v_organization_id;
  assert v_visible_count=0,'Office can see its invitation before barangay approval';
  v_rejected := false;
  begin
    perform public.respond_meeting_office_invitation(v_request_id,v_organization_id,true,'Blocked before approval');
  exception
    when insufficient_privilege then v_rejected := true;
    when check_violation then v_rejected := true;
  end;
  assert v_rejected,'Office responded before barangay approval';
  reset role;

  perform set_config('request.jwt.claim.sub',v_barangay_staff_id::text,true);
  set local role authenticated;
  update public.meeting_requests r set status='approved',decision_reason='Rollback-only approval'
   where r.id=v_request_id;
  reset role;
  select count(*) into v_office_notice_count from public.notifications n
   where n.user_id=v_office_user_id and n.meeting_request_id=v_request_id
     and n.title='You are invited to a community meeting';
  assert v_office_notice_count=1,'Approved pending office was not notified exactly once';

  perform set_config('request.jwt.claim.sub',v_office_user_id::text,true);
  set local role authenticated;
  assert private.meeting_request_office_read_access(v_request_id,v_organization_id),
    'Office cannot read its invitation after barangay approval';
  assert private.meeting_invited_office_access(v_request_id),
    'Office access helper did not open after barangay approval';
  select count(*) into v_visible_count from public.meeting_requests r where r.id=v_request_id;
  assert v_visible_count=1,'Office cannot see approved invited meeting';
  perform public.respond_meeting_office_invitation(v_request_id,v_organization_id,true,'Rollback-only acceptance');
  select count(*) into v_visible_count from public.meeting_request_offices i
   where i.request_id=v_request_id and i.organization_id=v_organization_id and i.status='accepted';
  assert v_visible_count=1,'Office response was not recorded after approval';
  reset role;

  perform set_config('request.jwt.claim.sub',v_barangay_staff_id::text,true);
  set local role authenticated;
  insert into public.meetings(request_id,starts_at,ends_at,venue)
  values(v_request_id,now()+interval '1 day',now()+interval '1 day 90 minutes','Rollback-only venue')
  returning id into v_meeting_id;
  update public.meetings m set outcome='Editable before completion' where m.id=v_meeting_id;
  update public.meetings m set completed=true,outcome='Completed test meeting' where m.id=v_meeting_id;

  v_rejected := false;
  begin
    update public.meeting_requests r set decision_reason='Attempt after completion' where r.id=v_request_id;
  exception when check_violation then v_rejected := true;
  end;
  assert v_rejected,'Completed meeting request could still be changed';
  v_rejected := false;
  begin
    update public.meetings m set outcome='Attempt after completion' where m.id=v_meeting_id;
  exception when check_violation then v_rejected := true;
  end;
  assert v_rejected,'Completed meeting schedule could still be changed';

  select count(*) into v_visible_count from public.meetings m where m.id=v_meeting_id and m.completed;
  assert v_visible_count=1,'Completed meeting is no longer readable to its barangay';
  reset role;
end
$tests$;
rollback;
select 'PASS: office approval gate, notification/response, editable schedule, and completed-meeting write guards' as result;
