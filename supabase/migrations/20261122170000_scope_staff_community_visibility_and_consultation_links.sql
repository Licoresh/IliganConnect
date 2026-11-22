-- Staff see conversations and meetings only when their role is included in the scope.
-- Residents continue to see public conversations and approved open meetings.

drop policy consultations_read on public.consultations;
create policy consultations_read on public.consultations
  for select to authenticated
  using (
    private.consultation_scope_access(id)
    or (private.active_resident() and status in ('open', 'closed'))
  );

alter policy meetings_read on public.meetings using (
  private.meeting_access(request_id)
  or private.meeting_invited_office_access(request_id)
  or private.meeting_request_invited_barangay_access(request_id)
  or private.meeting_participant_access(id, request_id)
  or (
    private.active_resident()
    and exists (
      select 1 from public.meeting_requests r
      where r.id = request_id
        and r.status = 'approved'
        and r.participation_mode = 'open'
    )
  )
);

create or replace function private.validate_consultation_related_report()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles;
  v_report public.reports;
  v_barangays uuid[];
  v_organizations uuid[];
begin
  if new.report_id is null then
    return new;
  end if;

  select * into v_profile
  from public.profiles
  where id = (select auth.uid()) and account_status = 'active';
  if v_profile.id is null or v_profile.role not in ('admin', 'barangay', 'office') then
    raise exception 'An active staff account is required to link a report';
  end if;

  select * into v_report from public.reports where id = new.report_id;
  if v_report.id is null then
    raise exception 'The related report is unavailable';
  end if;

  v_barangays := coalesce(nullif(new.target_barangay_ids, '{}'::uuid[]), array[new.barangay_id]);
  if not (v_report.barangay_id = any(v_barangays)) then
    raise exception 'The related report must be in a selected consultation barangay';
  end if;

  if v_profile.role = 'barangay' then
    if v_report.barangay_id <> v_profile.barangay_id then
      raise exception 'Barangay staff can only link a report from their assigned barangay';
    end if;
  elsif v_profile.role = 'office' then
    v_organizations := coalesce(nullif(new.target_organization_ids, '{}'::uuid[]),
      case when new.organization_id is null then '{}'::uuid[] else array[new.organization_id] end);
    if not exists (
      select 1
      from unnest(v_organizations) as selected(organization_id)
      join public.organization_memberships m on m.organization_id = selected.organization_id
        and m.user_id = v_profile.id
      join public.organizations o on o.id = selected.organization_id
        and o.active and o.can_consult
      join public.organization_access_rules a on a.organization_id = o.id
        and a.enabled and a.category_id = v_report.category_id
        and (a.barangay_id is null or a.barangay_id = v_report.barangay_id)
        and (not a.assignment_only or v_report.organization_id = o.id)
    ) then
      raise exception 'The related report is outside your office category or barangay permissions';
    end if;
  end if;

  return new;
end
$function$;

revoke all on function private.validate_consultation_related_report() from public, anon, authenticated;
drop trigger if exists consultation_related_report_scope on public.consultations;
create trigger consultation_related_report_scope
  before insert or update of report_id, barangay_id, organization_id, target_barangay_ids, target_organization_ids
  on public.consultations
  for each row execute function private.validate_consultation_related_report();

notify pgrst, 'reload schema';
