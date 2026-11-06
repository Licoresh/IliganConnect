set local lock_timeout = '5s';

-- Detailed addresses remain part of the private report, governed by existing RLS.
alter table public.reports
  alter column latitude drop not null,
  alter column longitude drop not null,
  add column purok text,
  add column zone text,
  add column location_address text,
  add column location_source text,
  add column location_accuracy double precision,
  add constraint reports_coordinate_pair check ((latitude is null)=(longitude is null)),
  add constraint reports_location_source check (location_source in ('manual','gps','pin','coordinates')),
  add constraint reports_location_required check (latitude is not null or coalesce(location_source='manual',false)),
  add constraint reports_manual_location_details check (location_source is distinct from 'manual' or
    coalesce(nullif(btrim(purok,E' \t\n\r'),''),nullif(btrim(zone,E' \t\n\r'),''),nullif(btrim(landmark,E' \t\n\r'),'')) is not null),
  add constraint reports_purok_input_limits check (private.valid_input_text(purok,0,80)),
  add constraint reports_zone_input_limits check (private.valid_input_text(zone,0,80)),
  add constraint reports_location_address_input_limits check (private.valid_input_text(location_address,0,500)),
  add constraint reports_location_accuracy check (location_accuracy is null or
    (location_source is not distinct from 'gps' and location_accuracy between 0 and 100000));

comment on column public.reports.purok is 'Resident-provided Purok; private report details, not inferred from coordinates.';
comment on column public.reports.zone is 'Resident-provided Zone; private report details, not inferred from coordinates.';
comment on column public.reports.landmark is 'Optional resident-provided street, landmark, house number or other directions.';
comment on column public.reports.location_address is 'Detected locality/address for resident confirmation; not a verified Purok or Zone.';
comment on column public.reports.location_source is 'manual, gps, pin or coordinates; NULL denotes a legacy coordinate report.';
comment on column public.reports.location_accuracy is 'Device-reported GPS accuracy in metres, when available; not a verified precision claim.';

create or replace function private.check_report_city() returns trigger
language plpgsql security definer set search_path='' as $$
declare point extensions.geometry;
begin
  -- Never create a synthetic map pin for a manual address.
  if new.latitude is null and new.longitude is null and new.location_source='manual' then return new; end if;
  if new.latitude is null or new.longitude is null then
    raise exception 'Provide both coordinates or choose manual location details.' using errcode='23514';
  end if;
  point := extensions.st_setsrid(extensions.st_makepoint(new.longitude,new.latitude),4326);
  if not exists(select 1 from public.barangays b where extensions.st_covers(b.boundary,point))
    and not exists(select 1 from private.city_boundary c where extensions.st_covers(c.boundary,point)) then
    raise exception 'This pin is outside the mapped Iligan area. Check the pin or contact support if the boundary is incorrect.';
  end if;
  return new;
end $$;
revoke all on function private.check_report_city() from public,anon,authenticated;

-- One signature avoids ambiguous PostgREST overloads; defaults preserve old clients.
drop function public.submit_report(uuid,uuid,uuid,text,text,double precision,double precision,text,text,text);
create function public.submit_report(
  p_id uuid,p_category uuid,p_barangay uuid,p_title text,p_description text,
  p_latitude double precision,p_longitude double precision,p_landmark text default '',
  p_problem_type text default null,p_problem_other text default null,
  p_purok text default null,p_zone text default null,p_location_source text default null,
  p_location_accuracy double precision default null,p_location_address text default null
) returns uuid language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_id::text));
  if exists(select 1 from public.reports where id=p_id and resident_id=auth.uid()) then return p_id; end if;
  insert into public.reports(id,category_id,barangay_id,title,description,latitude,longitude,landmark,problem_type,problem_other,
    purok,zone,location_source,location_accuracy,location_address)
  values(p_id,p_category,p_barangay,p_title,p_description,p_latitude,p_longitude,coalesce(p_landmark,''),p_problem_type,p_problem_other,
    nullif(btrim(p_purok),''),nullif(btrim(p_zone),''),p_location_source,p_location_accuracy,nullif(btrim(p_location_address),''));
  return p_id;
end $$;
revoke execute on function public.submit_report(uuid,uuid,uuid,text,text,double precision,double precision,text,text,text,text,text,text,double precision,text) from public,anon;
grant execute on function public.submit_report(uuid,uuid,uuid,text,text,double precision,double precision,text,text,text,text,text,text,double precision,text) to authenticated;

-- Coordinate-less reports stay in the scoped report list, never in pin/heat layers.
create or replace function public.map_reports(west float8,south float8,east float8,north float8,
  category uuid default null,barangay uuid default null,report_state public.report_status default null,
  since timestamptz default null,until timestamptz default null,verified_only boolean default false,
  unresolved_only boolean default false,office uuid default null,recurring_only boolean default false)
returns setof public.reports language sql stable security invoker set search_path='' as $$
  select r.* from public.reports r
  where private.active_staff()
    and (r.location is null or extensions.st_intersects(r.location::extensions.geometry,extensions.st_makeenvelope(west,south,east,north,4326)))
    and (category is null or r.category_id=category) and (barangay is null or r.barangay_id=barangay)
    and (report_state is null or r.status=report_state) and (since is null or r.created_at>=since)
    and (until is null or r.created_at<until) and (not verified_only or r.verified_at is not null)
    and (not unresolved_only or r.status not in ('resolved','rejected','duplicate'))
    and (office is null or r.organization_id=office) and r.status not in ('rejected','duplicate')
    and (not recurring_only or exists(select 1 from public.reports x cross join public.analytics_settings settings
      where x.id<>r.id and x.category_id=r.category_id and x.status not in ('rejected','duplicate')
        and abs(extract(epoch from r.created_at-x.created_at))<=settings.window_days*86400
        and extensions.st_dwithin(r.location,x.location,settings.radius_m)))
  order by r.created_at desc limit 1000
$$;
revoke execute on function public.map_reports(float8,float8,float8,float8,uuid,uuid,public.report_status,timestamptz,timestamptz,boolean,boolean,uuid,boolean) from public,anon;
grant execute on function public.map_reports(float8,float8,float8,float8,uuid,uuid,public.report_status,timestamptz,timestamptz,boolean,boolean,uuid,boolean) to authenticated;

-- Public RPCs already use an explicit projection with rounded coordinates. NULL
-- coordinates remain NULL; Purok/Zone/directions/address/accuracy are never projected.
notify pgrst,'reload schema';
