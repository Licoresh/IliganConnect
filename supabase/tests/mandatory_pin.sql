-- All fixture/schema changes roll back; no Storage or external writes.
begin;
set local statement_timeout='30s';
do $tests$
declare
  resident uuid:=gen_random_uuid(); pin_id uuid:=gen_random_uuid(); gps_id uuid:=gen_random_uuid();
  area uuid; category uuid; problem text; bad record; denied boolean; checked integer:=0;
begin
  select id into area from public.barangays where name='Poblacion';
  select c.id,p.code into category,problem from public.report_categories c join public.report_problem_types p on p.category_id=c.id
    where c.active and p.code<>'other' order by c.name,p.sort_order limit 1;
  assert area is not null and category is not null,'Pin test reference data missing';
  insert into auth.users(id,email) values(resident,resident::text||'@example.invalid');
  perform set_config('request.jwt.claim.sub',resident::text,true);
  set local role authenticated;
  perform public.submit_report(pin_id,category,area,'Rollback required pin','A transaction-only report with a map pin and optional blank address fields.',
    8.22947578,124.23688253,'',problem,null,null,null,'pin');
  assert exists(select 1 from public.reports where id=pin_id and purok is null and zone is null and landmark='' and location is not null),
    'Map pin should suffice when Purok/Zone are unknown';
  perform public.submit_report(gps_id,category,area,'Rollback required GPS','A transaction-only GPS report with optional blank address fields.',
    8.22947578,124.23688253,'',problem,null,null,null,'gps',12.5,'Poblacion, Iligan City');
  assert exists(select 1 from public.reports where id=gps_id and location_accuracy=12.5 and location is not null),
    'GPS location without Purok/Zone was rejected';
  for bad in select * from (values
    (null::float8,null::float8,'manual'::text),(null,null,'gps'),(null,null,'pin'),
    (8.22947578,null,'manual'),(null,124.23688253,'coordinates'),
    ('NaN'::float8,124.23688253,'pin'),('Infinity'::float8,124.23688253,'gps'),
    (91,124.23688253,'pin'),(8.22947578,181,'pin'),(0,0,'pin')
  ) inputs(lat,lon,source) loop
    denied:=false;
    begin
      perform public.submit_report(gen_random_uuid(),category,area,'Rollback missing pin','A transaction-only report with full address text but an invalid map pin.',
        bad.lat,bad.lon,'Beside the covered court',problem,null,'Purok 3','Zone 2',bad.source);
    exception when check_violation then denied:=true;
      when raise_exception then
        if sqlerrm like 'This pin is outside%' then denied:=true;else raise;end if;
    end;
    assert denied,'Address text bypassed the mandatory pin';checked:=checked+1;
  end loop;
  assert checked=10,'Mandatory pin invalid-input count changed';
  denied:=false;
  begin
    insert into public.reports(category_id,barangay_id,title,description,latitude,longitude,landmark,problem_type,purok,zone,location_source)
    values(category,area,'Rollback direct address','A transaction-only direct insert that must not bypass the required pin.',null,null,
      'Beside the covered court',problem,'Purok 3','Zone 2','manual');
  exception when check_violation then denied:=true;end;
  assert denied,'Direct INSERT bypassed the mandatory pin';
  reset role;
  denied:=false;
  begin update public.reports set latitude=null,longitude=null,location_source='manual' where id=pin_id;
  exception when check_violation then denied:=true;end;
  assert denied,'Coordinate edit removed a report pin';
  assert exists(select 1 from pg_trigger t where t.tgrelid='public.reports'::regclass and t.tgname='report_city_boundary'
    and pg_get_triggerdef(t.oid) like '%INSERT OR UPDATE OF latitude, longitude%'),
    'Pin trigger must protect inserts/coordinate edits without blocking historical status updates';
  assert not exists(select 1 from pg_constraint where conrelid='public.reports'::regclass and conname='reports_manual_location_details'),
    'Purok/Zone must remain optional';
  raise notice 'PASS: required pin/GPS, optional address, 10 invalid RPC values, direct insert/edit guards';
end $tests$;
rollback;
select 'PASS: mandatory pin checks completed; all fixtures rolled back' as result;
