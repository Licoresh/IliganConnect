create function private.referral_options(p_id uuid) returns table(id uuid,name text)
language sql stable security definer set search_path='' as $$
select o.id,o.name from public.organizations o where o.active and private.report_action(p_id,'refer')
and exists(select 1 from public.organization_access_rules a join public.reports r on r.id=p_id
where a.organization_id=o.id and a.enabled and a.category_id=r.category_id and (a.barangay_id is null or a.barangay_id=r.barangay_id)) order by o.name$$;
create function public.referral_options(p_id uuid) returns table(id uuid,name text)
language sql stable security invoker set search_path='' as $$select * from private.referral_options(p_id)$$;
revoke all on function private.referral_options,public.referral_options from public,anon;
grant execute on function private.referral_options,public.referral_options to authenticated;

create policy evidence_active_account on storage.objects as restrictive for all to authenticated
using(bucket_id not in ('report-evidence','announcement-media') or private.active_staff() or private.active_resident())
with check(bucket_id not in ('report-evidence','announcement-media') or private.active_staff() or private.active_resident());

-- Notify the current responsible team without copying confidential report content.
create function private.notify_assigned_staff() returns trigger language plpgsql security definer set search_path='' as $$begin
if new.organization_id is null or (new.organization_id is not distinct from old.organization_id and new.status=old.status) then return new;end if;
insert into public.notifications(user_id,title,report_id)
select distinct p.id,'An assigned report needs your attention',new.id
from public.profiles p join public.organization_memberships m on m.user_id=p.id
join public.organizations o on o.id=m.organization_id and o.active
where p.role='office' and p.account_status='active' and p.notifications_enabled and p.id is distinct from auth.uid()
and o.id=new.organization_id and exists(select 1 from public.organization_access_rules a where a.organization_id=o.id and a.enabled and a.category_id=new.category_id and (a.barangay_id is null or a.barangay_id=new.barangay_id));
return new;end$$;
create trigger notify_assigned_staff after update on public.reports for each row execute function private.notify_assigned_staff();
revoke all on function private.notify_assigned_staff from public,anon,authenticated;

-- Community report links cannot expose or mutate another office's private case.
create function private.validate_report_link() returns trigger language plpgsql set search_path='' as $$begin
if new.report_id is not null and not exists(select 1 from public.reports r where r.id=new.report_id and r.barangay_id=new.barangay_id) then raise exception 'Choose an accessible report in the same barangay';end if;
return new;end$$;
create trigger validate_report_link before insert or update on public.consultations for each row execute function private.validate_report_link();
create trigger validate_report_link before insert or update on public.meeting_requests for each row execute function private.validate_report_link();
revoke all on function private.validate_report_link from public,anon,authenticated;
