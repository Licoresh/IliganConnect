-- Uses the active office configuration and rolls back all test records.
begin;
set local statement_timeout='45s';
do $qa$
declare area uuid; brgy uuid; resident uuid; agency record; category record; req uuid; case_id uuid; denied boolean;
begin
 select id into strict area from public.barangays where name='Tibanga';
 select id into brgy from public.profiles where role='barangay' and barangay_id=area and account_status='active' limit 1;
 resident := gen_random_uuid();
 insert into auth.users(id,email) values(resident,resident||'@example.invalid');
 update public.profiles set barangay_id=area where id=resident;
 for agency in select o.id,o.name,(select p.id from public.profiles p join public.organization_memberships m on m.user_id=p.id where m.organization_id=o.id and p.role='office' and p.account_status='active' limit 1) actor
               from public.organizations o where o.active and (o.can_coordinate or o.can_consult) order by o.name
 loop
   perform set_config('request.jwt.claim.sub',resident::text,true);
   set local role authenticated;
   if req is null then req:=public.submit_meeting_request('Rollback-only Tibanga office coordination','Temporary request for office coordination and authorization tests.',area); end if;
   perform set_config('request.jwt.claim.sub',brgy::text,true);
   perform public.invite_meeting_office(req,agency.id);
   perform set_config('request.jwt.claim.sub',agency.actor::text,true);
   perform public.respond_meeting_office_invitation(req,agency.id,agency.name<>'CDRRMO','Rollback-only availability response');
   assert exists(select 1 from public.meeting_request_offices where request_id=req and organization_id=agency.id and status=case when agency.name='CDRRMO' then 'declined' else 'accepted' end),'Office reply was not recorded';
   reset role;
   for category in select distinct a.category_id id,(select t.code from public.report_problem_types t where t.category_id=a.category_id and t.code<>'other' order by t.sort_order limit 1) problem
                   from public.organization_access_rules a where a.organization_id=agency.id and a.enabled and a.can_update and (a.barangay_id is null or a.barangay_id=area)
   loop
     case_id:=gen_random_uuid();
     perform set_config('request.jwt.claim.sub',brgy::text,true);
     set local role authenticated;
     perform public.submit_walk_in_report(case_id,category.id,area,'QA only resident',null,'Rollback-only Tibanga report','Temporary test report for the assigned office workflow.',8.23981778650005,124.242351087979,'',category.problem,null,'Purok 1','Zone 1');
     perform public.change_report(case_id,'under_review','Barangay reviewed the rollback-only report.');
     perform public.change_report(case_id,'verified','Barangay confirmed the rollback-only report.',null,2,p_urgency=>2);
     perform public.change_report(case_id,'assigned','Barangay forwarded the rollback-only report.',agency.id);
     denied:=false;
     begin perform public.change_report(case_id,'scheduled','Barangay cannot schedule a forwarded report.',p_scheduled_at=>now()+interval '1 day'); exception when insufficient_privilege then denied:=true; end;
     assert denied,'Barangay kept write access after handoff';
     perform set_config('request.jwt.claim.sub',agency.actor::text,true);
     perform public.change_report(case_id,'scheduled','Office scheduled the rollback-only case.',p_scheduled_at=>now()+interval '1 day');
     reset role;
     update public.reports set scheduled_at=now()-interval '1 day' where id=case_id;
     set local role authenticated;
     perform public.change_report(case_id,'in_progress','Office began the rollback-only work.');
     perform public.change_report(case_id,'resolved','Office completed the rollback-only work.');
     assert exists(select 1 from public.reports where id=case_id and status='resolved'),'Assigned office could not resolve the case';
     reset role;
   end loop;
 end loop;
end $qa$;
rollback;
select 'PASS: all six active offices, invitation replies, every assigned update category, scheduling, completion and Tibanga handoff' result;
