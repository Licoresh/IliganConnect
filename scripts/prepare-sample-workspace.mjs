// Prepares reviewable SQL only. Database changes require an explicit separate execution.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const dataset = JSON.parse(readFileSync("data/sample-workspace/cases.json", "utf8"));
const base = JSON.parse(readFileSync(".env.demo.json", "utf8"));
const scoped = JSON.parse(readFileSync(".env.rbac-demo.json", "utf8"));
const actors = {
  resident: base.resident.id, admin: base.admin.id,
  poblacion: base.barangay.id, tibanga: scoped.tibanga.id,
  engineer: scoped.engineer.id,
  cdrrmo: scoped.cdrrmo.id, dpwh: scoped.dpwh.id,
  utility: scoped.utility.id, traffic: scoped.traffic.id, cenro: scoped.cenro.id,
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
for (const value of Object.values(actors)) assert.match(value, uuid);
assert.equal(dataset.version, "iligan-sample-workspace-v1");
assert.equal(dataset.reports.length, 36);
assert.equal(new Set(dataset.reports.map(r => `${r.latitude}:${r.longitude}`)).size, 36);
const states = ["submitted", "under_review", "verified", "assigned", "in_progress", "resolved"];
const ids = new Set();
for (const record of [...dataset.reports, ...dataset.consultations, ...dataset.requests, ...dataset.meetings, ...dataset.announcements, ...dataset.comments, ...dataset.actions]) {
  assert.match(record.id, uuid); assert.ok(!ids.has(record.id)); ids.add(record.id);
  if (record.title) assert.ok(record.title.trim().length > 0 && record.title.length <= 160);
}
for (const report of dataset.reports) {
  assert.ok(states.includes(report.status));
  assert.ok(report.age_days >= 1 && report.age_days <= 60);
  assert.ok(report.description.length >= 20 && report.description.length <= 4000);
  assert.ok(Number.isFinite(report.latitude) && Number.isFinite(report.longitude));
  for (const value of [report.purok, report.zone]) assert.ok(typeof value === "string" && value.trim() && value.length <= 80);
  assert.ok(report.severity >= 1 && report.severity <= 5);
  if (states.indexOf(report.status) >= 2) {
    assert.ok(Number.isInteger(report.urgency) && report.urgency >= 1 && report.urgency <= 5, "Each verified fixture needs a scenario urgency");
    assert.ok(typeof report.assessment_note === "string" && report.assessment_note.trim().length >= 5 && report.assessment_note.length <= 4000);
  }
}
for (const status of states) assert.equal(dataset.reports.filter(r => r.status === status).length, 6);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const sql = `-- Explicitly requested sample workspace. Fictional workflow; real indicative geography.
-- No schema changes or real-record replacement. Run only after reviewing this entire file.
begin;
set local statement_timeout='60s';
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtext('iligan-sample-workspace-v1'));
update public.analytics_settings set include_samples=true where not include_samples;
create temporary table inserted_sample_reports(id uuid primary key) on commit drop;
do $sample_workspace$
#variable_conflict use_variable
declare
  dataset jsonb:=${quote(JSON.stringify(dataset))}::jsonb;
  actors jsonb:=${quote(JSON.stringify(actors))}::jsonb;
  anchor timestamptz:=${quote(dataset.anchor)};
  r jsonb; c jsonb; req jsonb; meeting jsonb; item jsonb;
  report_id uuid; category_id uuid; barangay_id uuid; organization_id uuid; action_organization_id uuid;
  actor uuid; reviewer uuid; owner_id uuid:=(actors->>'resident')::uuid;
  administrator uuid:=(actors->>'admin')::uuid;
  stage integer; stage_count integer; created timestamptz; event_time timestamptz; schedule_time timestamptz;
  organization_name text; organization_actor text;
begin
  if not exists(select 1 from public.profiles where id=owner_id and role='resident' and account_status='active')
    or not exists(select 1 from public.profiles where id=administrator and role='admin' and account_status='active') then
    raise exception 'Expected temporary sample resident/administrator accounts are unavailable';
  end if;
  for r in select value from jsonb_array_elements(dataset->'reports') loop
    report_id:=(r->>'id')::uuid;
    if exists(select 1 from public.reports where id=report_id) then
      if not exists(select 1 from public.reports where id=report_id and is_demo and resident_id=owner_id) then
        raise exception 'Sample UUID collision; refusing to change existing report %',report_id;
      end if;
      continue;
    end if;
    select id into strict category_id from public.report_categories where name=r->>'category' and active;
    select id into strict barangay_id from public.barangays b where b.name=r->>'barangay'
      and extensions.st_covers(b.boundary,extensions.st_setsrid(extensions.st_makepoint((r->>'longitude')::float8,(r->>'latitude')::float8),4326));
    if not exists(select 1 from public.report_problem_types p where p.category_id=category_id and code=r->>'problem_type') then
      raise exception 'Problem code does not match sample category';
    end if;
    created:=anchor-make_interval(days=>(r->>'age_days')::int);
    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    set local role authenticated;
    perform public.submit_report(report_id,category_id,barangay_id,r->>'title',r->>'description',
      (r->>'latitude')::float8,(r->>'longitude')::float8,r->>'landmark',r->>'problem_type',null,
      r->>'purok',r->>'zone','coordinates');
    reset role;
    -- Backdate immediately, so sample preparation does not bypass or trip the resident hourly limit.
    update public.reports set is_demo=true,created_at=created where id=report_id;
    insert into inserted_sample_reports values(report_id);
    reviewer:=case r->>'barangay' when 'Tibanga' then (actors->>'tibanga')::uuid
      when 'Poblacion' then (actors->>'poblacion')::uuid else administrator end;
    stage_count:=array_position(array['submitted','under_review','verified','assigned','scheduled','in_progress','resolved'],r->>'status')-1;
    organization_id:=null;
    if stage_count>=3 then
      organization_name:=r->>'organization';
      select o.id into strict organization_id from public.organizations o where o.name=organization_name and o.active;
      if not exists(select 1 from public.organization_access_rules a where a.organization_id=organization_id and enabled
        and a.category_id=category_id and (a.barangay_id is null or a.barangay_id=barangay_id)) then
        raise exception 'Sample routing lacks an approved current scope';
      end if;
    end if;
    for stage in 1..stage_count loop
      event_time:=created+(anchor-created)*(stage::numeric/(stage_count+0.5));
      actor:=reviewer;
      if stage>=4 then
        organization_actor:=r->>'office_actor';
        actor:=coalesce((actors->>organization_actor)::uuid,administrator);
      end if;
      perform set_config('request.jwt.claim.sub',actor::text,true);
      set local role authenticated;
      if stage=1 then perform public.change_report(report_id,'under_review','Report details and location reviewed.');
      elsif stage=2 then perform public.change_report(report_id,'verified',r->>'assessment_note',null,(r->>'severity')::int,null,r->>'public_summary',(r->>'urgency')::int);
      elsif stage=3 then perform public.change_report(report_id,'assigned','Referred to the responsible office for coordinated action.',organization_id);
      elsif stage=4 then
        schedule_time:=event_time+interval '2 hours';
        perform public.change_report(report_id,'scheduled','Inspection or repair work has been scheduled.',p_scheduled_at=>schedule_time);
      elsif stage=5 then perform public.change_report(report_id,'in_progress','Inspection and work planning are in progress.');
      else perform public.change_report(report_id,'resolved','Work and follow-up completed; the case is closed.');
      end if;
      reset role;
      update public.report_status_history set created_at=event_time where report_status_history.report_id=report_id
        and new_status=(array['under_review','verified','assigned','scheduled','in_progress','resolved'])[stage]::public.report_status;
      if stage=2 then
        update public.reports set verified_at=event_time where id=report_id;
        update public.report_assessments set created_at=event_time where report_assessments.report_id=report_id;
      end if;
      if stage=3 then update public.report_assignments set created_at=event_time where report_assignments.report_id=report_id; end if;
      update public.notifications set created_at=event_time where notifications.report_id=report_id and created_at=now();
    end loop;
  end loop;
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  for c in select value from jsonb_array_elements(dataset->'consultations') loop
    if exists(select 1 from public.consultations where id=(c->>'id')::uuid) then
      if not exists(select 1 from public.consultations where id=(c->>'id')::uuid and is_sample) then raise exception 'Consultation UUID collision'; end if;
      continue;
    end if;
    select b.id into strict barangay_id from public.barangays b where b.name=c->>'barangay';
    select o.id into strict organization_id from public.organizations o where o.name=c->>'organization';
    insert into public.consultations(id,barangay_id,organization_id,title,body,status,report_id,opens_at,closes_at,created_by,is_sample)
      values((c->>'id')::uuid,barangay_id,organization_id,c->>'title',c->>'body','open',(c->>'report_id')::uuid,
        anchor-interval '7 days',anchor+interval '14 days',administrator,true);
    update public.consultations set created_at=anchor-interval '8 days' where id=(c->>'id')::uuid;
    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    insert into public.consultation_followers(consultation_id,user_id) values((c->>'id')::uuid,owner_id) on conflict do nothing;
    for item in select value from jsonb_array_elements(dataset->'comments') where value->>'consultation_id'=c->>'id' loop
      actor:=case when item->>'actor'='resident' then owner_id else administrator end;
      perform set_config('request.jwt.claim.sub',actor::text,true);
      set local role authenticated;
      insert into public.consultation_comments(id,consultation_id,author_id,body) values((item->>'id')::uuid,(c->>'id')::uuid,actor,item->>'body');
      reset role;
      update public.consultation_comments set created_at=anchor-case when item->>'actor'='resident' then interval '3 days' else interval '2 days' end where id=(item->>'id')::uuid;
    end loop;
    perform set_config('request.jwt.claim.sub',administrator::text,true);
    if c->>'status'='closed' then update public.consultations set status='closed',closes_at=anchor-interval '1 day',outcome=c->>'outcome' where id=(c->>'id')::uuid; end if;
  end loop;
  for req in select value from jsonb_array_elements(dataset->'requests') loop
    if exists(select 1 from public.meeting_requests where id=(req->>'id')::uuid) then
      if not exists(select 1 from public.meeting_requests where id=(req->>'id')::uuid and is_sample and resident_id=owner_id) then raise exception 'Meeting-request UUID collision'; end if;
      continue;
    end if;
    select b.id into strict barangay_id from public.barangays b where b.name=req->>'barangay';
    select rc.id into strict category_id from public.report_categories rc where rc.name=req->>'category';
    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    insert into public.meeting_requests(id,barangay_id,resident_id,title,body,category_id,report_id,consultation_id,is_sample)
      values((req->>'id')::uuid,barangay_id,owner_id,req->>'title',req->>'body',category_id,(req->>'report_id')::uuid,(req->>'consultation_id')::uuid,true);
    update public.meeting_requests set created_at=anchor-interval '6 days' where id=(req->>'id')::uuid;
    insert into public.meeting_supporters(request_id,user_id) values((req->>'id')::uuid,owner_id);
    perform set_config('request.jwt.claim.sub',administrator::text,true);
    if req->>'status'='approved' then update public.meeting_requests set status='approved',decision_reason='Coordination request approved.' where id=(req->>'id')::uuid; end if;
  end loop;
  for meeting in select value from jsonb_array_elements(dataset->'meetings') loop
    if exists(select 1 from public.meetings where id=(meeting->>'id')::uuid) then continue; end if;
    insert into public.meetings(id,request_id,starts_at,venue,outcome,completed)
      values((meeting->>'id')::uuid,(meeting->>'request_id')::uuid,anchor+make_interval(days=>(meeting->>'starts_in_days')::int),
        meeting->>'venue',meeting->>'outcome',(meeting->>'completed')::bool);
    update public.meetings set created_at=anchor-interval '6 days' where id=(meeting->>'id')::uuid;
    select id into strict organization_id from public.organizations where name=meeting->>'organization';
    insert into public.meeting_participants(meeting_id,organization_id) values((meeting->>'id')::uuid,organization_id);
    for item in select value from jsonb_array_elements(dataset->'actions') where value->>'meeting_id'=meeting->>'id' loop
      action_organization_id:=organization_id;
      if item->>'organization' is not null then
        select id into strict action_organization_id from public.organizations where name=item->>'organization' and active;
        insert into public.meeting_participants(meeting_id,organization_id) values((meeting->>'id')::uuid,action_organization_id) on conflict do nothing;
      end if;
      insert into public.meeting_action_items(id,meeting_id,organization_id,description,due_at,completed)
        values((item->>'id')::uuid,(meeting->>'id')::uuid,action_organization_id,item->>'description',
          (anchor+make_interval(days=>(item->>'due_in_days')::int))::date,(item->>'completed')::bool);
    end loop;
  end loop;
  for item in select value from jsonb_array_elements(dataset->'announcements') loop
    if exists(select 1 from public.announcements where id=(item->>'id')::uuid) then
      if not exists(select 1 from public.announcements where id=(item->>'id')::uuid and is_sample) then raise exception 'Announcement UUID collision'; end if;
      continue;
    end if;
    perform set_config('request.jwt.claim.sub',administrator::text,true);
    insert into public.announcements(id,title,body,kind,status,publish_at,created_by,is_sample)
      values((item->>'id')::uuid,item->>'title',item->>'body','Community update',item->>'status',
        anchor-make_interval(days=>(item->>'age_days')::int),administrator,true);
    update public.announcements set created_at=anchor-make_interval(days=>(item->>'age_days')::int) where id=(item->>'id')::uuid;
  end loop;
  -- New sample status notices retain their simulated chronology; older sample notices start read.
  with ranked as(select n.id,row_number() over(partition by n.user_id order by n.created_at desc,n.id) position
    from public.notifications n join inserted_sample_reports r on r.id=n.report_id)
  update public.notifications n set read_at=case when ranked.position<=4 then null else n.created_at+interval '1 hour' end
    from ranked where ranked.id=n.id;
  if (select count(*) from public.reports where id in(select (value->>'id')::uuid from jsonb_array_elements(dataset->'reports')) and is_demo)<>36 then raise exception 'Sample report count mismatch'; end if;
end $sample_workspace$;
commit;
select status,count(*) from public.reports where id in(${dataset.reports.map(r => quote(r.id)).join(",")}) group by status order by status;
`;
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/sample-workspace.sql", sql);
writeFileSync("artifacts/sample-workspace-manifest.json", JSON.stringify({ ...dataset, resident_id: actors.resident, admin_id: actors.admin }, null, 2) + "\n");
console.log(`Prepared ${dataset.reports.length} reports, ${dataset.consultations.length} consultations, ${dataset.requests.length} requests, ${dataset.meetings.length} meetings and ${dataset.announcements.length} announcements. No database calls made.`);
