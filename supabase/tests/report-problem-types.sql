-- Creates isolated users; all accounts, submissions and audit rows roll back.
begin;
do $$declare resident uuid:=gen_random_uuid(); administrator uuid:=gen_random_uuid(); begin
  insert into auth.users(id,email) values(resident,resident::text||'@example.invalid'),(administrator,administrator::text||'@example.invalid');
  update public.profiles set role='admin',account_status='active' where id=administrator;
  perform set_config('test.resident',resident::text,true);
  perform set_config('test.admin',administrator::text,true);
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.resident'), true);
set local role authenticated;
do $$declare c record; problem text; report_id uuid; b uuid; n integer:=0; begin
  select id into strict b from public.barangays order by name limit 1;
  for c in select * from public.report_categories where active loop
    select code into strict problem from public.report_problem_types where category_id=c.id and code<>'other' order by sort_order limit 1;
    report_id:=gen_random_uuid();
    perform public.submit_report(report_id,c.id,b,'[TEST] Category subtype','Synthetic subtype validation; rolled back after verification.',8.228,124.2452,'',problem,null);
    perform public.submit_report(report_id,c.id,b,'[TEST] Category subtype','Synthetic subtype validation; rolled back after verification.',8.228,124.2452,'',problem,null);
    if (select count(*) from public.reports where id=report_id and problem_type=problem and problem_other is null)<>1 then raise exception 'Predefined subtype or retry failed'; end if;
    report_id:=gen_random_uuid();
    perform public.submit_report(report_id,c.id,b,'[TEST] Other subtype','Synthetic subtype validation; rolled back after verification.',8.228,124.2452,'','other','  Unlisted problem  ');
    if not exists(select 1 from public.reports where id=report_id and problem_type='other' and problem_other='Unlisted problem') then raise exception 'Others persistence failed'; end if;
    begin
      perform public.submit_report(gen_random_uuid(),c.id,b,'[TEST] Missing subtype','Synthetic negative test; never retained.',8.228,124.2452);
      raise exception 'Missing subtype accepted';
    exception when check_violation then null; end;
    begin
      perform public.submit_report(gen_random_uuid(),c.id,b,'[TEST] Empty custom','Synthetic negative test; never retained.',8.228,124.2452,'','other','   ');
      raise exception 'Empty Others accepted';
    exception when check_violation then null; end;
    begin
      perform public.submit_report(gen_random_uuid(),c.id,b,'[TEST] Stale custom','Synthetic negative test; never retained.',8.228,124.2452,'',problem,'Stale custom text');
      raise exception 'Stale custom accepted';
    exception when check_violation then null; end;
    begin
      perform public.submit_report(gen_random_uuid(),c.id,b,'[TEST] Wrong category','Synthetic negative test; never retained.',8.228,124.2452,'',(select code from public.report_problem_types where category_id<>c.id and code<>'other' and code not in(select code from public.report_problem_types where category_id=c.id) limit 1),null);
      raise exception 'Cross-category subtype accepted';
    exception when foreign_key_violation then null; end;
    n:=n+1;
  end loop;
  if n<>6 then raise exception 'Expected six categories, got %',n; end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.admin'), true);
do $$begin
  if (select count(*) from public.reports where title in('[TEST] Category subtype','[TEST] Other subtype') and problem_type is not null)<>12 then raise exception 'Authorized staff cannot read subtype submissions'; end if;
end $$;
rollback;
select 'PASS: six categories, predefined and Others persistence, retry, required fields, category matching, staff visibility; all test data rolled back' as result;
