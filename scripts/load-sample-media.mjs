// Explicitly loads attributed illustrations onto the reviewed sample dataset only.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const removePhotoCaptions = process.argv.includes("--remove-photo-captions");
assert.ok(removePhotoCaptions || process.argv.includes("--load-samples"), "Use --load-samples or --remove-photo-captions for the reviewed sample workspace");
const env = Object.fromEntries(readFileSync("web/.env.local", "utf8").split(/\r?\n/)
  .filter(line => line.includes("=") && !line.trim().startsWith("#"))
  .map(line => [line.slice(0,line.indexOf("=")),line.slice(line.indexOf("=")+1).trim()]));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,"https://kbihklfbqhmtowcqojir.supabase.co","Unexpected sample project");
const accounts = JSON.parse(readFileSync(".env.demo.json","utf8"));
const manifest = JSON.parse(readFileSync("artifacts/sample-workspace-manifest.json","utf8"));
const photos = JSON.parse(readFileSync("data/sample-workspace/photos.json","utf8"));
assert.equal(manifest.version,"iligan-sample-workspace-v1");
assert.equal(manifest.reports.length,36);
assert.equal(manifest.announcements.length,4);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
for (const photo of photos) {
  assert.ok(/^https:\/\//.test(photo.source_url) && photo.attribution && photo.attribution.length<=1200);
  photo.bytes = readFileSync(photo.file);
  assert.equal(hash(photo.bytes),photo.sha256,"Source illustration changed");
  assert.ok(photo.bytes.length<5*1024*1024 && photo.bytes[0]===255 && photo.bytes[1]===216,"Expected bounded JPEG");
}
const make = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}});
const resident=make(),admin=make();
async function data(query) { const r=await query;if(r.error)throw new Error(r.error.message);return r.data; }
async function ensureFile(client,bucket,path,photo) {
  const response=await client.storage.from(bucket).upload(path,photo.bytes,{contentType:"image/jpeg",cacheControl:"3600",upsert:false});
  if (!response.error) return;
  if (String(response.error.statusCode)!=="409" && !/already exists|duplicate/i.test(response.error.message)) throw new Error(response.error.message);
  const existing=await data(client.storage.from(bucket).download(path));
  assert.equal(hash(Buffer.from(await existing.arrayBuffer())),photo.sha256,"Existing sample path contains a different image; refusing overwrite");
}
try {
  await data(admin.auth.signInWithPassword({email:accounts.admin.email,password:accounts.admin.password}));
  if (removePhotoCaptions) {
    let removed=0;
    for (const item of manifest.announcements) {
      const photo=photos.find(p=>p.key===item.photo_key);
      assert.ok(photo,"Missing attributed photograph");
      const saved=await data(admin.from("announcements").select("id,title,is_sample,body,attachment_path").eq("id",item.id).single());
      assert.ok(saved.is_sample && saved.title===item.title,"Refusing non-sample announcement");
      const path=`${item.id}/sample-workspace-v1/${photo.key}.jpg`;
      assert.equal(saved.attachment_path,path,"Refusing to edit an announcement with a different image");
      const credit=`${photo.attribution}\nSource and license: ${photo.source_url} · ${photo.license_url}`;
      const suffix=`\n\n${credit}`;
      const hasCredit=saved.body.includes(photo.source_url) || saved.body.includes(photo.attribution);
      if(hasCredit) assert.ok(saved.body.endsWith(suffix),"Unexpected photo-credit copy; refusing to rewrite announcement text");
      const body=saved.body.endsWith(suffix)?saved.body.slice(0,-suffix.length).trimEnd():saved.body;
      if(body!==saved.body){
        await data(admin.from("announcements").update({body}).eq("id",item.id));
        removed++;
      }
      const verified=await data(admin.from("announcements").select("body").eq("id",item.id).single());
      assert.ok(!verified.body.includes(photo.source_url) && !verified.body.includes(photo.attribution),"Photo credit copy remains in announcement text");
    }
    console.log(`Removed embedded photo credit copy from ${removed} prepared announcements; image and provenance records were left unchanged.`);
  } else {
    await data(resident.auth.signInWithPassword({email:accounts.resident.email,password:accounts.resident.password}));
    const settings=await data(admin.from("analytics_settings").select("include_samples").single());
    assert.ok(settings.include_samples,"Enable the reviewed sample dataset before loading its media");
    const reports=await data(admin.from("reports").select("id,title,resident_id,is_demo").in("id",manifest.reports.map(r=>r.id)));
    assert.equal(reports.length,36,"Seed the exact case manifest first");
    for(const r of reports) assert.ok(r.is_demo && r.title===manifest.reports.find(item=>item.id===r.id)?.title && r.resident_id===accounts.resident.id,"Refusing non-sample case");
    const items=[...manifest.reports.map(r=>({...r,kind:"report"})),...manifest.announcements.map(r=>({...r,kind:"announcement"}))];
    let index=0,completed=0;
    const results=await Promise.allSettled(Array.from({length:4},async()=>{
      while(index<items.length) {
        const item=items[index++],photo=photos.find(p=>p.key===item.photo_key);
        assert.ok(photo,"Missing attributed photograph");
        if(item.kind==="report") {
          const path=`${accounts.resident.id}/${item.id}/sample-workspace-v1/${photo.key}.jpg`;
          await ensureFile(resident,"report-evidence",path,photo);
          const existing=await data(resident.from("report_attachments").select("id,source_url,is_illustrative").eq("path",path).maybeSingle());
          if(existing) assert.ok(existing.is_illustrative && existing.source_url===photo.source_url,"Existing attachment provenance differs");
          else await data(resident.from("report_attachments").insert({report_id:item.id,path,
            source_url:photo.source_url,attribution:photo.attribution,is_illustrative:true}));
        } else {
          const saved=await data(admin.from("announcements").select("id,title,is_sample,body,attachment_path").eq("id",item.id).single());
          assert.ok(saved.is_sample && saved.title===item.title,"Refusing non-sample announcement");
          const path=`${item.id}/sample-workspace-v1/${photo.key}.jpg`;
          assert.ok(!saved.attachment_path || saved.attachment_path===path,"Refusing to replace another attachment");
          await ensureFile(admin,"announcement-media",path,photo);
          const credit=`${photo.attribution}\nSource and license: ${photo.source_url} · ${photo.license_url}`;
          const suffix=`\n\n${credit}`;
          const hasCredit=saved.body.includes(photo.source_url) || saved.body.includes(photo.attribution);
          if(hasCredit) assert.ok(saved.body.endsWith(suffix),"Unexpected photo-credit copy; refusing to rewrite announcement text");
          const body=saved.body.endsWith(suffix)?saved.body.slice(0,-suffix.length).trimEnd():saved.body;
          if(saved.attachment_path!==path || body!==saved.body)
            await data(admin.from("announcements").update({attachment_path:path,body}).eq("id",item.id));
        }
        completed++;
      }
    }));
    const failed=results.filter(r=>r.status==="rejected");
    if(failed.length) throw new AggregateError(failed.map(r=>r.reason),"Sample media loading incomplete; rerun safely after correcting the reported error");
    console.log(`Loaded and connected ${completed} sample images (36 reports, 4 announcements). Existing matching files are reused.`);
  }
} finally {
  await Promise.all([resident,admin].map(client=>client.auth.signOut({scope:"local"})));
}
