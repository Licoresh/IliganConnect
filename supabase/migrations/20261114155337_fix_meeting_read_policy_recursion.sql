-- Avoid re-entering the meetings policy through meeting_participants.
create function private.meeting_participant_access(p_meeting uuid, p_request uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (private.active_resident() and exists (
    select 1 from public.meeting_requests r where r.id = p_request and r.resident_id = (select auth.uid())
  )) or exists (
    select 1
    from public.meeting_participants mp
    join public.organization_memberships m on m.organization_id = mp.organization_id
    join public.organizations o on o.id = m.organization_id and o.active
    join public.profiles p on p.id = m.user_id and p.role = 'office' and p.account_status = 'active'
    where mp.meeting_id = p_meeting and p.id = (select auth.uid())
  );
$$;

revoke all on function private.meeting_participant_access(uuid, uuid) from public, anon;
grant execute on function private.meeting_participant_access(uuid, uuid) to authenticated;

alter policy meetings_read on public.meetings using (
  private.meeting_access(request_id)
  or private.meeting_invited_office_access(request_id)
  or private.meeting_participant_access(id, request_id)
);
