import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';

assert.ok(process.argv.includes('--load-linked-examples'),'Use --load-linked-examples for the approved prepared records');
const env=Object.fromEntries(readFileSync('web/.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,'https://kbihklfbqhmtowcqojir.supabase.co');
const manifest=JSON.parse(readFileSync('data/sample-workspace/linked-duplicates.json','utf8'));
const account=JSON.parse(readFileSync('.env.demo.json','utf8')).resident;
const photo=JSON.parse(readFileSync('data/sample-workspace/photos.json','utf8')).find(p=>p.key==='drainage');
const bytes=readFileSync(photo.file),hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(bytes),photo.sha256);
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const data=async q=>{const r=await q;if(r.error)throw new Error(r.error.message);return r.data;};
try {
  await data(db.auth.signInWithPassword({email:account.email,password:account.password}));
  for(const item of manifest.reports){
    const row=await data(db.from('reports').select('id,title,status,is_demo,resident_id').eq('id',item.id).single());
    assert.ok(row.is_demo&&row.status==='duplicate'&&row.title===item.title&&row.resident_id===account.id,'Refusing edited or non-prepared report');
    const progress=await data(db.rpc('report_duplicate_progress',{p_id:row.id}));assert.equal(progress.main_report_id,manifest.main_report_id);
    const path=`${account.id}/${item.id}/linked-duplicates-v1/drainage.jpg`;
    const upload=await db.storage.from('report-evidence').upload(path,bytes,{contentType:'image/jpeg',upsert:false});
    if(upload.error){
      if(String(upload.error.statusCode)!=='409'&&!/already exists|duplicate/i.test(upload.error.message))throw upload.error;
      const existing=await data(db.storage.from('report-evidence').download(path));assert.equal(hash(Buffer.from(await existing.arrayBuffer())),photo.sha256,'Existing image differs; refusing overwrite');
    }
    const attachment=await data(db.from('report_attachments').select('source_url,is_illustrative').eq('path',path).maybeSingle());
    if(attachment)assert.ok(attachment.is_illustrative&&attachment.source_url===photo.source_url);
    else await data(db.from('report_attachments').insert({report_id:item.id,path,source_url:photo.source_url,attribution:photo.attribution,is_illustrative:true}));
  }
  console.log('Verified four linked report illustrations with original source/license metadata.');
}finally{await db.auth.signOut();}
