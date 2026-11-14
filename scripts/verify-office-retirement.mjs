// Read-only checks for complete office removal, reconciled work and unchanged scope.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const env=Object.fromEntries(readFileSync('web/.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const cases=JSON.parse(readFileSync('data/sample-workspace/cases.json','utf8'));
const plan=JSON.parse(readFileSync('data/office-retirement.json','utf8'));
const realAdmin=JSON.parse(readFileSync('.env.admin.json','utf8'));
const base=JSON.parse(readFileSync('.env.demo.json','utf8'));
const scoped=JSON.parse(readFileSync('.env.rbac-demo.json','utf8'));
const accounts={admin:realAdmin,engineer:scoped.engineer,cenro:scoped.cenro,retired:base.office};
const clients=Object.fromEntries(Object.keys(accounts).map(k=>[k,createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}})]));
let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
async function data(query){const r=await query;assert.ifError(r.error);return r.data;}
try{
 await Promise.all(Object.entries(accounts).map(([k,a])=>data(clients[k].auth.signInWithPassword({email:a.email,password:a.password}))));
 const admin=clients.admin;
 const offices=await data(admin.from('organizations').select('id,name,active'));
 const office=name=>offices.find(o=>o.name===name);
 check(offices.length===6&&offices.every(o=>o.active),'Exactly six offices remain with no inactive copies');
 for(const p of plan.offices)check(!offices.some(o=>o.id===p.from_id||o.name===p.from)&&office(p.to)?.active===true,'Removed office identity is absent and its destination remains active');
 const oldIds=plan.offices.map(p=>p.from_id);
 const retiredRules=await data(admin.from('organization_access_rules').select('enabled').in('organization_id',oldIds));
 check(retiredRules.length===0,'Legacy rules are deleted');
 check((await data(admin.from('organization_memberships').select('organization_id').in('organization_id',oldIds))).length===0,'Obsolete memberships are removed without transferring access');
 const deletions=await data(admin.from('audit_logs').select('record_id').eq('entity','organizations').eq('action','DELETE').in('record_id',oldIds));
 check(new Set(deletions.map(r=>r.record_id)).size===2,'Deletion of both offices is audited');
 const destinationRules=await data(admin.from('organization_access_rules').select('organization_id,enabled').in('organization_id',plan.offices.map(p=>office(p.to).id)));
 check(destinationRules.length===3&&destinationRules.every(r=>r.enabled),'Existing destination scopes are preserved');
 for(const p of plan.open_reports){
  const expected=cases.reports.find(r=>r.key===p.key);
  const saved=await data(admin.from('reports').select('id,status,organization_id').eq('id',expected.id).single());
  check(saved.organization_id===office(p.to).id&&saved.status==='in_progress','Open work keeps its progress under the receiving office');
  const history=await data(admin.from('report_status_history').select('id,new_status').eq('report_id',saved.id));
  check(history.length===4&&['under_review','verified','assigned','in_progress'].every(s=>history.some(h=>h.new_status===s)),'Original progress history remains');
  const assignments=await data(admin.from('report_assignments').select('organization_id,actor_id,reason').eq('report_id',saved.id).order('id',{ascending:false}));
  check(assignments.length===2&&assignments[0].organization_id===office(p.to).id&&assignments[0].actor_id===realAdmin.id,'New handoff has administrator attribution');
  check(assignments[1].organization_id===office(p.to).id,'Earlier assignment reference is reconciled to the surviving office');
  const client=p.to==='City Engineer'?clients.engineer:clients.cenro;
  const permissions=await data(client.rpc('report_permissions',{p_id:saved.id}));
  check(permissions.read&&permissions.update,'Receiving office can read and progress its report');
  const other=p.to==='City Engineer'?clients.cenro:clients.engineer;
  const denied=await data(other.from('reports').select('id').eq('id',saved.id));
  check(denied.length===0,'Handoff does not expand another office category scope');
 }
 const closed=cases.reports.find(r=>r.key==='streetlights:resolved');
 const archivedReport=await data(admin.from('reports').select('status,organization_id').eq('id',closed.id).single());
 check(archivedReport.status==='resolved'&&archivedReport.organization_id===office('City Engineer').id,'Closed engineering case remains resolved under City Engineer');
 const archivedConsultation=await data(admin.from('consultations').select('status,organization_id').eq('id','5702f899-f801-519a-aa00-d1d860d3ef72').single());
 check(archivedConsultation.status==='closed'&&archivedConsultation.organization_id===office('CENRO').id,'Closed consultation remains closed under CENRO');
 const action=await data(clients.cenro.from('meeting_action_items').select('id,meeting_id,organization_id,completed').eq('id',plan.pending_meeting_action).single());
 check(!action.completed&&action.organization_id===office('CENRO').id,'CENRO can access its unfinished follow-up');
 const participants=await data(admin.from('meeting_participants').select('organization_id').eq('meeting_id',action.meeting_id));
 check(participants.length===1&&participants[0].organization_id===office('CENRO').id,'Meeting participation is consolidated without duplicate entries');
 const completed=cases.actions.find(a=>a.meeting_id===action.meeting_id&&a.completed);
 const originalAction=await data(admin.from('meeting_action_items').select('organization_id,completed').eq('id',completed.id).single());
 check(originalAction.completed&&originalAction.organization_id===office('CENRO').id,'Completed action stays completed under CENRO');
 const choices=await Promise.all(cases.reports.filter(r=>r.status==='verified').map(async r=>({key:r.key,rows:await data(admin.rpc('referral_options',{p_id:r.id}))})));
 for(const c of choices)check(c.rows.every(o=>!plan.offices.some(p=>p.from===o.name)),'Retired names are excluded from live referral options');
 check(choices.find(c=>c.key==='drainage:verified').rows.some(o=>o.name==='City Engineer'),'Drainage keeps City Engineer as an eligible destination');
 check(choices.find(c=>c.key==='garbage:verified').rows.some(o=>o.name==='CENRO'),'Waste keeps CENRO as an eligible destination');
 const retiredContext=await data(clients.retired.rpc('staff_context'));
 check(!retiredContext?.authorized,'Retired team membership does not retain staff authorization');
 check((await data(clients.retired.from('reports').select('id'))).length===0,'Retired team cannot read private reports');
 check((await data(clients.retired.rpc('public_reports'))).length===0,'Retired-only membership cannot discover published reports');
 check((await data(clients.retired.rpc('public_report_by_id',{p_id:closed.id}))).length===0,'Retired-only membership cannot use direct published lookup');
 for(const [table,count] of [['reports',40],['report_status_history',94],['report_assignments',20]]){const r=await admin.from(table).select('id',{count:'exact',head:true});assert.ifError(r.error);check(r.count===count,'Reviewed inventory and history counts are preserved');}
 console.log(`Office removal verification passed: ${checks}; six surviving offices, reconciled references, preserved progress and scoped access. No records changed.`);
}finally{await Promise.all(Object.values(clients).map(c=>c.auth.signOut({scope:'local'})));}
