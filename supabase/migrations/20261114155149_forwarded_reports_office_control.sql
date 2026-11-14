-- Barangay staff keep visibility after handoff, but write control moves to the assigned office.
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
            and (not a.assignment_only or org.id=o)
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

comment on function private.report_access(uuid,uuid,uuid,text) is
  'Report reads remain scoped to the barangay and eligible offices. Once organization_id is set, only that office and admins can review, update, or refer; barangay read access remains.';

notify pgrst,'reload schema';
