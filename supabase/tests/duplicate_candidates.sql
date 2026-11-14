-- Database-owner acceptance. Every fixture, notification, audit and setting rolls back.
begin;
set local statement_timeout='30s';
update public.analytics_settings set include_samples=false;

do $tests$
declare
  resident uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); outside_staff uuid:=gen_random_uuid();
  officer uuid:=gen_random_uuid(); administrator uuid:=gen_random_uuid(); pending_staff uuid:=gen_random_uuid(); disabled_staff uuid:=gen_random_uuid();
  office_id uuid:=gen_random_uuid(); b uuid; outside_b uuid; category uuid; other_category uuid;
  problem text; different_problem text; other_category_problem text;
  ids uuid[]; source_id uuid; close_id uuid; wording_id uuid; near_id uuid; far_id uuid; old_id uuid; future_id uuid;
  different_category_id uuid; different_problem_id uuid; rejected_id uuid; duplicate_id uuid; outside_id uuid;
  sample_source uuid; sample_match uuid; chained_id uuid; child_id uuid; other_source uuid; other_match uuid;
  actor uuid; denied boolean; before_status jsonb; history_count bigint; link_count bigint; notification_count bigint; ordered_ids uuid[]; repeat_ids uuid[];
  epoch timestamptz:='2020-01-15 12:00:00+00'; distance double precision;
