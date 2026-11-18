-- Office users can read reports in their approved category and barangay scope.
-- Review, referral, progress and resolution still require assignment to that office.
create or replace function private.report_access(
  b uuid,
  c uuid,
  o uuid,
  action text default 'read'
) returns boolean
language sql stable security definer set search_path=''
as $$
select exists(
  select 1
  from public.profiles p
  where p.id=auth.uid() and p.account_status='active'
    and (
      p.role='admin'
      or (
        p.role='barangay' and p.barangay_id=b
        and (action='read' or (o is null and action in ('review','update','refer')))
      )
      or (
        p.role='office' and exists(
          select 1
          from public.organization_memberships m
          join public.organizations org on org.id=m.organization_id and org.active
          join public.organization_access_rules a on a.organization_id=org.id and a.enabled
          where m.user_id=p.id and a.category_id=c
            and (a.barangay_id is null or a.barangay_id=b)
            and (action='read' or org.id=o)
            and case action
              when 'read' then true
              when 'review' then a.can_review
              when 'update' then a.can_update
              when 'refer' then a.can_refer
              else false
            end
        )
      )
    )
)
$$;

-- Category-wide read access must not expose staff-only notes to unassigned offices.
drop policy notes_staff_read on public.report_internal_notes;
create policy notes_staff_read on public.report_internal_notes for select to authenticated using(
  private.report_action(report_id,'update')
  or private.report_action(report_id,'review')
  or private.report_action(report_id,'refer')
  or exists(
    select 1 from public.reports r join public.profiles p on p.id=auth.uid()
    where r.id=report_internal_notes.report_id and p.role='barangay'
      and p.account_status='active' and p.barangay_id=r.barangay_id
  )
);

-- Reporter names and contact details remain visible only to the responsible office,
-- the report's barangay, and administrators.
create or replace function private.report_identity_access(p_id uuid) returns boolean
language sql stable security definer set search_path=''
as $$
select private.is_admin()
  or exists(
    select 1 from public.reports r join public.profiles p on p.id=auth.uid()
    where r.id=p_id and p.role='barangay' and p.account_status='active'
      and p.barangay_id=r.barangay_id
  )
  or exists(
    select 1
    from public.reports r
    join public.profiles p on p.id=auth.uid() and p.role='office' and p.account_status='active'
    join public.organization_memberships m on m.user_id=p.id and m.organization_id=r.organization_id
    join public.organizations org on org.id=m.organization_id and org.active
    join public.organization_access_rules a on a.organization_id=org.id and a.enabled
      and a.category_id=r.category_id and (a.barangay_id is null or a.barangay_id=r.barangay_id)
    where r.id=p_id and r.organization_id is not null
  )
$$;
revoke all on function private.report_identity_access(uuid) from public,anon,authenticated;

create or replace function private.report_residents(p_ids uuid[],p_contact boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(cardinality(p_ids),0)>20 then raise exception 'Request up to 20 reports'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'report_id',r.id,
    'resident_name',case when private.report_identity_access(r.id)
      then coalesce(walkin.reporter_name,resident.display_name)
      when r.submission_source='walk_in' then 'Walk-in report' else 'Resident' end,
    'submission_source',r.submission_source,
    'created_by_name',case when private.report_identity_access(r.id) then coalesce(walkin_creator.display_name,creator.display_name) else null end,
    'registered_barangay_id',case when private.report_identity_access(r.id) then resident.barangay_id else null end,
    'submission_barangay_id',case when private.report_identity_access(r.id) then r.resident_barangay_id else null end,
    'assigned_to_name',case when private.report_identity_access(r.id) then handler.display_name else null end,
    'email',case when p_contact and r.submission_source='resident' and private.report_identity_access(r.id)
      then u.email else null end,
    'reporter_contact',case when p_contact and r.submission_source='walk_in' and private.report_identity_access(r.id)
      then walkin.reporter_contact else null end))
    from public.reports r left join public.profiles resident on resident.id=r.resident_id
    left join auth.users u on u.id=resident.id
    left join public.profiles creator on creator.id=r.created_by
    left join private.walk_in_reporter_details walkin on walkin.report_id=r.id
    left join public.profiles walkin_creator on walkin_creator.id=walkin.created_by
    left join public.profiles handler on handler.id=r.assigned_to
    where r.id=any(p_ids) and private.report_action(r.id) and private.sample_report_visible(r.id)),'[]'::jsonb);
end $$;

-- Add an optional organization filter to category totals so an office map can
-- show only work routed to its own organizations.
drop function public.map_barangay_category_counts(uuid,public.report_status,timestamptz,timestamptz);
create function public.map_barangay_category_counts(
  p_barangay uuid default null,
  p_report_state public.report_status default null,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_office uuid default null
)
returns table(
  barangay_id uuid,
  barangay_name text,
  category_id uuid,
  category_name text,
  report_count bigint
)
language sql stable security invoker set search_path=''
as $$
  select b.id, b.name, c.id, c.name, count(r.id)
  from public.barangays b
  join public.reports r on r.barangay_id=b.id
    and r.status not in ('rejected','duplicate')
    and (p_report_state is null or r.status=p_report_state)
    and (p_since is null or r.created_at>=p_since)
    and (p_until is null or r.created_at<p_until)
    and (p_office is null or r.organization_id=p_office)
  join public.report_categories c on c.id=r.category_id
  where private.active_staff()
    and (p_barangay is null or b.id=p_barangay)
  group by b.id,b.name,c.id,c.name
  order by b.name,c.name
$$;
revoke execute on function public.map_barangay_category_counts(uuid,public.report_status,timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.map_barangay_category_counts(uuid,public.report_status,timestamptz,timestamptz,uuid) to authenticated;

notify pgrst,'reload schema';
