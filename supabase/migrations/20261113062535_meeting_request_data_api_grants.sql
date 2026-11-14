-- Keep meeting requests column-scoped and limit row visibility through RLS.
-- The web list now selects coordination_status; expose that field to authenticated staff/residents.
revoke all privileges on table public.meeting_requests from public, anon, authenticated;

grant select (
  id,
  barangay_id,
  title,
  body,
  consultation_id,
  status,
  decision_reason,
  created_at,
  category_id,
  report_id,
  is_sample,
  coordination_status
) on table public.meeting_requests to authenticated;

grant update (status, decision_reason)
  on table public.meeting_requests to authenticated;
