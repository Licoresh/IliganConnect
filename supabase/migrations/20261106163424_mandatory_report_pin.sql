set local lock_timeout = '5s';

-- Purok/Zone/directions supplement a report pin; they are not a substitute.
alter table public.reports drop constraint reports_manual_location_details;

create or replace function private.check_report_city() returns trigger
language plpgsql security definer set search_path='' as $$
declare point extensions.geometry;
begin
  if new.latitude is null or new.longitude is null
    or not (new.latitude between -90 and 90)
    or not (new.longitude between -180 and 180) then
    raise exception 'Pinpoint the issue on the map or use your current location before submitting.' using errcode='23514';
  end if;
  point := extensions.st_setsrid(extensions.st_makepoint(new.longitude,new.latitude),4326);
  if not exists(select 1 from public.barangays b where extensions.st_covers(b.boundary,point))
    and not exists(select 1 from private.city_boundary c where extensions.st_covers(c.boundary,point)) then
    raise exception 'This pin is outside the mapped Iligan area. Check the pin or contact support if the boundary is incorrect.';
  end if;
  return new;
end $$;
revoke all on function private.check_report_city() from public,anon,authenticated;

-- Existing report_city_boundary fires on INSERT and coordinate edits. Keeping
-- columns nullable preserves historical rows; status-only updates do not move pins.
comment on column public.reports.latitude is 'Report latitude; mandatory for new reports. NULL is retained only for historical address-only reports.';
comment on column public.reports.longitude is 'Report longitude; mandatory for new reports. NULL is retained only for historical address-only reports.';
notify pgrst,'reload schema';
