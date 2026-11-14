// Produces guarded SQL for separate review/execution; makes no database requests.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const plan=JSON.parse(readFileSync('data/office-retirement.json','utf8'));
assert.notEqual(plan.final_action,'delete','Inactive retention was superseded. Use scripts/prepare-office-removal.mjs for the approved complete removal.');
const cases=JSON.parse(readFileSync('data/sample-workspace/cases.json','utf8'));
const actor=JSON.parse(readFileSync('.env.admin.json','utf8')).id;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
assert.match(actor,uuid);assert.equal(plan.version,'assessment-office-retirement-v1');
const reports=plan.open_reports.map(p=>({...p,id:cases.reports.find(r=>r.key===p.key)?.id}));
for(const r of reports)assert.match(r.id,uuid);
assert.match(plan.pending_meeting_action,uuid);
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const sql=`-- Owner-approved office retirement. Preserve history; transfer only reviewed open work.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
select pg_advisory_xact_lock(hashtext('assessment-office-retirement-v1'));
do $retire$
declare
  actor uuid:=${quote(actor)};
  offices jsonb:=${quote(JSON.stringify(plan.offices))}::jsonb;
  reports jsonb:=${quote(JSON.stringify(reports))}::jsonb;
  action_id uuid:=${quote(plan.pending_meeting_action)};
  item jsonb; source_id uuid; target_id uuid; saved public.reports; action_row public.meeting_action_items;
  before_reports jsonb; before_history jsonb; before_rules jsonb;
begin
  if not exists(select 1 from public.profiles where id=actor and role='admin' and account_status='active') then raise exception 'Active administrator unavailable'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform 1 from public.organizations where name in(select value->>'from' from jsonb_array_elements(offices) union select value->>'to' from jsonb_array_elements(offices)) order by id for update;
  if (select count(*) from public.organizations where name in(select value->>'from' from jsonb_array_elements(offices) union select value->>'to' from jsonb_array_elements(offices)))<>4 then raise exception 'Office identities changed'; end if;
  if exists(select 1 from public.reports r join public.organizations o on o.id=r.organization_id
    where o.name in(select value->>'from' from jsonb_array_elements(offices)) and r.status not in('resolved','rejected','duplicate')
    and r.id not in(select (value->>'id')::uuid from jsonb_array_elements(reports))) then raise exception 'Unreviewed open reports require a handoff'; end if;
  if exists(select 1 from public.meeting_action_items a join public.organizations o on o.id=a.organization_id
    where o.name in(select value->>'from' from jsonb_array_elements(offices)) and not a.completed and a.id<>action_id) then raise exception 'Unreviewed meeting work requires a handoff'; end if;
  if exists(select 1 from public.routing_rules r join public.organizations o on o.id=r.organization_id where o.name in(select value->>'from' from jsonb_array_elements(offices))) then raise exception 'Routing guidance requires review'; end if;
  select jsonb_agg(to_jsonb(r)-'organization_id'-'updated_at' order by r.id) into before_reports from public.reports r where r.id in(select (value->>'id')::uuid from jsonb_array_elements(reports));
  select jsonb_agg(to_jsonb(h) order by h.id) into before_history from public.report_status_history h where h.report_id in(select (value->>'id')::uuid from jsonb_array_elements(reports));
  select jsonb_agg(to_jsonb(a) order by a.id) into before_rules from public.organization_access_rules a join public.organizations o on o.id=a.organization_id where o.name in(select value->>'to' from jsonb_array_elements(offices));
  for item in select value from jsonb_array_elements(reports) loop
    select id into strict source_id from public.organizations where name=item->>'from';
    select id into strict target_id from public.organizations where name=item->>'to' and active;
    select * into strict saved from public.reports where id=(item->>'id')::uuid for update;
    if saved.organization_id=target_id then continue; end if;
    if saved.organization_id is distinct from source_id or not saved.is_demo or saved.status<>'in_progress' then raise exception 'Prepared report changed; refusing to overwrite'; end if;
    if not exists(select 1 from public.organization_access_rules a where a.organization_id=target_id and a.enabled and a.can_update and a.category_id=saved.category_id and (a.barangay_id is null or a.barangay_id=saved.barangay_id)) then raise exception 'Destination lacks approved report responsibility'; end if;
    update public.reports set organization_id=target_id where id=saved.id;
    insert into public.report_assignments(report_id,organization_id,actor_id,reason)
      values(saved.id,target_id,actor,'Office cleanup: retired assessment team handoff. Existing progress is preserved.');
  end loop;
  select id into strict source_id from public.organizations where name='Environment assessment team';
  select id into strict target_id from public.organizations where name='CENRO' and active and can_coordinate;
  select * into strict action_row from public.meeting_action_items where id=action_id for update;
  if action_row.organization_id is distinct from target_id then
    if action_row.organization_id is distinct from source_id or action_row.completed then raise exception 'Pending meeting action changed'; end if;
    if not exists(select 1 from public.meetings m join public.meeting_requests req on req.id=m.request_id
      left join public.reports linked on linked.id=req.report_id join public.organization_access_rules a on a.organization_id=target_id
      where m.id=action_row.meeting_id and req.is_sample and a.enabled and a.can_review and a.category_id=coalesce(linked.category_id,req.category_id)
      and (a.barangay_id is null or a.barangay_id=req.barangay_id) and (not a.assignment_only or linked.organization_id=target_id)) then raise exception 'Destination lacks approved meeting responsibility'; end if;
    update public.meeting_action_items set organization_id=target_id where id=action_id;
    insert into public.meeting_participants(meeting_id,organization_id) values(action_row.meeting_id,target_id) on conflict do nothing;
  end if;
  update public.organization_access_rules set enabled=false where enabled and organization_id in(select o.id from public.organizations o where o.name in(select value->>'from' from jsonb_array_elements(offices)));
  update public.organizations set active=false where active and name in(select value->>'from' from jsonb_array_elements(offices));
  if before_reports is distinct from(select jsonb_agg(to_jsonb(r)-'organization_id'-'updated_at' order by r.id) from public.reports r where r.id in(select (value->>'id')::uuid from jsonb_array_elements(reports))) then raise exception 'Report content/progress changed unexpectedly'; end if;
  if before_history is distinct from(select jsonb_agg(to_jsonb(h) order by h.id) from public.report_status_history h where h.report_id in(select (value->>'id')::uuid from jsonb_array_elements(reports))) then raise exception 'Original history changed'; end if;
  if before_rules is distinct from(select jsonb_agg(to_jsonb(a) order by a.id) from public.organization_access_rules a join public.organizations o on o.id=a.organization_id where o.name in(select value->>'to' from jsonb_array_elements(offices))) then raise exception 'Destination permissions changed'; end if;
end $retire$;
select jsonb_build_object('active_offices',(select count(*) from public.organizations where active),
  'retired_offices',(select jsonb_agg(jsonb_build_object('name',name,'active',active)) from public.organizations where name in('Engineering assessment team','Environment assessment team')),
  'open_reports',(select jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'office',o.name)) from public.reports r join public.organizations o on o.id=r.organization_id where r.id in(${reports.map(r=>quote(r.id)).join(',')})),
  'pending_action_office',(select o.name from public.meeting_action_items a join public.organizations o on o.id=a.organization_id where a.id=${quote(plan.pending_meeting_action)}),
  'report_count',(select count(*) from public.reports),'history_count',(select count(*) from public.report_status_history),'assignment_count',(select count(*) from public.report_assignments)) as retirement_result;
commit;
`;
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/office-retirement.sql',sql);
writeFileSync('artifacts/office-retirement-rollback.sql',sql.replace(/commit;\s*$/,'rollback;\n'));
const reviewed=cases.reports.find(r=>r.key==='drainage:verified');
assert.match(reviewed.id,uuid);
writeFileSync('artifacts/office-retirement-stale-target-rollback.sql',`begin;
set local lock_timeout='5s';
do $test$
declare target uuid; rejected boolean;
begin
  perform set_config('request.jwt.claim.sub',${quote(actor)},true);
  for target in select id from public.organizations where name in('Engineering assessment team','Environment assessment team') loop
    rejected:=false;
    begin
      perform public.change_report(${quote(reviewed.id)},'assigned','Check rejection of a retired office target.',target);
      raise exception 'Retired office was unexpectedly accepted';
    exception when others then
      if sqlerrm='Office has no approved responsibility for this category and jurisdiction' then rejected:=true;
      else raise; end if;
    end;
    assert rejected,'Retired target must be rejected';
  end loop;
end $test$;
select 'Both retired targets rejected; no workflow update persisted' as result;
rollback;
`);
console.log('Prepared guarded office retirement and rollback rehearsal SQL: 2 offices, 2 open reports, 1 pending meeting action. No database changes made.');
