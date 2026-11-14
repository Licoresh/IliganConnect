begin;
set local statement_timeout='30s';
do $tests$
declare
  barangay_staff uuid:=gen_random_uuid(); peer_staff uuid:=gen_random_uuid();
  office_staff uuid:=gen_random_uuid(); resident uuid:=gen_random_uuid();
  area uuid; other_area uuid; category uuid; problem text; org uuid:=gen_random_uuid(); walk_id uuid:=gen_random_uuid();
  start_point extensions.geometry; corrected_point extensions.geometry; outside_point extensions.geometry; rows jsonb; denied boolean;
begin
  select id,boundary into strict area,start_point from public.barangays where name='Tibanga';
  select id into strict other_area from public.barangays where name='Poblacion';
  select c.id,p.code into strict category,problem from public.report_categories c
    join public.report_problem_types p on p.category_id=c.id
    where c.active and p.code<>'other' order by c.name,p.sort_order limit 1;
  start_point:=extensions.st_pointonsurface(start_point);
  corrected_point:=extensions.st_pointn(extensions.st_exteriorring(extensions.st_geometryn((select boundary from public.barangays where id=area),1)),5);
  outside_point:=extensions.st_pointonsurface((select boundary from public.barangays where id=other_area));
  assert start_point is not null and corrected_point is not null and not extensions.st_equals(start_point,corrected_point),
    'Rollback walk-in test needs two boundary points';

  insert into auth.users(id,email) values
    (barangay_staff,barangay_staff::text||'@example.invalid'),
    (peer_staff,peer_staff::text||'@example.invalid'),
    (office_staff,office_staff::text||'@example.invalid'),
    (resident,resident::text||'@example.invalid');
  update public.profiles set role='barangay',barangay_id=area,display_name='Walk-in reviewer',notifications_enabled=true where id=barangay_staff;
  update public.profiles set role='barangay',barangay_id=area,display_name='Walk-in peer',notifications_enabled=true where id=peer_staff;
  update public.profiles set role='office',display_name='Walk-in office',notifications_enabled=true where id=office_staff;
  update public.profiles set role='resident',barangay_id=area,display_name='Resident account' where id=resident;
  insert into public.organizations(id,name,active) values(org,'Rollback walk-in routing office',true);
  insert into public.organization_memberships(user_id,organization_id) values(office_staff,org);
  insert into public.organization_access_rules(organization_id,category_id,barangay_id,assignment_only,can_review,can_update,can_refer,enabled)
    values(org,category,area,true,false,true,false,true);

  perform set_config('request.jwt.claim.sub',barangay_staff::text,true);
  set local role authenticated;
  perform public.submit_walk_in_report(walk_id,category,area,'Walk-in reporter','+639171234567',
    'Broken streetlight reported at the office','A resident visited the barangay office to report a broken streetlight near the access road.',
    extensions.st_y(start_point),extensions.st_x(start_point),'Near the covered court',problem,null,'Purok 2','Zone 1');
  assert (select resident_id is null and submission_source='walk_in' and created_by=barangay_staff
    and status='submitted' and organization_id is null and severity is null and urgency is null and not is_demo
    from public.reports where id=walk_id),'Walk-in report did not enter the normal needs-review state';
  rows:=public.report_residents(array[walk_id],true);
  assert rows->0->>'resident_name'='Walk-in reporter' and rows->0->>'reporter_contact'='+639171234567'
    and rows->0->>'created_by_name'='Walk-in reviewer','Authorized staff cannot see walk-in reporter details and intake actor';
  assert not ((select to_jsonb(r) from public.reports r where r.id=walk_id) ? 'reporter_contact'),
    'Walk-in contact leaked onto the broad report row';
  denied:=false;
  begin perform reporter_name from private.walk_in_reporter_details d where d.report_id=walk_id;
    exception when insufficient_privilege then denied:=true; end;
  assert denied,'Authenticated staff can bypass the scoped reporter lookup';
  reset role;
  assert not exists(select 1 from public.email_outbox where report_id=walk_id and event_key='report_received'),
    'Walk-in report incorrectly queued an account email';
  assert exists(select 1 from public.notifications where user_id=peer_staff and report_id=walk_id
    and title='A new report was submitted in your barangay'),'Barangay peer was not notified of the in-person report';

  perform set_config('request.jwt.claim.sub',resident::text,true);
  set local role authenticated;
  denied:=false;
  begin
    perform public.submit_walk_in_report(gen_random_uuid(),category,area,'Impersonated reporter',null,
      'Unauthorized walk-in report','A resident account must not be able to use the staff walk-in intake path.',
      extensions.st_y(start_point),extensions.st_x(start_point),'',problem,null,'','');
  exception when others then denied:=true; end;
  assert denied,'Resident could submit through the staff walk-in RPC';
  reset role;

  perform set_config('request.jwt.claim.sub',barangay_staff::text,true);
  set local role authenticated;
  denied:=false;
  begin
    perform public.submit_walk_in_report(gen_random_uuid(),category,other_area,'Wrong-area reporter',null,
      'Wrong barangay report','A staff member must only record reports for the barangay assigned to their account.',
      extensions.st_y(start_point),extensions.st_x(start_point),'',problem,null,'','');
  exception when others then denied:=true; end;
  assert denied,'Barangay staff could record a walk-in report in another barangay';

  perform public.change_report(walk_id,'under_review','Barangay staff reviewed the walk-in report.');
  perform public.change_report(walk_id,'verified','Severity and urgency confirmed after review.',null,3,null,null,2);
  perform public.update_walk_in_report_location(walk_id,extensions.st_y(corrected_point),extensions.st_x(corrected_point));
  denied:=false;
  begin perform public.update_walk_in_report_location(walk_id,extensions.st_y(outside_point),extensions.st_x(outside_point));
    exception when check_violation then denied:=true; end;
  assert denied,'A correction outside the report barangay was accepted';
  perform public.change_report(walk_id,'assigned','The responsible office will inspect and coordinate the repair.',org);
  assert (select status='assigned' and organization_id=org and resident_id is null from public.reports where id=walk_id),
    'Walk-in report did not use the standard barangay review and office routing workflow';
  reset role;

  perform set_config('request.jwt.claim.sub',office_staff::text,true);
  set local role authenticated;
  assert (select count(*)=1 from public.reports where id=walk_id),'Assigned office cannot access the walk-in report';
  rows:=public.report_residents(array[walk_id],true);
  assert rows->0->>'resident_name'='Walk-in reporter' and rows->0->>'reporter_contact'='+639171234567',
    'Assigned office reporter lookup did not preserve scope and contact authorization';
  denied:=false;
  begin perform public.update_walk_in_report_location(walk_id,extensions.st_y(corrected_point),extensions.st_x(corrected_point));
    exception when others then denied:=true; end;
  assert denied,'Office staff could change the walk-in pin';
  reset role;

  perform set_config('request.jwt.claim.sub',barangay_staff::text,true);
  set local role authenticated;
  assert (select latitude=extensions.st_y(corrected_point) and longitude=extensions.st_x(corrected_point)
    and location_source='pin' from public.reports where id=walk_id),'Barangay could not correct the pin after an on-site visit';
  rows:=public.report_action_history(walk_id);
  assert exists(select 1 from jsonb_array_elements(rows) event where event->>'action_kind'='location_update'
    and event->>'actor_name'='Walk-in reviewer'),'On-site pin correction is missing from the case timeline';
  denied:=false;
  begin perform public.update_walk_in_report_location(walk_id,extensions.st_y(outside_point),extensions.st_x(outside_point));
    exception when insufficient_privilege then denied:=true; end;
  assert denied,'Barangay staff changed the pin after forwarding the report';
  raise notice 'PASS: walk-in intake, private reporter details, barangay scope, peer notification, standard review/routing, office access and on-site pin audit';
end $tests$;
rollback;
select 'PASS: walk-in reports and pin-correction fixtures rolled back' result;
