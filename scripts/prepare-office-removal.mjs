// Produces guarded SQL only; application requires a separate explicit execution.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const plan=JSON.parse(readFileSync('data/office-retirement.json','utf8'));
const cases=JSON.parse(readFileSync('data/sample-workspace/cases.json','utf8'));
const actor=JSON.parse(readFileSync('.env.admin.json','utf8')).id;
const obsoleteMember=JSON.parse(readFileSync('.env.demo.json','utf8')).office.id;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
assert.equal(plan.final_action,'delete');
for(const id of [actor,obsoleteMember,...plan.offices.map(o=>o.from_id)])assert.match(id,uuid);
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const refs={closedReport:cases.reports.find(r=>r.key===plan.closed_report_key).id,closedConsultation:plan.closed_consultation,completedAction:plan.completed_meeting_action,assignedReports:cases.reports.filter(r=>[plan.closed_report_key,...plan.open_reports.map(r=>r.key)].includes(r.key)).map(r=>r.id)};
const sql=`-- Explicit owner request: delete the two retired identities after reference consolidation.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
select pg_advisory_xact_lock(hashtext('assessment-office-removal-v2'));
do $remove$
declare
  actor uuid:=${quote(actor)};
  obsolete_member uuid:=${quote(obsoleteMember)};
  offices jsonb:=${quote(JSON.stringify(plan.offices))}::jsonb;
  reviewed jsonb:=${quote(JSON.stringify(refs))}::jsonb;
  item jsonb; source public.organizations; target uuid;
  reports_before jsonb; history_before jsonb; assignments_before jsonb; consultations_before jsonb; actions_before jsonb; rules_before jsonb;
begin
  if not exists(select 1 from public.profiles where id=actor and role='admin' and account_status='active') then raise exception 'Active administrator required'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform 1 from public.organizations where id in(select (value->>'from_id')::uuid from jsonb_array_elements(offices)) or name in(select value->>'to' from jsonb_array_elements(offices)) order by id for update;
  select jsonb_agg(to_jsonb(r)-'organization_id'-'updated_at' order by id) into reports_before from public.reports r;
  select jsonb_agg(to_jsonb(h) order by id) into history_before from public.report_status_history h;
  select jsonb_agg(to_jsonb(a)-'organization_id' order by id) into assignments_before from public.report_assignments a;
  select jsonb_agg(to_jsonb(c)-'organization_id'-'updated_at' order by id) into consultations_before from public.consultations c;
  select jsonb_agg(to_jsonb(a)-'organization_id' order by id) into actions_before from public.meeting_action_items a;
  select jsonb_agg(to_jsonb(a) order by a.id) into rules_before from public.organization_access_rules a where a.organization_id not in(select (value->>'from_id')::uuid from jsonb_array_elements(offices));
  for item in select value from jsonb_array_elements(offices) loop
    select id into strict target from public.organizations where name=item->>'to' and active;
    select * into source from public.organizations where id=(item->>'from_id')::uuid;
    if source.id is null then
      if exists(select 1 from public.organizations where name=item->>'from') then raise exception 'Office name reused; inspect identity'; end if;
      continue;
    end if;
    if source.name<>item->>'from' or source.active then raise exception 'Expected retired office identity changed'; end if;
    if exists(select 1 from public.organization_access_rules where organization_id=source.id and enabled) then raise exception 'Retired access rules changed'; end if;
    if exists(select 1 from public.routing_rules where organization_id=source.id) or exists(select 1 from public.announcements where organization_id=source.id) then raise exception 'Unreviewed live organization references'; end if;
    if exists(select 1 from public.reports where organization_id=source.id and (id<>(reviewed->>'closedReport')::uuid or status<>'resolved' or not is_demo)) then raise exception 'Unreviewed report reference'; end if;
    if exists(select 1 from public.report_assignments where organization_id=source.id and report_id not in(select value::uuid from jsonb_array_elements_text(reviewed->'assignedReports'))) then raise exception 'Unreviewed assignment reference'; end if;
    if exists(select 1 from public.consultations where organization_id=source.id and (id<>(reviewed->>'closedConsultation')::uuid or status<>'closed' or not is_sample)) then raise exception 'Unreviewed consultation reference'; end if;
    if exists(select 1 from public.meeting_action_items where organization_id=source.id and (id<>(reviewed->>'completedAction')::uuid or not completed)) then raise exception 'Unreviewed meeting action'; end if;
    if exists(select 1 from public.meeting_participants p where p.organization_id=source.id and p.meeting_id not in(select meeting_id from public.meeting_action_items where id=(reviewed->>'completedAction')::uuid)) then raise exception 'Unreviewed meeting participant'; end if;
    if exists(select 1 from public.organization_memberships where organization_id=source.id and user_id<>obsolete_member) then raise exception 'Unreviewed office membership'; end if;
    update public.reports set organization_id=target where organization_id=source.id;
    update public.report_assignments set organization_id=target where organization_id=source.id;
    update public.consultations set organization_id=target where organization_id=source.id;
    update public.meeting_action_items set organization_id=target where organization_id=source.id;
    insert into public.meeting_participants(meeting_id,organization_id) select meeting_id,target from public.meeting_participants where organization_id=source.id on conflict do nothing;
    delete from public.meeting_participants where organization_id=source.id;
    delete from public.organization_memberships where organization_id=source.id;
    delete from public.organization_access_rules where organization_id=source.id;
    delete from public.organizations where id=source.id;
  end loop;
  if reports_before is distinct from(select jsonb_agg(to_jsonb(r)-'organization_id'-'updated_at' order by id) from public.reports r) then raise exception 'Report content/progress changed'; end if;
  if history_before is distinct from(select jsonb_agg(to_jsonb(h) order by id) from public.report_status_history h) then raise exception 'Status history changed'; end if;
  if assignments_before is distinct from(select jsonb_agg(to_jsonb(a)-'organization_id' order by id) from public.report_assignments a) then raise exception 'Assignment identity/actor/reason/timestamp changed'; end if;
  if consultations_before is distinct from(select jsonb_agg(to_jsonb(c)-'organization_id'-'updated_at' order by id) from public.consultations c) then raise exception 'Consultation content/status changed'; end if;
  if actions_before is distinct from(select jsonb_agg(to_jsonb(a)-'organization_id' order by id) from public.meeting_action_items a) then raise exception 'Action content/completion changed'; end if;
  if rules_before is distinct from(select jsonb_agg(to_jsonb(a) order by a.id) from public.organization_access_rules a) then raise exception 'Surviving office permissions changed'; end if;
end $remove$;
select jsonb_build_object('offices',(select count(*) from public.organizations),'inactive_offices',(select count(*) from public.organizations where not active),'removed_identities',(select count(*) from public.organizations where id in(${plan.offices.map(o=>quote(o.from_id)).join(',')})),
  'reports',(select count(*) from public.reports),'status_events',(select count(*) from public.report_status_history),'assignments',(select count(*) from public.report_assignments),
  'reconciled_closed_report',(select o.name from public.reports r join public.organizations o on o.id=r.organization_id where r.id=${quote(refs.closedReport)}),
  'reconciled_consultation',(select o.name from public.consultations c join public.organizations o on o.id=c.organization_id where c.id=${quote(refs.closedConsultation)})) as removal_result;
commit;
`;
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/office-removal.sql',sql);
writeFileSync('artifacts/office-removal-rollback.sql',sql.replace(/commit;\s*$/,'rollback;\n'));
console.log('Prepared complete office removal and rollback SQL. No database requests made.');
