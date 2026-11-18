create index if not exists meeting_action_items_meeting_id
  on public.meeting_action_items(meeting_id);

drop policy meetings_staff on public.meetings;
create policy meetings_staff_insert on public.meetings
  for insert to authenticated
  with check (
    private.meeting_schedule_access(request_id)
    and exists (
      select 1 from public.meeting_requests r
      where r.id = request_id and r.status = 'approved'
    )
  );
create policy meetings_staff_update on public.meetings
  for update to authenticated
  using (private.meeting_schedule_access(request_id))
  with check (
    private.meeting_schedule_access(request_id)
    and exists (
      select 1 from public.meeting_requests r
      where r.id = request_id and r.status = 'approved'
    )
  );
create policy meetings_staff_delete on public.meetings
  for delete to authenticated
  using (private.meeting_schedule_access(request_id));

drop policy actions_staff on public.meeting_action_items;
drop policy actions_office_update on public.meeting_action_items;
create policy actions_staff_insert on public.meeting_action_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.meetings m
      join public.meeting_requests r on r.id = m.request_id and r.status = 'approved'
      where m.id = meeting_id
        and private.meeting_request_decision_access(m.request_id)
    )
  );
create policy actions_staff_update on public.meeting_action_items
  for update to authenticated
  using (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id
        and private.meeting_request_decision_access(m.request_id)
    )
    or private.meeting_office_action_access(meeting_id, organization_id)
  )
  with check (
    exists (
      select 1 from public.meetings m
      join public.meeting_requests r on r.id = m.request_id and r.status = 'approved'
      where m.id = meeting_id
        and private.meeting_request_decision_access(m.request_id)
    )
    or private.meeting_office_action_access(meeting_id, organization_id)
  );
create policy actions_staff_delete on public.meeting_action_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id
        and private.meeting_request_decision_access(m.request_id)
    )
  );
