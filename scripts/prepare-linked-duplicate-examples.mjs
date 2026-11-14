import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const cases=JSON.parse(readFileSync('data/sample-workspace/cases.json','utf8'));
const accounts=JSON.parse(readFileSync('.env.demo.json','utf8'));
const main=cases.reports.find(r=>r.key==='drainage:in_progress');
assert.ok(main,'Expected the prepared drainage case');
const manifest={version:'iligan-linked-duplicates-v1',main_report_id:main.id,reports:[
  {id:'c75e07c2-c055-4c8d-9398-4b5ea2a5b231',title:'Drainage blockage beside the pedestrian crossing'},
  {id:'6a6963bd-f2e5-4f2e-9ce2-7414eb415fc6',title:'Water collecting above the same blocked drain'},
  {id:'fdc88622-8660-47df-bde4-55453053e134',title:'Blocked drainage affecting access to nearby homes'},
  {id:'9dd0ce92-b61d-45c4-a1aa-4d945f5ee604',title:'Standing water along the drainage crossing'},
].map((r,i)=>({...r,photo_key:'drainage',description:'Water is collecting at the drainage crossing and obstructing safe pedestrian access. This submission describes the same blocked section already under maintenance review.',reason:'Reviewed the location, problem and evidence. This submission describes the same drainage blockage tracked on the main report.',days_after:i+1}))};
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const sql=`begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(hashtext('iligan-linked-duplicates-v1'));
do $examples$
declare main public.reports; item jsonb; owner_id uuid:=${quote(accounts.resident.id)}; admin_id uuid:=${quote(accounts.admin.id)}; target uuid;
begin
  select * into strict main from public.reports where id=${quote(main.id)} and is_demo and resident_id=owner_id and title=${quote(main.title)};
  if main.status<>'in_progress' then raise exception 'Prepared main report has changed; review before loading examples';end if;
  if not private.sample_data_enabled() then raise exception 'Enable presentation records first';end if;
  for item in select value from jsonb_array_elements(${quote(JSON.stringify(manifest.reports))}::jsonb) loop
    target:=(item->>'id')::uuid;
    if exists(select 1 from public.reports where id=target) then
      if not exists(select 1 from public.reports r join public.report_duplicate_links l on l.report_id=r.id where r.id=target and r.is_demo and r.resident_id=owner_id and r.title=item->>'title' and l.canonical_id=main.id) then raise exception 'Existing linked example differs; refusing overwrite';end if;
      continue;
    end if;
    perform set_config('request.jwt.claim.sub',owner_id::text,true);set local role authenticated;
    perform public.submit_report(target,main.category_id,main.barangay_id,item->>'title',item->>'description',
      main.latitude,main.longitude,main.landmark,main.problem_type,main.problem_other,main.purok,main.zone,'coordinates');
    reset role;
    update public.reports set is_demo=true,created_at=main.created_at+make_interval(days=>(item->>'days_after')::integer) where id=target;
    perform set_config('request.jwt.claim.sub',admin_id::text,true);set local role authenticated;
    perform public.change_report(target,'duplicate',item->>'reason',null,null,main.id);reset role;
    update public.report_status_history set created_at=main.created_at+make_interval(days=>(item->>'days_after')::integer)+interval '1 hour' where report_id=target;
  end loop;
end $examples$;
commit;
select 'Prepared main report has four linked duplicate submissions' as result;
`;
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/linked-duplicate-examples.sql',sql);
writeFileSync('data/sample-workspace/linked-duplicates.json',JSON.stringify(manifest,null,2)+'\n');
console.log('Prepared four exact, internally marked linked duplicates; existing records are never overwritten.');
