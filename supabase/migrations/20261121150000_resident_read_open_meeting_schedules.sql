alter policy meetings_read on public.meetings using (
  private.meeting_access(request_id)
  or private.meeting_invited_office_access(request_id)
  or private.meeting_participant_access(id, request_id)
  or (
    private.active_resident()
    and exists (
      select 1
      from public.meeting_requests r
      where r.id = request_id
        and r.status = 'approved'
        and r.participation_mode = 'open'
    )
  )
);
