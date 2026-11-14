-- Rollback-only fixtures. Run as database owner after the matching migration.
begin;
set local statement_timeout='30s';
do $tests$
declare
  resident uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); other_staff uuid:=gen_random_uuid();
  admin_id uuid:=gen_random_uuid(); officer uuid:=gen_random_uuid(); disabled_id uuid:=gen_random_uuid();
  area uuid; registered_area uuid; category uuid; problem text; org uuid:=gen_random_uuid();
  report_id uuid:=gen_random_uuid(); other_report uuid:=gen_random_uuid();
  photo uuid:=gen_random_uuid(); foreign_photo uuid:=gen_random_uuid();
  count_before bigint; denied boolean; info jsonb; rows jsonb;
begin
  select id into strict area from public.barangays where name='Poblacion';
  select id into strict registered_area from public.barangays where name='Tibanga';
  select id into category from public.report_categories where active order by id limit 1;
  select code into strict problem from public.report_problem_types where category_id=category and code<>'other' order by sort_order limit 1;
  insert into auth.users(id,email) values(resident,resident||'@example.test'),(reviewer,reviewer||'@example.test'),
    (other_staff,other_staff||'@example.test'),(admin_id,admin_id||'@example.test'),
    (officer,officer||'@example.test'),(disabled_id,disabled_id||'@example.test');
  insert into public.profiles(id,display_name,role,barangay_id,account_status) values
    (resident,'Workflow resident','resident',registered_area,'active'),
    (reviewer,'Local barangay reviewer','barangay',area,'active'),
    (other_staff,'Other barangay staff','barangay',registered_area,'active'),
    (admin_id,'Workflow administrator','admin',null,'active'),
    (officer,'Assigned office staff','office',null,'active'),
    (disabled_id,'Disabled administrator','admin',null,'disabled')
    on conflict(id) do update set display_name=excluded.display_name,role=excluded.role,
      barangay_id=excluded.barangay_id,account_status=excluded.account_status;
  insert into public.organizations(id,name,active) values(org,'Workflow test office',true);
  insert into public.organization_memberships values(officer,org);
  insert into public.organization_access_rules(organization_id,category_id,barangay_id,assignment_only,can_update,can_review,enabled)
    values(org,category,area,false,true,true,true);
  perform set_config('request.jwt.claim.sub',resident::text,true);
  update public.profiles set barangay_id=null where id=resident;
  denied:=false;
  begin
    insert into public.reports(resident_id,category_id,barangay_id,title,description,latitude,longitude,problem_type)
      values(resident,category,area,'Rollback incomplete profile','A rollback-only report with an incomplete resident profile.',8.22947578,124.23688253,problem);
  exception when check_violation then denied:=true; end;
  assert denied,'Unregistered resident barangay accepted';
  update public.profiles set barangay_id=registered_area where id=resident;
  insert into public.reports(id,resident_id,category_id,barangay_id,title,description,latitude,longitude,resident_barangay_id,problem_type)
    values(report_id,resident,category,area,'Rollback local concern','A rollback-only report for the connected local workflow.',8.22947578,124.23688253,area,problem),
      (other_report,resident,category,area,'Rollback referral concern','A rollback-only report for the connected office workflow.',8.22947578,124.23688253,area,problem);
  assert (select resident_barangay_id=registered_area from public.reports where id=report_id),'Resident snapshot accepted a spoofed value';
  set local role authenticated;
  denied:=false;
  begin perform public.report_residents(array[report_id],true); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Resident read staff resident-directory projection';
  denied:=false;
  begin perform public.admin_residents(); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Resident read admin directory';
  denied:=false;
  begin perform public.admin_update_resident(resident,'Changed',null,'name',30::smallint,area,null::text,'active',true,'Unauthorized resident edit');
    exception when insufficient_privilege then denied:=true; end;
  assert denied,'Resident used admin management';
  perform set_config('request.jwt.claim.sub',other_staff::text,true);
  assert public.report_residents(array[report_id],true)='[]'::jsonb,'Cross-jurisdiction reporter leaked';
  denied:=false;
  begin perform public.change_report(report_id,'under_review','Unauthorized cross-area acknowledgement'); exception when others then denied:=true; end;
  assert denied,'Cross-area report change accepted';
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  info:=public.report_residents(array[report_id],true)->0;
  assert info->>'resident_name'='Workflow resident' and (info->>'registered_barangay_id')::uuid=registered_area,'Reporter context missing';
  denied:=false;
  begin perform public.change_report(report_id,'in_progress','Cannot bypass review and verification'); exception when others then denied:=true; end;
  assert denied,'Submitted case bypassed review';
  perform public.change_report(report_id,'under_review','Report acknowledged and investigation started');
  denied:=false;
  begin perform public.assign_barangay_personnel(report_id,other_staff,'Wrong jurisdiction personnel'); exception when others then denied:=true; end;
  assert denied,'Wrong personnel jurisdiction accepted';
  perform public.assign_barangay_personnel(report_id,reviewer,'Assigned local investigator for field review');
  perform public.change_report(report_id,'verified','Impact and urgency assessed before local work',null,3,null,null,4);
  perform public.change_report(report_id,'scheduled','Barangay field work has been scheduled.',p_scheduled_at=>now()+interval '1 day');
  reset role;
  update public.reports set scheduled_at=((timezone('Asia/Manila',now())::date - 1)::timestamp at time zone 'Asia/Manila') where id=report_id;
  set local role authenticated;
  perform public.change_report(report_id,'in_progress','Barangay team begins the recorded intervention');
  reset role;
  assert (select status='in_progress' and organization_id is null and assigned_to=reviewer from public.reports where id=report_id),'Local work did not start';
  insert into public.report_attachments(id,report_id,owner_id,path) values
    (photo,report_id,reviewer,reviewer||'/'||report_id||'/rollback-proof.jpg'),
    (foreign_photo,other_report,reviewer,reviewer||'/'||other_report||'/rollback-proof.jpg');
  select count(*) into count_before from public.report_status_history;
  set local role authenticated;
  denied:=false;
  begin perform public.record_report_update(report_id,'Evidence from another case must be rejected',array[foreign_photo]); exception when others then denied:=true; end;
  assert denied,'Foreign report evidence accepted';
  reset role;
  assert (select count(*) from public.report_status_history)=count_before,'Failed evidence link left history behind';
  set local role authenticated;
  perform public.record_report_update(report_id,'Inspection completed and debris removed from the access',array[photo]);
  rows:=public.report_action_history(report_id);
  assert exists(select 1 from jsonb_array_elements(rows) h where h->>'action_kind'='progress_update'
    and h->>'actor_name'='Local barangay reviewer' and (h->>'attachment_count')::int=1),'Action provenance or evidence missing';
  perform public.change_report(report_id,'resolved','Intervention completed and the area checked');
  denied:=false;
  begin perform public.record_report_update(report_id,'Closed case update must be rejected'); exception when others then denied:=true; end;
  assert denied,'Closed case accepted progress update';
  perform public.change_report(report_id,'under_review','Reopened after a follow-up inspection request');
  perform set_config('request.jwt.claim.sub',officer::text,true);
  denied:=false;
  begin perform public.change_report(other_report,'verified','Office must wait for barangay review',null,2,null,null,3);
    exception when insufficient_privilege then denied:=true; end;
  assert denied,'Category office reviewed an unassigned new report before the barangay';
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  perform public.change_report(other_report,'assigned','Reviewed and forwarded because office expertise is required',org,2,null,null,3);
  reset role;
  assert (select status='assigned' and assigned_to is null and organization_id=org and severity=2 and urgency=3 and verified_at is not null
    from public.reports where id=other_report),'Review and office routing were not saved atomically';
  assert exists(select 1 from public.report_assessments a where a.report_id=other_report and a.actor_id=reviewer and a.severity=2 and a.urgency=3),
    'Direct office routing did not record the barangay assessment';
  set local role authenticated;
  rows:=public.report_action_history(other_report);
  assert exists(select 1 from jsonb_array_elements(rows) h where h->>'action_kind'='report_review'
    and h->>'actor_name'='Local barangay reviewer' and h->>'old_status'='submitted' and h->>'new_status'='assigned'),
    'Direct routing lost the review actor or review event';
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',officer::text,true);
  perform public.change_report(other_report,'scheduled','Office field work has been scheduled.',p_scheduled_at=>now()+interval '1 day');
  reset role;
  update public.reports set scheduled_at=((timezone('Asia/Manila',now())::date - 1)::timestamp at time zone 'Asia/Manila') where id=other_report;
  set local role authenticated;
  perform public.change_report(other_report,'in_progress','Receiving office has started its assessment');
  perform public.record_report_update(other_report,'Office inspection findings and planned corrective work');
  perform public.change_report(other_report,'resolved','Office corrective work and follow-up completed');
  perform set_config('request.jwt.claim.sub',resident::text,true);
  assert jsonb_array_length(public.report_action_history(other_report))>=4,'Resident cannot follow case actions';
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  info:=public.admin_residents(resident::text);
  assert (info->>'total')::int=1,'Admin email search did not find resident';
  denied:=false;
  begin perform public.admin_update_resident(officer,'Wrong',null,'role',30::smallint,area,null::text,'active',true,'Do not edit staff via resident manager'); exception when others then denied:=true; end;
  assert denied,'Resident manager modified office account';
  perform public.admin_update_resident(resident,'Updated',null,'resident',30::smallint,area,'+639171234567','active',false,'Registered address corrected by administrator');
  assert (select phone='+639171234567' from public.profiles where id=resident),'Resident contact was not updated';
  info:=public.report_residents(array[report_id],true)->0;
  assert info->>'resident_name'='Updated resident' and (info->>'registered_barangay_id')::uuid=area
    and (info->>'submission_barangay_id')::uuid=registered_area,'Profile update lost submission snapshot';
  perform public.admin_update_resident(resident,'Updated',null,'resident',30::smallint,area,'+639171234567','disabled',false,'Resident account deactivated for review');
  perform set_config('request.jwt.claim.sub',resident::text,true);
  denied:=false;
  begin perform public.report_action_history(report_id); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Disabled resident still read protected action history';
  perform set_config('request.jwt.claim.sub',disabled_id::text,true);
  denied:=false;
  begin perform public.admin_residents(); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Disabled admin retained resident directory access';
  reset role;
  assert not has_function_privilege('anon','public.admin_residents(text,uuid,text,text,int)','execute'),'Anonymous admin RPC granted';
  assert not has_column_privilege('authenticated','public.report_attachments','action_id','insert'),'Client can spoof evidence action';
  raise notice 'PASS: resident identity, local handling, office referral, action evidence, history, admin management and permission boundaries';
end $tests$;
rollback;
select 'PASS: resident identity, local handling, office referral, action evidence, history, admin management and permission boundaries; fixtures rolled back' as result;
