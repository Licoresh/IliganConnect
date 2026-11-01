create function public.report_engagement(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
if auth.uid() is null or not (private.can_read_report(p_id) or private.is_public_report(p_id)) then raise exception 'Not authorized';end if;
return (select jsonb_build_object('followers',count(*),'endorsements',count(*) filter(where endorsement)) from public.report_followers where report_id=p_id);
end$$;
revoke execute on function public.report_engagement from public,anon;
grant execute on function public.report_engagement to authenticated;
create trigger audit after insert or update or delete on public.report_internal_notes for each row execute function public.audit_change();
create trigger audit after insert or update or delete on public.meeting_participants for each row execute function public.audit_change();
create trigger audit after insert or update or delete on public.organizations for each row execute function public.audit_change();
create trigger audit after insert or update or delete on public.report_categories for each row execute function public.audit_change();
