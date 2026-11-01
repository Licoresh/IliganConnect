-- Keep category IDs, report history, routing and permissions intact.
update public.report_categories set name='Drainage'
where lower(trim(name)) in ('drainage problem','drainage problems');
-- These reference categories also need to exist on a fresh database before seed.sql.
insert into public.report_categories(name) values ('Drainage'),('Garbage and waste concerns'),
('Damaged roads and potholes'),('Broken or defective streetlights'),
('Hazardous, tangled, or obsolete wires'),('Missing or damaged road signs and markings')
on conflict(name) do nothing;

create table public.report_problem_types (
  category_id uuid not null references public.report_categories(id),
  code text not null,
  label text not null,
  sort_order integer not null,
  primary key (category_id,code)
);
alter table public.report_problem_types enable row level security;
revoke all on public.report_problem_types from public,anon,authenticated;
grant select on public.report_problem_types to authenticated;
create policy read_problem_types on public.report_problem_types for select to authenticated using (true);

insert into public.report_problem_types(category_id,code,label,sort_order)
select c.id,t.code,t.label,t.sort_order from public.report_categories c join (values
 ('Drainage','clogged_blocked','Clogged or Blocked Drainage',1),
 ('Drainage','overflowing','Overflowing Drainage',2),
 ('Drainage','damaged_broken','Damaged or Broken Drainage',3),
 ('Drainage','misdirected_flow','Misdirected Water Flow',4),
 ('Drainage','stagnant_water','Stagnant Water',5),
 ('Drainage','open_uncovered','Open or Uncovered Drainage',6),
 ('Drainage','leakage','Drainage Leakage',7),
 ('Garbage and waste concerns','uncollected','Uncollected Garbage',1),
 ('Garbage and waste concerns','illegal_dumping','Illegal Dumping',2),
 ('Garbage and waste concerns','overflowing_bin','Overflowing Waste Bin',3),
 ('Garbage and waste concerns','scattered_waste','Scattered Waste or Litter',4),
 ('Garbage and waste concerns','burning_waste','Burning of Waste',5),
 ('Garbage and waste concerns','hazardous_waste','Suspected Hazardous Waste',6),
 ('Damaged roads and potholes','pothole','Pothole',1),
 ('Damaged roads and potholes','cracked_surface','Cracked Road Surface',2),
 ('Damaged roads and potholes','uneven_surface','Uneven or Sunken Road',3),
 ('Damaged roads and potholes','eroded_edge','Eroded Road Edge',4),
 ('Damaged roads and potholes','damaged_pavement','Broken or Damaged Pavement',5),
 ('Broken or defective streetlights','not_working','Streetlight Not Working',1),
 ('Broken or defective streetlights','flickering','Flickering or Intermittent Light',2),
 ('Broken or defective streetlights','dim_light','Dim Streetlight',3),
 ('Broken or defective streetlights','daytime_light','Light Stays On During Daytime',4),
 ('Broken or defective streetlights','damaged_fixture','Damaged Light Fixture',5),
 ('Broken or defective streetlights','damaged_pole','Damaged or Leaning Pole',6),
 ('Hazardous, tangled, or obsolete wires','low_hanging','Low-Hanging Wires',1),
 ('Hazardous, tangled, or obsolete wires','fallen_wire','Fallen or Detached Wires',2),
 ('Hazardous, tangled, or obsolete wires','tangled','Tangled or Overcrowded Wires',3),
 ('Hazardous, tangled, or obsolete wires','exposed','Exposed or Damaged Wiring',4),
 ('Hazardous, tangled, or obsolete wires','sparking','Sparking or Burning Wires',5),
 ('Hazardous, tangled, or obsolete wires','obsolete','Abandoned or Obsolete Wires',6),
 ('Missing or damaged road signs and markings','missing_sign','Missing Road Sign',1),
 ('Missing or damaged road signs and markings','damaged_sign','Damaged Road Sign',2),
 ('Missing or damaged road signs and markings','obstructed_sign','Obstructed or Unreadable Sign',3),
 ('Missing or damaged road signs and markings','faded_markings','Faded Road Markings',4),
 ('Missing or damaged road signs and markings','missing_markings','Missing Road Markings',5),
 ('Missing or damaged road signs and markings','incorrect_sign','Incorrect or Misplaced Sign',6)
) as t(category,code,label,sort_order) on c.name=t.category;
insert into public.report_problem_types(category_id,code,label,sort_order)
select distinct category_id,'other','Others (Please Specify)',99 from public.report_problem_types;

alter table public.reports
  add column problem_type text,
  add column problem_other text,
  add constraint reports_problem_category_fk foreign key(category_id,problem_type)
    references public.report_problem_types(category_id,code),
  add constraint reports_problem_other_check check (
    (problem_type='other' and problem_other is not null and length(btrim(problem_other)) between 1 and 240)
    or (problem_type is distinct from 'other' and problem_other is null)
  );
create index reports_problem_type on public.reports(category_id,problem_type,created_at desc)
where problem_type is not null;
comment on column public.reports.problem_type is 'Resident-selected problem code; NULL on legacy reports without subtype. Scoped to category_id.';
comment on column public.reports.problem_other is 'Private resident description for Others, separate from the general report description.';

create function private.validate_report_problem() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  new.problem_other := nullif(btrim(new.problem_other),'');
  if exists(select 1 from public.report_problem_types where category_id=new.category_id)
     and new.problem_type is null then
    raise exception 'Choose the specific problem for this category.' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.validate_report_problem() from public,anon,authenticated;
create trigger validate_report_problem before insert or update of category_id,problem_type,problem_other
on public.reports for each row execute function private.validate_report_problem();

-- Replace the old signature to avoid ambiguous PostgREST overloads.
-- Defaults retain the call shape for old clients, while validation requires new subtypes.
drop function public.submit_report(uuid,uuid,uuid,text,text,double precision,double precision,text);
create function public.submit_report(
  p_id uuid,p_category uuid,p_barangay uuid,p_title text,p_description text,
  p_latitude double precision,p_longitude double precision,p_landmark text default '',
  p_problem_type text default null,p_problem_other text default null
) returns uuid language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_id::text));
  if exists(select 1 from public.reports where id=p_id and resident_id=auth.uid()) then return p_id; end if;
  insert into public.reports(id,category_id,barangay_id,title,description,latitude,longitude,landmark,problem_type,problem_other)
  values(p_id,p_category,p_barangay,p_title,p_description,p_latitude,p_longitude,p_landmark,p_problem_type,p_problem_other);
  return p_id;
end $$;
revoke execute on function public.submit_report(uuid,uuid,uuid,text,text,double precision,double precision,text,text,text) from public,anon;
grant execute on function public.submit_report(uuid,uuid,uuid,text,text,double precision,double precision,text,text,text) to authenticated;
notify pgrst,'reload schema';
