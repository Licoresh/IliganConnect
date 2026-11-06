-- Suggest a nearby barangay only after the existing Iligan city check succeeds.
-- Keep exact-match fields unchanged for older clients.
create or replace function public.resolve_report_location(p_latitude double precision,p_longitude double precision)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  point extensions.geometry;
  matches uuid[];
  matched_name text;
  city text;
  nearest_id uuid;
  nearest_name text;
  nearest_distance double precision;
begin
  if auth.uid() is null or not (private.active_staff() or private.active_resident()) then raise exception 'Sign in with an active account to check a location.'; end if;
  if p_latitude is null or p_longitude is null or not (p_latitude between -90 and 90) or not (p_longitude between -180 and 180) then raise exception 'Choose a valid location on the map.'; end if;
  point := extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326);
  select array_agg(b.id order by b.psgc_code),min(b.name) into matches,matched_name from public.barangays b where extensions.st_covers(b.boundary,point);
  city := case when cardinality(matches)>0 or exists(select 1 from private.city_boundary c where extensions.st_covers(c.boundary,point)) then 'inside'
    when exists(select 1 from private.city_boundary c where extensions.st_dwithin(c.boundary::extensions.geography,point::extensions.geography,25)) then 'unknown' else 'outside' end;
  if city='inside' and coalesce(cardinality(matches),0)<>1 then
    select b.id,b.name,extensions.st_distance(b.boundary::extensions.geography,point::extensions.geography)
      into nearest_id,nearest_name,nearest_distance
      from public.barangays b
      where b.boundary is not null and not extensions.st_isempty(b.boundary)
      order by extensions.st_distance(b.boundary::extensions.geography,point::extensions.geography),b.psgc_code,b.id
      limit 1;
  end if;
  return jsonb_build_object('city',city,
    'barangay_id',case when cardinality(matches)=1 then matches[1] end,
    'barangay',case when cardinality(matches)=1 then matched_name end,
    'suggested_barangay_id',nearest_id,'suggested_barangay',nearest_name,
    'suggested_distance_m',nearest_distance,
    'address',case when city='inside' then case when cardinality(matches)=1 then matched_name || ', ' else '' end || 'Iligan City' else '' end,
    'source','PSGC (2023) and OpenStreetMap boundaries; indicative');
end $$;
revoke all on function public.resolve_report_location(double precision,double precision) from public,anon;
grant execute on function public.resolve_report_location(double precision,double precision) to authenticated;

