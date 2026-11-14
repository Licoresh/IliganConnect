import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
const env=Object.fromEntries(readFileSync('web/.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const manifest=JSON.parse(readFileSync('data/sample-workspace/linked-duplicates.json','utf8'));
const accounts=JSON.parse(readFileSync('.env.demo.json','utf8'));
const photo=JSON.parse(readFileSync('data/sample-workspace/photos.json','utf8')).find(p=>p.key==='drainage');
const make=()=>createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=make(),resident=make();let checks=0;
const data=async q=>{const r=await q;if(r.error)throw r.error;return r.data;};
const check=(v,m)=>{assert.ok(v,m);checks++;};
try{
  for(const [db,account]of [[admin,accounts.admin],[resident,accounts.resident]])await data(db.auth.signInWithPassword({email:account.email,password:account.password}));
  const main=await data(admin.from('reports').select('id,status,organization_id,purok,zone,latitude,longitude').eq('id',manifest.main_report_id).single());
  const linked=await data(admin.rpc('report_linked_duplicates',{p_id:main.id,p_offset:0}));
  check(linked.total_count===4&&linked.items.length===4,'Four confirmed duplicates must be attached');
  const office=await data(admin.from('organizations').select('name').eq('id',main.organization_id).single());
  for(const item of manifest.reports){
    const row=await data(resident.from('reports').select('id,title,status,is_demo,purok,zone,latitude,longitude,location_source,urgency').eq('id',item.id).single());
    check(row.is_demo&&row.status==='duplicate'&&row.title===item.title,'Linked source identity/classification');
    check(!!main.purok&&!!main.zone&&row.purok===main.purok&&row.zone===main.zone&&row.latitude===main.latitude&&row.longitude===main.longitude&&row.location_source==='coordinates','Linked source has the same prepared location');
    check(row.urgency===null,'Duplicate has no independent official urgency');
    const progress=await data(resident.rpc('report_duplicate_progress',{p_id:item.id}));
    check(progress.main_report_id===main.id&&progress.status===main.status&&progress.organization_name===office.name,'Canonical progress and office');
    check(progress.history.every(h=>Object.keys(h).every(k=>['id','new_status','created_at'].includes(k))),'Main history is a safe status projection');
    const attachment=await data(resident.from('report_attachments').select('path,is_illustrative,source_url').eq('report_id',item.id).single());
    check(attachment.is_illustrative&&attachment.source_url===photo.source_url,'Illustration provenance');
    const blob=await data(resident.storage.from('report-evidence').download(attachment.path));
    check(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex')===photo.sha256,'Licensed illustration hash');
  }
  console.log(`Linked duplicate verification passed: ${checks}; four confirmed links, main progress and licensed images. No records changed.`);
}finally{await Promise.all([admin,resident].map(db=>db.auth.signOut({scope:'local'})));}
