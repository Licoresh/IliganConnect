// Read-only verification of the saved cases and every uploaded illustration.
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {createClient} from "@supabase/supabase-js";
const env=Object.fromEntries(readFileSync("web/.env.local","utf8").split(/\r?\n/)
  .filter(line=>line.includes("=")&&!line.trim().startsWith("#"))
  .map(line=>[line.slice(0,line.indexOf("=")),line.slice(line.indexOf("=")+1).trim()]));
const manifest=JSON.parse(readFileSync("artifacts/sample-workspace-manifest.json","utf8"));
const photos=JSON.parse(readFileSync("data/sample-workspace/photos.json","utf8"));
const base=JSON.parse(readFileSync(".env.demo.json","utf8"));
const scoped=JSON.parse(readFileSync(".env.rbac-demo.json","utf8"));
const make=()=>createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=make(),resident=make(),outside=make(),anonymous=make();
let checks=0;
const reportStatuses=new Set(["submitted","under_review","verified","assigned","scheduled","in_progress","resolved","rejected","duplicate"]);
function check(value,label){assert.ok(value,label);checks++;}
async function data(query){const r=await query;assert.ifError(r.error);return r.data;}
try{
  const logins=await Promise.allSettled([[admin,base.admin],[resident,base.resident],[outside,scoped.tibanga]].map(async([client,a])=>data(client.auth.signInWithPassword({email:a.email,password:a.password}))));
  for(const r of logins)assert.equal(r.status,"fulfilled","Sample verification login failed");
  const reports=await data(admin.from("reports").select("id,title,description,public_summary,landmark,status,is_demo,latitude,longitude,organization_id,purok,zone,location_source,location_accuracy,location_address,severity,urgency").in("id",manifest.reports.map(r=>r.id)));
  const assessments=await data(admin.from("report_assessments").select("report_id,severity,urgency,note").in("report_id",manifest.reports.map(r=>r.id)));
  const organizations=await data(admin.from("organizations").select("id,name"));
  check(reports.length===36,"All reviewed sample cases are saved");
  for(const expected of manifest.reports){
    const saved=reports.find(r=>r.id===expected.id);
    check(saved?.is_demo&&saved.title===expected.title&&reportStatuses.has(saved.status),"Sample title and current workflow status are valid");
    check(!/\b(sample|demo|fictional|simulated|temporary)\b/i.test([saved.title,saved.description,saved.public_summary,saved.landmark].join(" ")),"Prepared case copy has no presentation labels");
    check(saved.latitude===expected.latitude&&saved.longitude===expected.longitude,"Saved scenario pin matches its reviewed coordinates");
    check(saved.purok===expected.purok&&saved.zone===expected.zone&&saved.location_source==="coordinates","Prepared address and coordinate source match");
    check(saved.location_accuracy===null&&saved.location_address===null,"No device accuracy or detected address is implied");
    const history=assessments.filter(row=>row.report_id===saved.id);
    check(saved.urgency===(expected.urgency??null)&&saved.severity===(expected.urgency==null?null:expected.severity),"Official ratings match the reviewed scenario state");
    check(expected.urgency==null ? history.length===0 : history.length===1&&history[0].severity===expected.severity&&history[0].urgency===expected.urgency&&history[0].note===expected.assessment_note,"Scenario assessment history matches the current ratings and rationale");
    check(saved.organization_id===(expected.organization?organizations.find(o=>o.name===expected.organization)?.id:null),"Saved case routes to its reviewed temporary office");
  }
  const attachments=await data(admin.from("report_attachments").select("report_id,path,source_url,attribution,is_illustrative").in("report_id",reports.map(r=>r.id)));
  check(attachments.length===36,"Every sample report has a connected photograph");
  const signed=await data(admin.storage.from("report-evidence").createSignedUrls(attachments.map(a=>a.path),60));
  let index=0;
  const downloads=await Promise.allSettled(Array.from({length:4},async()=>{
    while(index<attachments.length){
      const a=attachments[index++],entry=signed.find(s=>s.path===a.path),record=manifest.reports.find(r=>r.id===a.report_id),photo=photos.find(p=>p.key===record.photo_key);
      check(a.is_illustrative&&a.source_url===photo.source_url&&a.attribution===photo.attribution,"Illustration provenance matches its source");
      const response=await fetch(entry.signedUrl);
      check(response.ok,"Authorized signed image downloads");
      const bytes=Buffer.from(await response.arrayBuffer());
      check(createHash("sha256").update(bytes).digest("hex")===photo.sha256,"Stored photograph bytes match the optimized original");
    }
  }));
  for(const r of downloads)if(r.status==="rejected")throw r.reason;
  const published=reports.find(r=>r.status==="resolved"&&manifest.reports.find(m=>m.id===r.id).barangay!=="Tibanga");
  const shared=attachments.find(a=>a.report_id===published.id);
  const visible=await data(outside.from("report_attachments").select("path").eq("path",shared.path));
  check(visible.length===1,"Another active jurisdiction can read a published sample illustration");
  const illustration=await data(outside.storage.from("report-evidence").createSignedUrl(shared.path,30));
  check((await fetch(illustration.signedUrl)).ok,"Published sample photo signs outside its private report scope");
  const privateReport=manifest.reports.find(r=>r.status==="submitted"&&r.barangay!=="Tibanga");
  const hidden=attachments.find(a=>a.report_id===privateReport.id);
  check(!!(await outside.storage.from("report-evidence").createSignedUrl(hidden.path,30)).error,"Unpublished sample illustration remains scoped");
  check(!!(await anonymous.storage.from("report-evidence").download(shared.path)).error,"Anonymous illustration download is denied");
  const updates=await data(admin.from("announcements").select("id,attachment_path,is_sample,body,status").in("id",manifest.announcements.map(a=>a.id)));
  check(updates.length===4,"All reviewed community updates are saved");
  for(const update of updates){
    const expected=manifest.announcements.find(a=>a.id===update.id),photo=photos.find(p=>p.key===expected.photo_key);
    check(update.is_sample&&update.status===expected.status&&update.attachment_path&&!update.body.includes(photo.source_url)&&!update.body.includes(photo.attribution),"Update status and image are connected without embedded photo credits");
    const url=await data(admin.storage.from("announcement-media").createSignedUrl(update.attachment_path,30));
    check((await fetch(url.signedUrl)).ok,"Announcement image downloads");
  }
  console.log(`Sample workspace verification passed: ${checks}; all 36 case images and 4 update images are connected. No records changed.`);
}finally{await Promise.all([admin,resident,outside].map(client=>client.auth.signOut({scope:"local"})));}
