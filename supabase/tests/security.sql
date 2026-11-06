-- Run after migrations + seed using: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
-- Transaction rolls back all test fixtures. Uses actual authenticated JWT context and RLS.
begin;
insert into auth.users(id,email) values('10000000-0000-4000-8000-000000000001','resident-one@example.invalid'),('10000000-0000-4000-8000-000000000002','resident-two@example.invalid'),('10000000-0000-4000-8000-000000000003','staff@example.invalid');
update public.profiles set role='barangay',barangay_id=(select id from public.barangays order by name limit 1) where id='10000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
insert into public.reports(id,category_id,problem_type,barangay_id,title,description,latitude,longitude) values('20000000-0000-4000-8000-000000000001',(select id from public.report_categories order by name limit 1),(select code from public.report_problem_types where category_id=(select id from public.report_categories order by name limit 1) order by sort_order limit 1),(select id from public.barangays order by name limit 1),'Test road concern','A synthetic concern used only for authorization verification.',8.228,124.245);
do $$begin
begin update public.profiles set role='admin' where id=auth.uid(); raise exception 'TEST FAILED: privilege escalation succeeded'; exception when insufficient_privilege then null; end;
begin perform public.change_report('20000000-0000-4000-8000-000000000001','verified','Unauthorized verification');raise exception 'TEST FAILED: resident verified report';exception when raise_exception then if sqlerrm<>'Not authorized' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$begin if exists(select 1 from public.reports where id='20000000-0000-4000-8000-000000000001') then raise exception 'TEST FAILED: another resident read private report';end if;end$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select public.change_report('20000000-0000-4000-8000-000000000001','under_review','Review started by authorized staff');
select public.change_report('20000000-0000-4000-8000-000000000001','verified','Issue independently assessed',null,2,p_urgency=>2);
do $$begin if not exists(select 1 from public.report_status_history where report_id='20000000-0000-4000-8000-000000000001' and new_status='verified') then raise exception 'TEST FAILED: missing immutable history';end if;end$$;
rollback;
