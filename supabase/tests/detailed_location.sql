-- Transaction-only fixtures; no Storage or external writes.
begin;
set local statement_timeout='30s';
do $tests$
declare
  resident uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); official uuid:=gen_random_uuid();
  outside_official uuid:=gen_random_uuid(); administrator uuid:=gen_random_uuid();
  manual_id uuid:=gen_random_uuid(); gps_id uuid:=gen_random_uuid(); legacy_id uuid:=gen_random_uuid();
  area uuid; other_area uuid; category uuid; problem text; snapshot jsonb; bad record; denied boolean; tests integer:=0;
begin
  select id into area from public.barangays where name='Poblacion';
  select id into other_area from public.barangays where id<>area order by name limit 1;
  select c.id,p.code into category,problem from public.report_categories c join public.report_problem_types p on p.category_id=c.id
    where c.active and p.code<>'other' order by c.name,p.sort_order limit 1;
  assert area is not null and category is not null,'Location test reference data missing';
  insert into auth.users(id,email) values
    (resident,resident::text||'@example.invalid'),(stranger,stranger::text||'@example.invalid'),
    (official,official::text||'@example.invalid'),(outside_official,outside_official::text||'@example.invalid'),
    (administrator,administrator::text||'@example.invalid');
  update public.profiles set role='barangay',barangay_id=area where id=official;
  update public.profiles set role='barangay',barangay_id=other_area where id=outside_official;
  update public.profiles set role='admin' where id=administrator;
  perform set_config('request.jwt.claim.sub',resident::text,true);
  set local role authenticated;
  perform public.submit_report(manual_id,category,area,'Rollback map directions','A transaction-only report with specific directions and a required map pin.',8.22947578,124.23688253,
    'Beside the covered court',problem,null,'  Purok 3  ','Zone 2','pin',null,null);
  assert exists(select 1 from public.reports where id=manual_id and purok='Purok 3' and zone='Zone 2'
    and landmark='Beside the covered court' and latitude=8.22947578 and longitude=124.23688253 and location is not null),'Written directions or required pin were lost';
  perform public.submit_report(gps_id,category,area,'Rollback GPS directions','A transaction-only report preserving GPS and written directions.',8.22947578,124.23688253,
    'Across from the clinic',problem,null,'Purok 4','Zone 1','gps',12.5,'Poblacion, Iligan City');
  assert exists(select 1 from public.reports where id=gps_id and location_source='gps' and location_accuracy=12.5
    and purok='Purok 4' and location_address='Poblacion, Iligan City' and latitude=8.22947578),'GPS or address metadata lost';
  perform public.submit_report(legacy_id,category,area,'Rollback legacy client','A transaction-only report using the previous RPC call shape.',8.22947578,124.23688253,'',problem);
  assert exists(select 1 from public.reports where id=legacy_id and location_source is null),'Legacy coordinate call rejected';
  -- Idempotent retries return the same report without replacing the saved location.
  perform public.submit_report(manual_id,category,area,'Rollback retry title','A transaction-only retry that must retain the first saved location.',null,null,
    'Different directions',problem,null,'Purok 9',null,'manual');
  assert exists(select 1 from public.reports where id=manual_id and purok='Purok 3'),'Retry replaced saved location';
  for bad in select * from (values
    (null::float8,null::float8,'manual'::text,''::text,''::text,''::text,null::float8,null::text),
    (8.22947578,null,'manual','Purok 3','','',null,null),
    (null,124.23688253,'gps','Purok 3','','',null,null),
    (null,null,'gps','','','Beside the clinic',null,null),
    (null,null,null,'Purok 3','','',null,null),
    (null,null,'manual',repeat('x',81),'','',null,null),
    (null,null,'manual','',repeat('x',81),'',null,null),
    (null,null,'manual',repeat(U&'\200B',5),'','',null,null),
    (null,null,'manual','Purok 3','','',5,null),
    (8.22947578,124.23688253,'gps','','','',-1,null),
    (8.22947578,124.23688253,'gps','','','','Infinity'::float8,null),
    (8.22947578,124.23688253,'gps','','','','NaN'::float8,null),
    (8.22947578,124.23688253,'gps','','','',null,repeat('x',501)),
    (8.22947578,124.23688253,'fake','','','',null,null),
    (0,0,'gps','','','',null,null)
  ) inputs(lat,lon,source,purok,zone,details,accuracy,address) loop
    denied:=false;
    begin
      perform public.submit_report(gen_random_uuid(),category,area,'Rollback invalid location','A transaction-only report that must fail location validation.',
        bad.lat,bad.lon,bad.details,problem,null,bad.purok,bad.zone,bad.source,bad.accuracy,bad.address);
    exception when check_violation then denied:=true;
      when raise_exception then
        if sqlerrm like 'This pin is outside%' then denied:=true;else raise;end if;
    end;
    assert denied,'Invalid location accepted';tests:=tests+1;
  end loop;
  assert tests=15,'Location invalid-value test count changed';
  perform set_config('request.jwt.claim.sub',stranger::text,true);
  assert not exists(select 1 from public.reports where id=manual_id),'Unrelated resident read a private address';
  perform set_config('request.jwt.claim.sub',outside_official::text,true);
  assert not exists(select 1 from public.reports where id=manual_id),'Unassigned barangay read a private address';
  perform set_config('request.jwt.claim.sub',official::text,true);
  assert exists(select 1 from public.reports where id=manual_id and purok='Purok 3'),'Assigned barangay cannot read directions';
  assert exists(select 1 from public.map_reports(124,8,125,9,barangay=>area) where id=manual_id),'Pinned report missing from scoped list';
  assert not exists(select 1 from public.map_reports(124,8,125,9,barangay=>other_area) where id=manual_id),'Manual report ignored barangay filter';
  assert exists(select 1 from public.map_barangay_counts(p_barangay=>area) where barangay_id=area and report_count>=3),'GIS counts excluded manual reports';
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  assert exists(select 1 from public.reports where id=gps_id and location_accuracy=12.5),'Administrator cannot read location';
  reset role;
  update public.reports set public_visible=true,public_summary='Published rollback location' where id=manual_id;
  perform set_config('request.jwt.claim.sub',stranger::text,true);
  set local role authenticated;
  select to_jsonb(p) into snapshot from public.public_report_by_id(manual_id) p;
  assert snapshot is not null and (snapshot->>'latitude')::float8=8.229 and (snapshot->>'longitude')::float8=124.237,'Public projection did not round coordinates';
  assert not (snapshot ?| array['purok','zone','landmark','location_address','location_accuracy','location_source','resident_id']),
    'Public projection exposed private address information';
  assert not exists(select 1 from public.reports where id=manual_id),'Public summary granted private report access';
  reset role;
  raise notice 'PASS: pin/GPS/legacy submissions, 15 invalid values, retry, scoped access, GIS counts and private projections';
end $tests$;
rollback;
select 'PASS: detailed location assertions completed; all fixtures rolled back' as result;
