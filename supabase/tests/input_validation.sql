-- All records, notifications and audits roll back. No Storage or external email writes.
begin;
set local statement_timeout='30s';
do $tests$
declare
  resident uuid:=gen_random_uuid(); administrator uuid:=gen_random_uuid();
  report_id uuid:=gen_random_uuid(); walk_in_report_id uuid:=gen_random_uuid();
  consultation_id uuid:=gen_random_uuid(); comment_id uuid:=gen_random_uuid();
  request_id uuid:=gen_random_uuid(); meeting_id uuid:=gen_random_uuid(); action_id uuid:=gen_random_uuid(); announcement_id uuid:=gen_random_uuid();
  area uuid; category uuid; problem text; latitude double precision; longitude double precision;
  bad record; denied boolean; target uuid; tests integer:=0;
begin
  select id, extensions.st_y(extensions.st_pointonsurface(boundary)), extensions.st_x(extensions.st_pointonsurface(boundary))
    into area, latitude, longitude from public.barangays where name='Poblacion' and boundary is not null;
  select c.id,p.code into category,problem from public.report_categories c join public.report_problem_types p on p.category_id=c.id
    where c.active and p.code<>'other' order by c.name,p.sort_order limit 1;
  insert into auth.users(id,email) values(resident,resident::text||'@example.invalid'),(administrator,administrator::text||'@example.invalid');
  update public.profiles set role='admin' where id=administrator;
  update public.profiles set barangay_id=area where id=resident;
  perform set_config('request.jwt.claim.sub',resident::text,true);
  set local role authenticated;
  perform public.submit_report(report_id,category,area,'Rollback input validation','A transaction-only report to verify input validation safely.',8.22947578,124.23688253,'',problem);
  update public.profiles set first_name=U&'Jos\00E9',middle_name='O’Connor',last_name='Cruz' where id=resident;
  assert (select display_name from public.profiles where id=resident)=U&'Jos\00E9 O’Connor Cruz','Legitimate Unicode name rejected';
  assert private.valid_person_name('Ma. Cristina',2,100),'A Filipino abbreviated name was rejected';
  assert private.valid_person_name('María O’Connor',2,100),'An accented apostrophe name was rejected';
  assert private.valid_email_address('walkin+case@example.com'),'A valid plus-address was rejected';
  assert not private.valid_email_address('john@gmail'),'An incomplete email domain was accepted';
  assert not private.valid_email_address('john..doe@example.com'),'A malformed email local part was accepted';
  reset role;
  update public.profiles set role='barangay' where id=resident;
  perform set_config('request.jwt.claim.sub',resident::text,true);
  set local role authenticated;
  perform public.submit_walk_in_report_with_contacts(
    walk_in_report_id,category,area,'María O’Connor',' walkin+case@example.com ','0917 123 4567',
    'Rollback walk-in input','A transaction-only walk-in record for email and name checks.',
    latitude,longitude,'Poblacion Hall',problem,null,'Purok 1','Zone 1'
  );
  reset role;
  insert into public.report_status_history(report_id,actor_id,old_status,new_status,public_note)
  values(walk_in_report_id,administrator,'submitted','under_review','Review started for this walk-in report.');
  assert exists(select 1 from public.email_outbox as outbox where outbox.recipient_id is null and outbox.recipient_email='walkin+case@example.com'
    and outbox.event_key='report_update' and outbox.report_id=walk_in_report_id),'Walk-in status change did not queue the reporter email';
  denied:=false;
  begin update private.walk_in_reporter_details as details set reporter_name='Walk-in123' where details.report_id=walk_in_report_id;
  exception when check_violation then denied:=true;end;
  assert denied,'An invalid walk-in reporter name bypassed the database trigger';tests:=tests+1;
  denied:=false;
  begin update private.walk_in_reporter_details as details set reporter_email='john@gmail' where details.report_id=walk_in_report_id;
  exception when check_violation then denied:=true;end;
  assert denied,'An invalid walk-in email bypassed the database trigger';tests:=tests+1;
  reset role;
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  insert into public.consultations(id,barangay_id,title,body,status,created_by) values(consultation_id,area,'Rollback discussion','A transaction-only discussion to check content and date limits.','open',administrator);
  perform set_config('request.jwt.claim.sub',resident::text,true);
  insert into public.consultation_comments(id,consultation_id,author_id,body) values(comment_id,consultation_id,resident,'A helpful test comment.');
  insert into public.meeting_requests(id,barangay_id,resident_id,title,body,status,decision_reason) values(request_id,area,resident,'Rollback meeting request','A transaction-only request to verify bounded input.','approved','Approved for rollback-only validation.');
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  insert into public.meetings(id,request_id,venue,starts_at,ends_at) values(meeting_id,request_id,'Rollback meeting room',now()+interval '1 day',now()+interval '1 day 1 hour');
  insert into public.meeting_action_items(id,meeting_id,description) values(action_id,meeting_id,'Record a rollback-only follow-up.');
  insert into public.announcements(id,title,body,kind,status,publish_at,created_by) values(announcement_id,'Rollback announcement','A transaction-only announcement to test content and date bounds.','Community update','draft',now(),administrator);
  for bad in select * from (values
    ('profiles','display_name',repeat('x',101),'text'),
    ('profiles','first_name','Resident123','text'),('profiles','last_name','Bad🙂','text'),
    ('reports','title',repeat('x',161),'text'),('reports','description',repeat(' ',20),'text'),
    ('reports','description',repeat(U&'\200B',25),'text'),('reports','description','A description with '||chr(1)||' a control character.','text'),
    ('reports','landmark',repeat('x',241),'text'),('reports','public_summary',repeat('x',161),'text'),
    ('reports','latitude','NaN','double precision'),('reports','longitude','Infinity','double precision'),
    ('consultations','title',repeat(' ',8),'text'),('consultations','body',repeat('x',10001),'text'),
    ('consultations','closes_at','infinity','timestamptz'),('consultations','outcome',repeat('x',2001),'text'),
    ('consultation_comments','body',repeat(' ',2),'text'),('consultation_comments','body',repeat('x',2001),'text'),
    ('consultation_comments','moderation_reason',repeat('x',501),'text'),
    ('meeting_requests','title',repeat(' ',8),'text'),('meeting_requests','body',repeat('x',4001),'text'),
    ('meeting_requests','decision_reason',repeat('x',501),'text'),
    ('meetings','venue',repeat('x',241),'text'),('meetings','starts_at','infinity','timestamptz'),
    ('meetings','starts_at','12000-01-01','timestamptz'),('meetings','outcome',repeat('x',2001),'text'),
    ('meeting_action_items','description',repeat(U&'\200B',10),'text'),('meeting_action_items','due_at','infinity','date'),
    ('announcements','kind',repeat('x',81),'text'),('announcements','publish_at','infinity','timestamptz'),
    ('announcements','body',repeat('x',10001),'text')
  ) inputs(table_name,column_name,value,cast_type) loop
    target:=case bad.table_name when 'profiles' then resident when 'reports' then report_id when 'consultations' then consultation_id
      when 'consultation_comments' then comment_id when 'meeting_requests' then request_id when 'meetings' then meeting_id
      when 'meeting_action_items' then action_id when 'announcements' then announcement_id end;
    denied:=false;
    begin
      execute format('update public.%I set %I=$1::%s where id=$2',bad.table_name,bad.column_name,bad.cast_type) using bad.value,target;
    exception when check_violation or not_null_violation or invalid_text_representation or datetime_field_overflow or invalid_datetime_format then denied:=true;
      when raise_exception then
        if sqlerrm ~ '^(This pin is outside|Provide a title|Provide a descriptive|Provide a venue|Describe the follow-up)' then denied:=true;else raise;end if;
    end;
    assert denied,format('Invalid input accepted: %s.%s',bad.table_name,bad.column_name); tests:=tests+1;
  end loop;
  for bad in select * from (values('count_weight','NaN'),('severity_weight','Infinity'),('age_weight','-1'),('count_weight','1001')) weights(column_name,value) loop
    denied:=false;
    begin execute format('update public.analytics_settings set %I=$1::numeric where id',bad.column_name) using bad.value;
    exception when check_violation then denied:=true;end;
    assert denied,'Non-finite or out-of-range analytical weight accepted';tests:=tests+1;
  end loop;
  update public.reports set title='<script>alert(''literal text'')</script>',description='Robert''); DROP TABLE reports;-- is stored as text, never executed.' where id=report_id;
  assert exists(select 1 from public.reports where id=report_id and title like '<script>%'),'Literal markup was not preserved as text';
  assert private.valid_input_text(E'Valid text\nwith a second line\tand context.',5,200),'Multiline text rejected';
  assert not private.valid_input_text(repeat(U&'\200B',20),8,160),'Invisible-only text accepted';
  update public.consultation_comments set moderation_reason=repeat('r',500) where id=comment_id;
  update public.meeting_requests set decision_reason=repeat('r',500) where id=request_id;
  insert into public.comment_flags(comment_id,user_id,reason) values(comment_id,resident,repeat('r',500));
  denied:=false;target:=comment_id;
  begin
    update public.comment_flags f set reason=repeat('r',501) where f.comment_id=target and f.user_id=resident;
  exception when check_violation then denied:=true;end;
  assert denied,'A 501-character comment flag was accepted';tests:=tests+1;
  assert tests=37,'Invalid-value test count changed';
  raise notice '% invalid-value attempts rejected; Unicode, literal markup and multiline inputs preserved',tests;
end $tests$;
rollback;
select 'PASS: 37 invalid values rejected; Unicode names, valid direct email queueing, 500-character reasons and authenticated valid inputs accepted; all fixtures rolled back' as result;
