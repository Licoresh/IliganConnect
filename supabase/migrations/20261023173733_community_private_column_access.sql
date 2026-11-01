revoke select on public.report_status_history,public.consultation_comments,public.meeting_requests from authenticated;
grant select(id,report_id,old_status,new_status,public_note,created_at) on public.report_status_history to authenticated;
grant select(id,consultation_id,body,parent_id,hidden,created_at) on public.consultation_comments to authenticated;
grant select(id,barangay_id,title,body,consultation_id,status,decision_reason,created_at) on public.meeting_requests to authenticated;
drop policy assignment_read on public.report_assignments;
create policy assignment_read on public.report_assignments for select to authenticated using(public.can_manage((select barangay_id from public.reports where id=report_id),(select organization_id from public.reports where id=report_id)));
drop policy duplicate_read on public.report_duplicate_links;
create policy duplicate_read on public.report_duplicate_links for select to authenticated using(public.can_manage((select barangay_id from public.reports where id=report_id),(select organization_id from public.reports where id=report_id)));
