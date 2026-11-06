create or replace function public.resident_activity_summary()
returns table(reports_submitted bigint, discussions bigint, meeting_requests bigint)
language sql
stable
security definer
set search_path=''
as $$
  select
    (select count(*) from public.reports r where r.resident_id=(select auth.uid())),
    (select count(*) from public.consultation_comments c where c.author_id=(select auth.uid()) and not c.hidden)
      + (select count(*) from public.consultations c where c.created_by=(select auth.uid())),
    (select count(*) from public.meeting_requests r where r.resident_id=(select auth.uid()));
$$;

revoke all on function public.resident_activity_summary() from public, anon;
grant execute on function public.resident_activity_summary() to authenticated;
