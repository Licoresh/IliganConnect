-- Every account, report, assessment, audit and notification rolls back.
begin;
set local statement_timeout='30s';
do $tests$
declare
  resident uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
  officer uuid:=gen_random_uuid(); administrator uuid:=gen_random_uuid(); disabled_staff uuid:=gen_random_uuid();
  office_id uuid:=gen_random_uuid(); v_report_id uuid:=gen_random_uuid(); sample_id uuid:=gen_random_uuid();
  area uuid; other_area uuid; category uuid; problem text; denied boolean; bad record; actor uuid;
  state public.report_status; row_count integer; snapshot jsonb;
begin
  select id into area from public.barangays where name='Poblacion';
  select id into other_area from public.barangays where id<>area order by name limit 1;
  select c.id,p.code into category,problem from public.report_categories c join public.report_problem_types p on p.category_id=c.id
    where c.active and p.code<>'other' order by c.name,p.sort_order limit 1;
  insert into auth.users(id,email) select id,id::text||'@example.invalid'
    from unnest(array[resident,reviewer,stranger,officer,administrator,disabled_staff]) f(id);
  update public.profiles set role='barangay',barangay_id=area where id in(reviewer,disabled_staff);
  update public.profiles set account_status='disabled' where id=disabled_staff;
  update public.profiles set role='barangay',barangay_id=other_area where id=stranger;
  update public.profiles set role='admin' where id=administrator;
  update public.profiles set role='office' where id=officer;
  insert into public.organizations(id,name,active) values(office_id,'Rollback assessment office '||left(office_id::text,8),true);
  insert into public.organization_memberships(user_id,organization_id) values(officer,office_id);
  insert into public.organization_access_rules(organization_id,category_id,barangay_id,assignment_only,can_review,can_update,enabled)
    values(office_id,category,area,true,false,true,true);
  perform set_config('request.jwt.claim.sub',resident::text,true);
  set local role authenticated;
  perform public.submit_report(v_report_id,category,area,'Rollback impact assessment','A rollback-only fixture for official severity and urgency assessment.',8.22947578,124.23688253,'',problem);
  assert exists(select 1 from public.reports where id=v_report_id and severity is null and urgency is null),'New report acquired invented official ratings';
  denied:=false;
  begin
    insert into public.reports(category_id,barangay_id,title,description,latitude,longitude,problem_type,urgency)
      values(category,area,'Rollback spoofed urgency','A rollback-only resident insert cannot choose official urgency.',8.22947578,124.23688253,problem,5);
  exception when insufficient_privilege then denied:=true;end;
  assert denied,'Resident supplied official urgency';
  denied:=false;
  begin perform public.record_report_assessment(v_report_id,5,5,'Resident must not assess this concern');
  exception when insufficient_privilege then denied:=true;end;
  assert denied,'Resident assessed report';
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  denied:=false;
  begin perform public.record_report_assessment(v_report_id,2,3,'Submitted case must enter review first');
  exception when check_violation then denied:=true;end;
  assert denied,'Submitted report assessed before review';
  perform public.change_report(v_report_id,'under_review','Begin review of the reported impact');
  for bad in select * from (values
    (null::integer,2::integer,'Missing impact rating'::text),(2,null,'Missing urgency rating'),
    (0,2,'Invalid low impact'),(6,2,'Invalid high impact'),(2,0,'Invalid low urgency'),(2,6,'Invalid high urgency'),
    (2,2,''),(2,2,repeat(U&'\200B',8)),(2,2,repeat('x',4001)),(2,2,E'Invalid\001control')
  ) f(severity,urgency,note) loop
    denied:=false;
    begin perform public.record_report_assessment(v_report_id,bad.severity,bad.urgency,bad.note);
    exception when check_violation then denied:=true;end;
    assert denied,'Invalid assessment accepted';
  end loop;
  denied:=false;
  begin perform public.change_report(v_report_id,'verified','Missing urgency must not verify',null,3);
  exception when check_violation then denied:=true;end;
  assert denied and exists(select 1 from public.reports where id=v_report_id and status='under_review' and severity is null),
    'Failed verification was not atomic';
  perform public.record_report_assessment(v_report_id,2,4,'  Limited disruption needs prompt coordination.  ');
  assert exists(select 1 from public.reports where id=v_report_id and severity=2 and urgency=4 and status='under_review'),'Assessment changed status or lost ratings';
  assert exists(select 1 from public.report_assessments a where a.report_id=v_report_id and actor_id=reviewer and note='Limited disruption needs prompt coordination.'),'History lost actor or rationale';
  perform public.change_report(v_report_id,'verified','Verified physical impact and time sensitivity',null,3,null,null,4);
  assert exists(select 1 from public.reports where id=v_report_id and severity=3 and urgency=4 and status='verified'),'Verification lost assessment';
  assert (select count(*) from public.report_assessments a where a.report_id=v_report_id)=2,'Verification assessment history missing';
  reset role;
  update public.reports set organization_id=office_id,status='assigned' where id=v_report_id;
  perform set_config('request.jwt.claim.sub',officer::text,true);
  set local role authenticated;
  assert (select count(*) from public.report_assessments a where a.report_id=v_report_id)=2,'Assigned progress office cannot read scoped history';
  denied:=false;
  begin perform public.record_report_assessment(v_report_id,5,5,'Progress-only staff cannot change assessments');
  exception when insufficient_privilege then denied:=true;end;
  assert denied,'Progress permission allowed assessment';
  denied:=false;
  begin perform public.change_report(v_report_id,'in_progress','Progress call cannot change official urgency',null,null,null,null,5);
  exception when check_violation then denied:=true;end;
  assert denied,'Progress call changed urgency';
  reset role;
  update public.organization_access_rules set can_review=true where organization_id=office_id;
  set local role authenticated;
  perform public.record_report_assessment(v_report_id,4,3,'Authorized assigned reviewer updated the evidence');
  assert (select count(*) from public.report_assessments a where a.report_id=v_report_id)=3,'Reassessment replaced history';
  foreach actor in array array[resident,stranger,disabled_staff] loop
    perform set_config('request.jwt.claim.sub',actor::text,true);
    assert not exists(select 1 from public.report_assessments a where a.report_id=v_report_id),'History leaked outside staff scope';
    denied:=false;
    begin perform public.record_report_assessment(v_report_id,1,1,'Unauthorized assessment attempt');
    exception when insufficient_privilege then denied:=true;end;
    assert denied,'Unauthorized actor assessed report';
  end loop;
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  assert (select count(*) from public.report_assessments a where a.report_id=v_report_id)=3,'Admin cannot read staff history';
  denied:=false;
  begin insert into public.report_assessments(report_id,actor_id,severity,urgency,note) values(v_report_id,administrator,1,1,'Direct history insert forbidden');
  exception when insufficient_privilege then denied:=true;end;
  assert denied,'Direct history insert accepted';
  assert not has_table_privilege('authenticated','public.report_assessments','UPDATE')
    and not has_table_privilege('authenticated','public.report_assessments','DELETE'),'Assessment history is mutable';
  reset role;
  foreach state in array array['resolved','rejected','duplicate']::public.report_status[] loop
    update public.reports set status=state where id=v_report_id;
    set local role authenticated;
    denied:=false;
    begin perform public.record_report_assessment(v_report_id,2,2,'Closed or linked report cannot be assessed');
    exception when check_violation then denied:=true;end;
    assert denied,'Closed or linked report assessed';
    reset role;
  end loop;
  update public.reports set status='verified',public_visible=true,public_summary='Public rollback assessment summary' where id=v_report_id;
  insert into public.reports(id,resident_id,category_id,barangay_id,title,description,latitude,longitude,problem_type,status,is_demo)
    values(sample_id,resident,category,area,'Rollback hidden assessment','A rollback-only presentation-cohort visibility fixture.',8.22947578,124.23688253,problem,'under_review',true);
  update public.analytics_settings set include_samples=true;
  set local role authenticated;
  perform public.record_report_assessment(sample_id,1,1,'Visible presentation report can be assessed');
  reset role;
  update public.analytics_settings set include_samples=false;
  set local role authenticated;
  assert not exists(select 1 from public.report_assessments a where a.report_id=sample_id),'Hidden sample history leaked';
  denied:=false;
  begin perform public.record_report_assessment(sample_id,2,2,'Hidden sample cannot be assessed');
  exception when insufficient_privilege then denied:=true;end;
  assert denied,'Hidden sample assessment allowed';
  perform set_config('request.jwt.claim.sub',resident::text,true);
  select to_jsonb(p) into snapshot from public.public_report_by_id(v_report_id) p;
  assert snapshot is not null and not (snapshot ?| array['urgency','severity','note','actor_id']),'Public projection leaked private assessment';
  reset role;
  assert not has_function_privilege('anon','public.record_report_assessment(uuid,integer,integer,text)','EXECUTE'),'Anonymous assessment RPC is callable';
  assert not has_function_privilege('anon','private.record_report_assessment(uuid,integer,integer,text)','EXECUTE'),'Anonymous private assessment function is callable';
  assert (select count(*) from public.report_assessments a where a.report_id=v_report_id)=3,'Denied mutations changed history';
  raise notice 'PASS: atomic verification/reassessment, required ratings, append-only history, role/scope/sample privacy and spoof guards';
end $tests$;
rollback;
select 'PASS: report assessment fixtures rolled back' result;
