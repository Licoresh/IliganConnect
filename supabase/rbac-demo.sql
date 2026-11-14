-- Run after scripts/prepare-rbac-demo.mjs and its generated local provisioning SQL.
-- Synthetic records only; no inferred administrative or national-road boundaries.
insert into public.reports(resident_id,category_id,problem_type,barangay_id,title,description,latitude,longitude,status,verified_at,severity,organization_id,is_demo)
select p.id,c.id,(select code from public.report_problem_types where category_id=c.id order by sort_order limit 1),b.id,'[DEMO RBAC] '||b.name||' / '||c.name,
 'Synthetic authorization fixture only. No real defect or government responsibility is asserted.',
 extensions.st_y(extensions.st_pointonsurface(b.boundary)),extensions.st_x(extensions.st_pointonsurface(b.boundary)),'assigned',now(),2,
 (select o.id from public.organizations o where o.name=case
 when c.name='Damaged roads and potholes' then 'DEMO RBAC — DPWH'
 when c.name in ('Hazardous, tangled, or obsolete wires','Broken or defective streetlights') then 'DEMO RBAC — Utility provider'
 when c.name='Garbage and waste concerns' then 'DEMO RBAC — CENRO'
 when c.name='Drainage' then 'DEMO RBAC — City Engineer'
 else 'DEMO RBAC — City Traffic' end),true
from public.report_categories c cross join public.barangays b cross join lateral(
 select pr.id from public.profiles pr join auth.users u on u.id=pr.id
 where pr.role='resident' and u.raw_user_meta_data->>'is_demo'='true' order by u.created_at limit 1)p
where b.name in ('Tibanga','Poblacion') and not exists(select 1 from public.reports r where r.title='[DEMO RBAC] '||b.name||' / '||c.name);
