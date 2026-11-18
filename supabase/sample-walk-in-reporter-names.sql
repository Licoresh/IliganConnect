-- Synthetic reporter names for the sample-only walk-in reports.
-- Safe to rerun: inserts only missing reporter details for demo walk-in records.
with reporter_names(title, reporter_name) as (
  values
    ('Private driveway marker reported as a missing road sign', 'Ramil Arturo Layson'),
    ('Overflowing waste container at the transport stop', 'Marites Carandang Macaraya'),
    ('Illegal dumping beside the creek access path', 'Jose Miguel Pabalan'),
    ('Waste bags remained after collection', 'Carmela Joy Abad'),
    ('Eroded shoulder near the terminal approach', 'Nestor Magsalin Balinte'),
    ('Cracked pavement at the market approach', 'Alvin Santos Lumasag'),
    ('Pothole widening near the Tibanga access road', 'Rhea Mae Dela Cruz'),
    ('Leaning streetlight fixture received follow-up', 'Rogelio Tan Macaraya'),
    ('Streetlight out along the pedestrian route', 'Maria Cristina Omandam'),
    ('Faded crossing markings at the junction', 'Joel Patrick Salcedo'),
    ('Drainage report from the same market location', 'Ana Katrina Saclot'),
    ('Sediment reducing flow through a drainage grate', 'Edgar Jose Lumbatan'),
    ('Blocked drainage scheduled for clearing', 'Liza Mae Dela Vega'),
    ('Detached cable over part of the footpath', 'Mark Anthony Quiazon'),
    ('Low-hanging wires near a school crossing', 'Jocelyn Rose Tabamo'),
    ('Missing directional sign at the junction', 'Arnel Datu Baladjay'),
    ('Drainage backs up beside the market', 'Cecilia Navarro Lagtapon')
)
insert into private.walk_in_reporter_details(report_id, reporter_name, reporter_contact, created_by)
select
  reports.id,
  names.reporter_name,
  null,
  reports.created_by
from public.reports as reports
join reporter_names as names on names.title = reports.title
where reports.submission_source = 'walk_in'
  and reports.is_demo
  and not exists (
    select 1 from private.walk_in_reporter_details as details
    where details.report_id = reports.id
  )
on conflict (report_id) do nothing;
