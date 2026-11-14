// Generate reviewed SQL for existing presentation records. This script never connects to Supabase.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const { reports } = JSON.parse(readFileSync("data/sample-workspace/cases.json", "utf8"));
const linked = JSON.parse(readFileSync("data/sample-workspace/linked-duplicates.json", "utf8"));
const { resident, admin } = JSON.parse(readFileSync(".env.demo.json", "utf8"));
const main = reports.find(report => report.id === linked.main_report_id);
assert.ok(main && reports.length === 36 && linked.reports.length === 4);

const targets = [
  ...reports.map(report => ({
    ...report,
    severity: report.urgency == null ? null : report.severity,
  })),
  ...linked.reports.map(report => ({
    ...main,
    ...report,
    status: "duplicate",
    severity: null,
    urgency: null,
    assessment_note: null,
    canonical_id: main.id,
  })),
];
assert.equal(new Set(targets.map(report => report.id)).size, 40);
assert.equal(targets.filter(report => report.urgency != null).length, 24);
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const sql = `-- Enrich the exact prepared report fixtures in place.
-- Purok, Zone and ratings are illustrative; coordinates are the existing fixture inputs.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('iligan-sample-workspace-v1'));
select pg_advisory_xact_lock(hashtext('iligan-linked-duplicates-v1'));
lock table public.reports in share row exclusive mode;
select set_config('request.jwt.claim.sub', ${quote(admin.id)}, true);
create temporary table sample_enrichment on commit drop as
select * from jsonb_to_recordset(${quote(JSON.stringify(targets))}::jsonb)
  as x(id uuid,title text,category text,barangay text,status public.report_status,
       latitude float8,longitude float8,purok text,zone text,severity int,urgency int,
       assessment_note text,canonical_id uuid);

do $guard$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin' and account_status='active') then
    raise exception 'Expected presentation administrator is unavailable';
  end if;
  if exists(
    select 1 from sample_enrichment x
    left join public.reports r on r.id=x.id
    left join public.report_categories c on c.id=r.category_id
    left join public.barangays b on b.id=r.barangay_id
    left join public.report_duplicate_links l on l.report_id=r.id
    where r.id is null or not r.is_demo or r.resident_id<>${quote(resident.id)}::uuid
      or r.title is distinct from x.title or c.name is distinct from x.category
      or b.name is distinct from x.barangay or r.status is distinct from x.status
      or r.latitude is distinct from x.latitude or r.longitude is distinct from x.longitude
      or r.severity is distinct from x.severity or l.canonical_id is distinct from x.canonical_id
      or (r.purok is not null and r.purok<>x.purok)
      or (r.zone is not null and r.zone<>x.zone)
      or (r.location_source is not null and r.location_source<>'coordinates')
      or (r.urgency is not null and r.urgency is distinct from x.urgency)
  ) then
    raise exception 'Prepared report identities or current values differ. Review before enrichment';
  end if;
  if exists(
    select 1 from sample_enrichment x join public.report_assessments a on a.report_id=x.id
    group by x.id,x.severity,x.urgency,x.assessment_note
    having count(*)<>1 or bool_or(a.severity is distinct from x.severity
      or a.urgency is distinct from x.urgency or a.note is distinct from x.assessment_note)
  ) then
    raise exception 'Existing assessment history differs. Review before enrichment';
  end if;
end $guard$;

update public.reports r
set purok=x.purok, zone=x.zone, location_source='coordinates', urgency=x.urgency
from sample_enrichment x
where r.id=x.id and (r.purok is null or r.zone is null or r.location_source is null
  or r.urgency is distinct from x.urgency);

-- Record new fixture assessments at enrichment time, including already resolved cases.
insert into public.report_assessments(report_id,actor_id,severity,urgency,note)
select x.id,auth.uid(),x.severity,x.urgency,x.assessment_note from sample_enrichment x
where x.urgency is not null and not exists(select 1 from public.report_assessments a where a.report_id=x.id);

select count(*) as enriched_locations, count(r.urgency) as rated_reports,
       count(a.id) as assessment_events
from sample_enrichment x join public.reports r on r.id=x.id
left join public.report_assessments a on a.report_id=r.id
where r.purok=x.purok and r.zone=x.zone and r.location_source='coordinates'
  and r.urgency is not distinct from x.urgency;
`;

mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/sample-report-enrichment.sql", sql + "commit;\n");
writeFileSync("artifacts/sample-report-enrichment-rehearsal.sql", sql + "rollback;\n");
console.log("Prepared guarded enrichment for 40 locations and 24 assessments.");