begin
  select id into b from public.barangays where name='Poblacion';
  select id into outside_b from public.barangays where id<>b order by name limit 1;
  select c.id,p.code into category,problem from public.report_categories c join public.report_problem_types p on p.category_id=c.id
    where c.active and p.code<>'other' order by c.name,p.sort_order limit 1;
  select code into different_problem from public.report_problem_types where category_id=category and code not in(problem,'other') order by sort_order limit 1;
  select c.id,p.code into other_category,other_category_problem from public.report_categories c join public.report_problem_types p on p.category_id=c.id
    where c.active and c.id<>category and p.code<>'other' order by c.name,p.sort_order limit 1;
  assert b is not null and outside_b is not null and category is not null and different_problem is not null and other_category is not null,'Reference data missing';
  select array_agg(gen_random_uuid()) into ids from generate_series(1,18);
  source_id:=ids[1];close_id:=ids[2];wording_id:=ids[3];near_id:=ids[4];far_id:=ids[5];old_id:=ids[6];future_id:=ids[7];
  different_category_id:=ids[8];different_problem_id:=ids[9];rejected_id:=ids[10];duplicate_id:=ids[11];outside_id:=ids[12];
  sample_source:=ids[13];sample_match:=ids[14];chained_id:=ids[15];child_id:=ids[16];other_source:=ids[17];other_match:=ids[18];
  insert into auth.users(id,email) select id,id::text||'@example.invalid'
    from unnest(array[resident,reviewer,outside_staff,officer,administrator,pending_staff,disabled_staff]) f(id);
  update public.profiles set barangay_id=b where id in(resident,reviewer,pending_staff,disabled_staff);
  update public.profiles set role='admin' where id=administrator;
  update public.profiles set role='barangay' where id in(reviewer,pending_staff,disabled_staff);
  update public.profiles set role='barangay',barangay_id=outside_b where id=outside_staff;
  update public.profiles set account_status='pending' where id=pending_staff;
  update public.profiles set account_status='disabled' where id=disabled_staff;
  update public.profiles set role='office' where id=officer;
  insert into public.organizations(id,name,active) values(office_id,'Rollback duplicate review '||left(office_id::text,8),true);
  insert into public.organization_memberships(user_id,organization_id) values(officer,office_id);
  insert into public.organization_access_rules(organization_id,category_id,barangay_id,assignment_only,can_review,enabled)
    values(office_id,category,b,true,true,true);
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  -- Valid city coordinates; longitude deltas represent approximately 10, 40, 100 and 275 metres.
  perform set_config('request.jwt.claim.sub',resident::text,true);
  insert into public.reports(id,resident_id,category_id,problem_type,barangay_id,title,description,latitude,longitude,status,created_at,is_demo)
  select f.id,resident,f.category_id,f.problem_type,f.barangay_id,f.title,
    'Rollback-only duplicate review fixture. No actual incident is alleged.',8.22947578,f.longitude,f.status,f.created_at,f.is_demo
  from (values
    (source_id,category,problem,b,'Drainage blockage beside civic market',124.23688253,'submitted'::public.report_status,epoch,false),
    (close_id,category,problem,b,'Drainage blockage beside civic market',124.23697253,'submitted'::public.report_status,epoch-interval '1 day',false),
    (wording_id,category,problem,b,'Drainage blockage beside civic market',124.23778253,'submitted'::public.report_status,epoch-interval '1 day',false),
    (near_id,category,problem,b,'Unrelated wording delta gamma epsilon',124.23724253,'submitted'::public.report_status,epoch-interval '1 day',false),
    (far_id,category,problem,b,'Drainage blockage beside civic market',124.23938253,'submitted'::public.report_status,epoch,false),
    (old_id,category,problem,b,'Drainage blockage beside civic market',124.23697253,'submitted'::public.report_status,epoch-interval '31 days',false),
    (future_id,category,problem,b,'Drainage blockage beside civic market',124.23697253,'submitted'::public.report_status,epoch+interval '31 days',false),
    (different_category_id,other_category,other_category_problem,b,'Drainage blockage beside civic market',124.23697253,'submitted'::public.report_status,epoch,false),
    (different_problem_id,category,different_problem,b,'Drainage blockage beside civic market',124.23697253,'submitted'::public.report_status,epoch,false),
    (rejected_id,category,problem,b,'Drainage blockage beside civic market',124.23697253,'rejected'::public.report_status,epoch,false),
    (duplicate_id,category,problem,b,'Drainage blockage beside civic market',124.23697253,'duplicate'::public.report_status,epoch,false),
    (outside_id,category,problem,outside_b,'Drainage blockage beside civic market',124.23697253,'submitted'::public.report_status,epoch,false),
    (sample_source,category,problem,b,'Drainage blockage beside civic market',124.23688253,'submitted'::public.report_status,epoch,true),
    (sample_match,category,problem,b,'Drainage blockage beside civic market',124.23697253,'submitted'::public.report_status,epoch,true),
    (chained_id,category,problem,b,'Drainage blockage beside civic market',124.23697253,'submitted'::public.report_status,epoch,false),
    (child_id,category,problem,b,'Drainage blockage beside civic market',124.23697253,'duplicate'::public.report_status,epoch,false)
  ) f(id,category_id,problem_type,barangay_id,title,longitude,status,created_at,is_demo);
  insert into public.reports(id,resident_id,category_id,problem_type,problem_other,barangay_id,title,description,latitude,longitude,created_at)
    values(other_source,resident,category,'other','市場 drainage access',b,'市場 drainage access blockage','Rollback-only wording comparison with multilingual issue details.',8.22947578,124.23787253,epoch),
      (other_match,resident,category,'other','市場 drainage access',b,'市場 drainage access blockage','Rollback-only wording comparison with multilingual issue details.',8.22947578,124.23796253,epoch);
  -- Inserts intentionally use server time; privileged fixture updates restore historical comparison dates.
  -- normalize_submission is INSERT-only (20261023173303), so production timestamp protection stays intact.
  update public.reports set created_at=case
    when id=old_id then epoch-interval '31 days'
    when id=future_id then epoch+interval '31 days'
    when id in(close_id,wording_id,near_id) then epoch-interval '1 day'
    else epoch end where id=any(ids);
  assert (select created_at from public.reports where id=old_id)=epoch-interval '31 days','Historical fixture timestamp was not restored';
  insert into public.report_duplicate_links(report_id,canonical_id,reason) values(chained_id,close_id,'Rollback-only existing link for chain prevention.');
  select jsonb_agg(jsonb_build_object('id',id,'status',status) order by id) into before_status from public.reports where id=any(ids);
  select count(*) into history_count from public.report_status_history where report_id=any(ids);
  select count(*) into link_count from public.report_duplicate_links where report_id=any(ids);
  select count(*) into notification_count from public.notifications where report_id=any(ids);

  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  set local role authenticated;
  assert exists(select 1 from public.report_duplicate_candidates(source_id) where id=close_id and same_problem and match_strength='strong'),'Close matching problem was not a strong suggestion';
  select distance_m into distance from public.report_duplicate_candidates(source_id) where id=close_id;
  assert distance between 5 and 20,'Distance is not returned in metres';
  assert exists(select 1 from public.report_duplicate_candidates(source_id) where id=near_id and same_problem and match_strength='possible'),'Nearby same problem with different wording was omitted';
  assert exists(select 1 from public.report_duplicate_candidates(source_id) where id=wording_id and text_similarity>=0.35 and match_strength='possible'),'Matching wording within 150 metres was omitted';
  assert not exists(select 1 from public.report_duplicate_candidates(source_id) where id=any(array[source_id,far_id,old_id,future_id,different_category_id,different_problem_id,rejected_id,duplicate_id,outside_id,sample_source,sample_match,chained_id])),'Excluded or unauthorized candidate leaked';
  assert exists(select 1 from public.report_duplicate_candidates(other_source) where id=other_match and not same_problem and text_similarity>=0.65),'Multilingual Others wording was not compared';
  assert (select count(*) from public.report_duplicate_candidates(source_id))<=8,'Suggestion cap exceeded';
  assert exists(select 1 from public.report_duplicate_summary(array[source_id,source_id,rejected_id]) where report_id=source_id and possible_count=(select count(*) from public.report_duplicate_candidates(source_id))),'Queue summary differs from detail candidates';
  assert (select count(*) from public.report_duplicate_summary(array[source_id,source_id]))=1,'Summary repeats duplicate IDs';
  assert exists(select 1 from public.report_duplicate_summary(array[rejected_id]) where report_id=rejected_id and possible_count=0),'Summary omitted a visible zero-match report';
  assert not exists(select 1 from public.report_duplicate_summary(array[]::uuid[])),'Empty summary input returned rows';
  assert not exists(select 1 from public.report_duplicate_summary(null::uuid[])),'Null summary input returned rows';
  assert not exists(select 1 from public.report_duplicate_summary(array[gen_random_uuid(),outside_id])),'Summary leaked missing or inaccessible source IDs';
  denied:=false;
  begin perform public.report_duplicate_summary(array_fill(source_id,array[21]));exception when invalid_parameter_value then denied:=true;end;
  assert denied,'Summary accepted more than 20 input IDs';

  assert not exists(select 1 from public.report_duplicate_candidates(rejected_id)),'Rejected source returned suggestions';
  assert not exists(select 1 from public.report_duplicate_candidates(duplicate_id)),'Duplicate source returned suggestions';
  assert not exists(select 1 from public.report_duplicate_candidates(close_id)),'A canonical source returned suggestions';
  assert not exists(select 1 from public.report_duplicate_candidates(sample_source)),'Hidden sample source leaked';
  assert not exists(select 1 from public.report_duplicate_candidates(gen_random_uuid())),'Unknown source returned suggestions';
  reset role;

  foreach actor in array array[resident,pending_staff,disabled_staff,outside_staff] loop
    perform set_config('request.jwt.claim.sub',actor::text,true);
    set local role authenticated;
    denied:=false;
    begin denied:=not exists(select 1 from public.report_duplicate_candidates(source_id));exception when insufficient_privilege then denied:=true;end;
    assert denied,'Resident, inactive or out-of-scope source exposed suggestions';
    denied:=false;
    begin denied:=not exists(select 1 from public.report_duplicate_summary(array[source_id]));exception when insufficient_privilege then denied:=true;end;
    assert denied,'Resident, inactive or out-of-scope summary exposed source IDs';

    reset role;
  end loop;
  set local role anon;
  denied:=false;
  begin denied:=not exists(select 1 from public.report_duplicate_candidates(source_id));exception when insufficient_privilege then denied:=true;end;
  assert denied,'Anonymous suggestions exposed';
  denied:=false;
  begin denied:=not exists(select 1 from public.report_duplicate_summary(array[source_id]));exception when insufficient_privilege then denied:=true;end;
  assert denied,'Anonymous summary exposed';reset role;

  assert (select jsonb_agg(jsonb_build_object('id',id,'status',status) order by id) from public.reports where id=any(ids))=before_status,'Detection changed report statuses';
  assert (select count(*) from public.report_status_history where report_id=any(ids))=history_count,'Detection wrote history';
  assert (select count(*) from public.report_duplicate_links where report_id=any(ids))=link_count,'Detection created duplicate links';
  assert (select count(*) from public.notifications where report_id=any(ids))=notification_count,'Detection sent notifications';

  -- Assignment-only staff can inspect the assigned source, not its unassigned neighbours.
  update public.reports set organization_id=office_id,status='assigned' where id in(source_id,wording_id);
  perform set_config('request.jwt.claim.sub',officer::text,true);
  set local role authenticated;
  assert exists(select 1 from public.report_duplicate_candidates(source_id) where id=wording_id),'Assigned matching candidate was omitted';
  assert not exists(select 1 from public.report_duplicate_candidates(source_id) where id in(close_id,near_id,outside_id)),'Assignment-only candidate scope was bypassed';
  assert exists(select 1 from public.report_duplicate_summary(array[source_id,close_id]) where report_id=source_id and possible_count=1),'Assignment-only summary count bypassed candidate scope';
  assert not exists(select 1 from public.report_duplicate_summary(array[source_id,close_id]) where report_id=close_id),'Assignment-only summary exposed an unassigned source';

  reset role;
  update public.reports set organization_id=null,status='submitted' where id in(source_id,wording_id);

  perform set_config('request.jwt.claim.sub',administrator::text,true);
  update public.analytics_settings set include_samples=true;
  set local role authenticated;
  assert exists(select 1 from public.report_duplicate_candidates(sample_source) where id=sample_match),'Visible sample cohort did not match itself';
  assert not exists(select 1 from public.report_duplicate_candidates(sample_source) where id=any(array[source_id,close_id,wording_id,near_id])),'Sample query mixed actual cases into suggestions';
  assert not exists(select 1 from public.report_duplicate_candidates(source_id) where id in(sample_source,sample_match)),'Actual query mixed prepared cases into suggestions';
  reset role;
  update public.analytics_settings set include_samples=false;
  set local role authenticated;
  assert not exists(select 1 from public.report_duplicate_candidates(sample_source)),'Switching samples off leaked a source';
  assert not exists(select 1 from public.report_duplicate_summary(array[sample_source,sample_match])),'Summary bypassed samples-off source visibility';

  reset role;
  -- More qualifying cases than the response cap exercise bounded, stable ordering.
  perform set_config('request.jwt.claim.sub',resident::text,true);
  alter table public.reports disable trigger report_rate;
  insert into public.reports(resident_id,category_id,problem_type,barangay_id,title,description,latitude,longitude,created_at)
  select resident,category,problem,b,'Rollback nearby duplicate review '||n,
    'Rollback-only nearby fixture used to exercise the bounded response.',8.22947578,124.23689253+n*0.000001,epoch
  from generate_series(1,12) n;
  update public.reports set created_at=epoch where resident_id=resident and title like 'Rollback nearby duplicate review %';

  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  set local role authenticated;
  assert (select count(*) from public.report_duplicate_candidates(source_id))=8,'Qualifying candidates were not capped at eight';
  assert exists(select 1 from public.report_duplicate_summary(array[source_id]) where report_id=source_id and possible_count=8),'Summary count exceeded or disagreed with bounded detail count';

  select array_agg(c.id order by c.ordinality) into ordered_ids from public.report_duplicate_candidates(source_id) with ordinality c;
  select array_agg(c.id order by c.ordinality) into repeat_ids from public.report_duplicate_candidates(source_id) with ordinality c;
  assert ordered_ids=repeat_ids,'Suggestion ordering is unstable';
  reset role;

  -- Explicit confirmation must recheck scope/cohort/chain eligibility, not trust a selected UUID.
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  set local role authenticated;
  foreach actor in array array[source_id,rejected_id,duplicate_id,outside_id,sample_match,chained_id] loop
    denied:=false;
    begin perform public.change_report(source_id,'duplicate','Rollback-only manual review confirmation',null,null,actor);
      exception when raise_exception or insufficient_privilege or check_violation then denied:=true;end;
    assert denied,'An invalid canonical target was accepted';
  end loop;
  reset role;
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  update public.analytics_settings set include_samples=true;
  set local role authenticated;
  denied:=false;
  begin perform public.change_report(source_id,'duplicate','Rollback-only cross-cohort confirmation',null,null,sample_match);
    exception when raise_exception or insufficient_privilege or check_violation then denied:=true;end;
  assert denied,'Visible prepared data was accepted as an actual canonical target';
  reset role;
  update public.analytics_settings set include_samples=false;
  set local role authenticated;
  denied:=false;
  begin perform public.change_report(sample_source,'duplicate','Rollback-only hidden source confirmation',null,null,sample_match);
    exception when raise_exception or insufficient_privilege or check_violation then denied:=true;end;
  assert denied,'Hidden source was updated through the definer workflow';
  perform public.change_report(source_id,'duplicate','Reviewed evidence and confirmed the same physical issue.',null,null,close_id);
  assert exists(select 1 from public.report_duplicate_links where report_id=source_id and canonical_id=close_id),'Reviewed duplicate confirmation did not create its link';
  assert exists(select 1 from public.report_status_history where report_id=source_id and new_status='duplicate' and public_note='Reviewed evidence and confirmed the same physical issue.'),'Explicit confirmation did not retain the human reason';
  denied:=false;
  begin perform public.change_report(close_id,'duplicate','Rollback-only canonical chain confirmation',null,null,wording_id);
    exception when raise_exception or insufficient_privilege or check_violation then denied:=true;end;
  assert denied,'A canonical parent was marked duplicate and created a chain';
  reset role;
end $tests$;
rollback;
select 'PASS: duplicate ranking, role/cohort privacy, read-only detection and explicit reviewed confirmation; all fixtures rolled back' as result;
