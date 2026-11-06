-- Synthetic fixtures can use approximate coordinates, but their saved point must
-- still fall within the barangay to which the demo report is assigned.
-- Repair only explicitly demo-marked records; resident-submitted records remain untouched.
do $$
declare
  repaired_count integer;
begin
  with misplaced_demo_reports as materialized (
    select
      r.id,
      b.boundary
    from public.reports r
    join public.barangays b on b.id = r.barangay_id
    where (r.is_demo = true or (r.title like '[DEMO]%' and r.description ilike '%synthetic%'))
      and b.boundary is not null
      and not extensions.st_covers(
        b.boundary,
        extensions.st_setsrid(extensions.st_makepoint(r.longitude, r.latitude), 4326)
      )
  ),
  sampled_points as materialized (
    select
      target.id,
      extensions.st_setsrid(
        extensions.st_makepoint(
          extensions.st_x(extensions.st_pointn(extensions.st_exteriorring(extensions.st_envelope(target.boundary)), 1))
            + (extensions.st_x(extensions.st_pointn(extensions.st_exteriorring(extensions.st_envelope(target.boundary)), 2))
              - extensions.st_x(extensions.st_pointn(extensions.st_exteriorring(extensions.st_envelope(target.boundary)), 1))) * grid_x.x / 64.0,
          extensions.st_y(extensions.st_pointn(extensions.st_exteriorring(extensions.st_envelope(target.boundary)), 1))
            + (extensions.st_y(extensions.st_pointn(extensions.st_exteriorring(extensions.st_envelope(target.boundary)), 3))
              - extensions.st_y(extensions.st_pointn(extensions.st_exteriorring(extensions.st_envelope(target.boundary)), 1))) * grid_y.y / 64.0
        ),
        4326
      ) as point,
      md5(target.id::text || ':' || grid_x.x::text || ':' || grid_y.y::text) as sample_order
    from misplaced_demo_reports target
    cross join generate_series(0, 64) as grid_x(x)
    cross join generate_series(0, 64) as grid_y(y)
  ),
  ranked_points as (
    select
      sample.id,
      sample.point,
      row_number() over (partition by sample.id order by sample.sample_order) as point_order
    from sampled_points sample
    join misplaced_demo_reports target on target.id = sample.id
    where extensions.st_covers(target.boundary, sample.point)
  )
  update public.reports r
  set longitude = extensions.st_x(candidate.point),
      latitude = extensions.st_y(candidate.point)
  from ranked_points candidate
  where candidate.id = r.id
    and candidate.point_order = 1;

  get diagnostics repaired_count = row_count;

  if exists (
    select 1
    from public.reports r
    join public.barangays b on b.id = r.barangay_id
    where (r.is_demo = true or (r.title like '[DEMO]%' and r.description ilike '%synthetic%'))
      and b.boundary is not null
      and not extensions.st_covers(
        b.boundary,
        extensions.st_setsrid(extensions.st_makepoint(r.longitude, r.latitude), 4326)
      )
  ) then
    raise exception 'Some synthetic report locations could not be placed inside their assigned barangay.';
  end if;

  raise notice 'Repaired % misplaced synthetic report locations.', repaired_count;
end $$;
