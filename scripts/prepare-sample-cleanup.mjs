// Default: prepare guarded SQL only. --remove-files removes the exact reviewed files first.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import assert from "node:assert/strict";
import {createClient} from "@supabase/supabase-js";
const m=JSON.parse(readFileSync("artifacts/sample-workspace-manifest.json","utf8"));
const photos=JSON.parse(readFileSync("data/sample-workspace/photos.json","utf8"));
assert.equal(m.version,"iligan-sample-workspace-v1");
assert.equal(m.reports.length,36);assert.equal(m.announcements.length,4);
if(existsSync("data/sample-workspace/linked-duplicates.json")) {
  const linked=JSON.parse(readFileSync("data/sample-workspace/linked-duplicates.json","utf8"));
  assert.equal(linked.version,"iligan-linked-duplicates-v1");
  assert.ok(m.reports.some(r=>r.id===linked.main_report_id));
  m.reports.push(...linked.reports.map(r=>({...r,mediaFolder:"linked-duplicates-v1"})));
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
assert.match(m.resident_id,uuid);assert.match(m.admin_id,uuid);
const groups={reports:m.reports,consultations:m.consultations,meeting_requests:m.requests,announcements:m.announcements};
for(const rows of Object.values(groups))for(const r of rows){assert.match(r.id,uuid);assert.ok(r.title.trim().length>0);}
const items=[...m.reports.map(r=>({...r,bucket:"report-evidence",prefix:`${m.resident_id}/${r.id}`})),
  ...m.announcements.map(r=>({...r,bucket:"announcement-media",prefix:r.id}))];
for(const item of items){assert.match(item.photo_key,/^[a-z]+$/);assert.ok(photos.some(p=>p.key===item.photo_key));item.path=`${item.prefix}/${item.mediaFolder||"sample-workspace-v1"}/${item.photo_key}.jpg`;}
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const targets=Object.entries(groups).flatMap(([kind,rows])=>rows.map(r=>`(${q(kind)},${q(r.id)}::uuid,${q(r.title)})`)).join(",");
const sql=`-- Exact manifest cleanup; review, remove files through Storage API, then execute as database owner.
begin;
set local lock_timeout='5s'; set local statement_timeout='30s';
select pg_advisory_xact_lock(hashtext('iligan-sample-workspace-v1'));
lock table public.reports,public.consultations,public.meeting_requests,public.announcements in share row exclusive mode;
create temporary table sample_targets(kind text,id uuid,title text) on commit drop;
insert into sample_targets values ${targets};
create temporary table sample_meetings on commit drop as select id from public.meetings where request_id in(select id from sample_targets where kind='meeting_requests');
create temporary table sample_comments on commit drop as select id from public.consultation_comments where consultation_id in(select id from sample_targets where kind='consultations');
do $guard$ declare target record; bad boolean; begin
  for target in select distinct kind from sample_targets loop
    execute format('select exists(select 1 from public.%I r join sample_targets t on t.id=r.id and t.kind=%L where not r.%I or r.title<>t.title)',target.kind,target.kind,case when target.kind='reports' then 'is_demo' else 'is_sample' end) into bad;
    if bad then raise exception 'Nonmatching or real root found in sample manifest; nothing deleted'; end if;
  end loop;
  if exists(select 1 from public.reports r join sample_targets t on t.id=r.id and t.kind='reports' where r.resident_id<>${q(m.resident_id)}::uuid) then raise exception 'Sample report owner changed; review before cleanup'; end if;
  if exists(select 1 from public.report_duplicate_links where canonical_id in(select id from sample_targets where kind='reports') and report_id not in(select id from sample_targets where kind='reports'))
    or exists(select 1 from public.consultations where report_id in(select id from sample_targets where kind='reports') and id not in(select id from sample_targets where kind='consultations'))
    or exists(select 1 from public.meeting_requests where (report_id in(select id from sample_targets where kind='reports') or consultation_id in(select id from sample_targets where kind='consultations')) and id not in(select id from sample_targets where kind='meeting_requests'))
    or exists(select 1 from public.consultation_comments where parent_id in(select id from sample_comments) and id not in(select id from sample_comments)) then raise exception 'Another record references a sample root; resolve it before cleanup'; end if;
  if exists(select 1 from storage.objects o join sample_targets t on
    (t.kind='reports' and o.bucket_id='report-evidence' and (o.name like ${q(m.resident_id) }||'/'||t.id::text||'/%' or o.name in(select path from public.report_attachments where report_id=t.id)))
    or (t.kind='announcements' and o.bucket_id='announcement-media' and (o.name like t.id::text||'/%' or o.name in(select attachment_path from public.announcements where id=t.id)))) then raise exception 'Associated files remain; use the Storage API before deleting database pointers'; end if;
end $guard$;
delete from public.notifications where report_id in(select id from sample_targets where kind='reports') or consultation_id in(select id from sample_targets where kind='consultations') or meeting_request_id in(select id from sample_targets where kind='meeting_requests') or announcement_id in(select id from sample_targets where kind='announcements');
delete from public.report_attachments where report_id in(select id from sample_targets where kind='reports');
delete from public.report_assessments where report_id in(select id from sample_targets where kind='reports');
delete from public.report_status_history where report_id in(select id from sample_targets where kind='reports');
delete from public.report_assignments where report_id in(select id from sample_targets where kind='reports');
delete from public.report_duplicate_links where report_id in(select id from sample_targets where kind='reports');
delete from public.report_followers where report_id in(select id from sample_targets where kind='reports');
delete from public.report_internal_notes where report_id in(select id from sample_targets where kind='reports');
delete from public.meeting_action_items where meeting_id in(select id from sample_meetings);
delete from public.meeting_participants where meeting_id in(select id from sample_meetings);
delete from public.meetings where id in(select id from sample_meetings);
delete from public.meeting_supporters where request_id in(select id from sample_targets where kind='meeting_requests');
delete from public.meeting_requests where id in(select id from sample_targets where kind='meeting_requests');
delete from public.comment_flags where comment_id in(select id from sample_comments);
delete from public.consultation_followers where consultation_id in(select id from sample_targets where kind='consultations');
delete from public.consultation_comments where id in(select id from sample_comments);
delete from public.consultations where id in(select id from sample_targets where kind='consultations');
delete from public.announcements where id in(select id from sample_targets where kind='announcements');
delete from public.reports where id in(select id from sample_targets where kind='reports');
delete from public.audit_logs a where exists(select 1 from sample_targets t where t.kind=a.entity and t.id::text=a.record_id)
  or (a.entity='meetings' and a.record_id in(select id::text from sample_meetings))
  or (a.entity='consultation_comments' and (a.record_id in(select id::text from sample_comments) or coalesce(a.old_value->>'consultation_id',a.new_value->>'consultation_id') in(select id::text from sample_targets where kind='consultations')))
  or (a.entity in('meeting_participants','meeting_action_items') and coalesce(a.old_value->>'meeting_id',a.new_value->>'meeting_id') in(select id::text from sample_meetings))
  or (a.entity in('report_attachments','report_status_history','report_assignments','report_duplicate_links','report_followers','report_internal_notes') and coalesce(a.old_value->>'report_id',a.new_value->>'report_id') in(select id::text from sample_targets where kind='reports'));
update public.analytics_settings set include_samples=false where include_samples and not exists(select 1 from public.reports where is_demo) and not exists(select 1 from public.consultations where is_sample) and not exists(select 1 from public.meeting_requests where is_sample) and not exists(select 1 from public.announcements where is_sample);
commit;
select 'Exact sample roots removed; account, office, reference and real records retained' as outcome;
`;
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/remove-sample-workspace.sql",sql);
if(process.argv.includes("--remove-files")){
  const env=Object.fromEntries(readFileSync("web/.env.local","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).trim()]));
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,"https://kbihklfbqhmtowcqojir.supabase.co","Unexpected project; no file removal attempted");
  const accounts=JSON.parse(readFileSync(".env.demo.json","utf8"));
  assert.equal(accounts.resident.id,m.resident_id);assert.equal(accounts.admin.id,m.admin_id);
  const make=()=>createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const resident=make(),admin=make();
  const data=async promise=>{const r=await promise;if(r.error)throw new Error(r.error.message);return r.data;};
  try{
    for(const [key,client]of[["resident",resident],["admin",admin]])await data(client.auth.signInWithPassword({email:accounts[key].email,password:accounts[key].password}));
    assert.ok((await data(admin.from("analytics_settings").select("include_samples").single())).include_samples,"Sample mode must remain enabled during file removal");
    for(const [table,expected,flag]of[["reports",m.reports,"is_demo"],["announcements",m.announcements,"is_sample"]]){
      const rows=await data(admin.from(table).select(`id,title,${flag}${table==='reports'?',resident_id':''}`).in("id",expected.map(r=>r.id)));
      assert.equal(rows.length,expected.length,"Some sample roots are missing; review before removing files");
      for(const r of rows)assert.ok(r[flag]&&r.title===expected.find(e=>e.id===r.id).title,"Refusing files belonging to a nonmatching root");
      if(table==='reports')for(const r of rows)assert.equal(r.resident_id,m.resident_id,"Sample report owner changed");
    }
    const attachments=await data(admin.from("report_attachments").select("report_id,path,source_url,is_illustrative").in("report_id",m.reports.map(r=>r.id)));
    for(const a of attachments){const item=items.find(i=>i.id===a.report_id),photo=photos.find(p=>p.key===item.photo_key);assert.ok(a.path===item.path&&a.is_illustrative&&a.source_url===photo.source_url,"Unrecognized sample attachment; review before removing files");}
    for(const [bucket,client]of[["report-evidence",resident],["announcement-media",admin]]){
      const paths=items.filter(i=>i.bucket===bucket).map(i=>i.path);await data(client.storage.from(bucket).remove(paths));
      for(const path of paths){const slash=path.lastIndexOf('/'),rows=await data(client.storage.from(bucket).list(path.slice(0,slash),{search:path.slice(slash+1)}));assert.ok(!rows.some(r=>r.name===path.slice(slash+1)),"A sample file still exists");}
    }
    console.log("Verified absence of the 40 exact sample file paths. Database rows remain; review and execute the prepared SQL separately.");
  }catch(error){console.error("Sample file cleanup failed or incomplete; database rows were NOT deleted.");throw error;}
  finally{await Promise.all([resident,admin].map(c=>c.auth.signOut({scope:"local"})));}
}else console.log("Prepared artifacts/remove-sample-workspace.sql only. No database or Storage changes made.");
