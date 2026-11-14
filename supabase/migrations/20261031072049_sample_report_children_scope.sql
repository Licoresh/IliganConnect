-- Privileged parent lookups bypass report SELECT policies, so child reads need the same sample scope.
create policy history_sample_scope on public.report_status_history as restrictive for select to authenticated
  using (private.sample_report_visible(report_id));
create policy assignment_sample_scope on public.report_assignments as restrictive for select to authenticated
  using (private.sample_report_visible(report_id));
create policy note_sample_scope on public.report_internal_notes as restrictive for select to authenticated
  using (private.sample_report_visible(report_id));
create policy follower_sample_scope on public.report_followers as restrictive for select to authenticated
  using (private.sample_report_visible(report_id));
create policy duplicate_sample_scope on public.report_duplicate_links as restrictive for select to authenticated
  using (private.sample_report_visible(report_id) and private.sample_report_visible(canonical_id));
