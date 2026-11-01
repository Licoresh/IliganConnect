-- Functional roles remain compatible with the resident application.
alter table public.profiles add column account_status text not null default 'active'
  check(account_status in ('pending','active','disabled'));
alter table public.organizations add column responsibilities text not null default '';
alter table public.organizations add column can_consult boolean not null default false;
alter table public.organizations add column can_coordinate boolean not null default false;
alter table public.organizations add column can_publish boolean not null default false;

create table public.organization_access_rules(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  category_id uuid not null references public.report_categories,
  barangay_id uuid references public.barangays,
  assignment_only boolean not null default true,
  can_review boolean not null default false,
  can_update boolean not null default true,
  can_refer boolean not null default false,
  enabled boolean not null default false,
  notes text not null default '' check(length(notes)<=2000),
  unique nulls not distinct(organization_id,category_id,barangay_id,assignment_only)
);
create index access_rules_category on public.organization_access_rules(category_id);
create index access_rules_barangay on public.organization_access_rules(barangay_id);
alter table public.organization_access_rules enable row level security;
create trigger audit after insert or update or delete on public.organization_access_rules
for each row execute function public.audit_change();

create or replace function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and account_status='active')$$;
create function private.active_staff() returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.profiles p where p.id=auth.uid() and p.account_status='active' and
 (p.role='admin' or (p.role='barangay' and p.barangay_id is not null) or
 (p.role='office' and exists(select 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id where m.user_id=p.id and o.active))))$$;
create function private.active_resident() returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.profiles where id=auth.uid() and role='resident' and account_status='active')$$;
create function private.report_access(b uuid,c uuid,o uuid,action text default 'read') returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.profiles p where p.id=auth.uid() and p.account_status='active' and
 (p.role='admin' or (p.role='barangay' and p.barangay_id=b) or
 (p.role='office' and exists(select 1 from public.organization_memberships m
 join public.organizations org on org.id=m.organization_id and org.active
 join public.organization_access_rules a on a.organization_id=org.id and a.enabled
 where m.user_id=p.id and a.category_id=c and (a.barangay_id is null or a.barangay_id=b)
 and (not a.assignment_only or org.id=o)
 and case action when 'read' then true when 'review' then a.can_review when 'update' then a.can_update when 'refer' then a.can_refer else false end))))$$;
create function private.report_action(r uuid,action text default 'read') returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.reports where id=r and private.report_access(barangay_id,category_id,organization_id,action))$$;
create or replace function private.owns_report(r uuid) returns boolean language sql stable security definer set search_path='' as $$
select private.active_resident() and exists(select 1 from public.reports where id=r and resident_id=auth.uid())$$;
create or replace function private.can_read_report(r uuid) returns boolean language sql stable security definer set search_path='' as $$
select private.owns_report(r) or private.report_action(r)$$;
create function private.community_access(b uuid,o uuid,action text) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.profiles p where p.id=auth.uid() and p.account_status='active' and
 (p.role='admin' or (p.role='barangay' and b=p.barangay_id) or
 (p.role='office' and exists(select 1 from public.organization_memberships m join public.organizations org on org.id=m.organization_id and org.active
 where m.user_id=p.id and org.id=o and
 case action when 'consultations' then org.can_consult when 'meetings' then org.can_coordinate when 'announcements' then org.can_publish when 'read' then true else false end
 and exists(select 1 from public.organization_access_rules a where a.organization_id=o and a.enabled and (a.barangay_id is null or a.barangay_id=b))))))$$;
-- Backwards-compatible helper is for community scope only, never report authorization.
create or replace function private.can_manage(b uuid,o uuid default null) returns boolean language sql stable security definer set search_path='' as $$
select private.community_access(b,o,'read')$$;
create function private.meeting_access(r uuid,action text default 'read') returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.meeting_requests req join public.profiles p on p.id=auth.uid()
 where req.id=r and p.account_status='active' and
 (p.role='admin' or (p.role='barangay' and p.barangay_id=req.barangay_id) or
 (p.role='office' and exists(select 1 from public.organization_memberships m
 join public.organizations o on o.id=m.organization_id and o.active and o.can_coordinate
 join public.organization_access_rules a on a.organization_id=o.id and a.enabled
 left join public.reports linked on linked.id=req.report_id
 where m.user_id=p.id and (a.barangay_id is null or a.barangay_id=req.barangay_id)
 and a.category_id=coalesce(linked.category_id,req.category_id)
 and (not a.assignment_only or linked.organization_id=o.id)
 and (action='read' or a.can_review)))))$$;

create policy access_rules_read on public.organization_access_rules for select to authenticated
using(private.is_admin() or (private.active_staff() and exists(select 1 from public.organization_memberships m where m.organization_id=organization_access_rules.organization_id and m.user_id=auth.uid())));
create policy access_rules_admin on public.organization_access_rules for all to authenticated using(private.is_admin()) with check(private.is_admin());
grant select,insert,update,delete on public.organization_access_rules to authenticated;
revoke all on public.organization_access_rules from anon;

drop policy report_read on public.reports;
create policy report_read on public.reports for select to authenticated using
 ((resident_id=auth.uid() and private.active_resident()) or private.report_access(barangay_id,category_id,organization_id));
drop policy report_submit on public.reports;
create policy report_submit on public.reports for insert to authenticated with check
 (private.active_resident() and resident_id=auth.uid() and status='submitted' and organization_id is null and severity is null and verified_at is null and not public_visible and not is_demo and public_summary is null);
drop policy notes_staff_read on public.report_internal_notes;
create policy notes_staff_read on public.report_internal_notes for select to authenticated using(private.report_action(report_id));
drop policy notes_staff_insert on public.report_internal_notes;
create policy notes_staff_insert on public.report_internal_notes for insert to authenticated with check(actor_id=auth.uid() and (private.report_action(report_id,'update') or private.report_action(report_id,'review')));
drop policy assignment_read on public.report_assignments;
create policy assignment_read on public.report_assignments for select to authenticated using(private.report_action(report_id));
drop policy duplicate_read on public.report_duplicate_links;
create policy duplicate_read on public.report_duplicate_links for select to authenticated using(private.report_action(report_id) and private.report_action(canonical_id));
drop policy attachment_insert on public.report_attachments;
create policy attachment_insert on public.report_attachments for insert to authenticated with check
 (owner_id=auth.uid() and path like auth.uid()::text||'/'||report_id::text||'/%' and (private.owns_report(report_id) or private.report_action(report_id,'update') or private.report_action(report_id,'review')));
drop policy evidence_insert on storage.objects;
create policy evidence_insert on storage.objects for insert to authenticated with check
 (bucket_id='report-evidence' and (storage.foldername(name))[1]=auth.uid()::text and
 (private.owns_report(((storage.foldername(name))[2])::uuid) or private.report_action(((storage.foldername(name))[2])::uuid,'update') or private.report_action(((storage.foldername(name))[2])::uuid,'review')));

create or replace function public.set_role(p_user uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$begin
if not private.is_admin() then raise exception 'Not authorized';end if;
perform pg_advisory_xact_lock(147205);
if p_role not in ('resident','barangay','office','admin') then raise exception 'Invalid role';end if;
if exists(select 1 from public.profiles where id=p_user and role='admin' and account_status='active') and p_role<>'admin' and (select count(*) from public.profiles where role='admin' and account_status='active')<2 then raise exception 'Keep at least one active administrator';end if;
update public.profiles set account_status=case when role is distinct from p_role and p_role<>'resident' then 'pending' else account_status end,role=p_role where id=p_user;
if not found then raise exception 'Account not found';end if;end$$;
create function public.set_account_status(p_user uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$begin
if not private.is_admin() then raise exception 'Not authorized';end if;
perform pg_advisory_xact_lock(147205);
if p_status not in ('pending','active','disabled') then raise exception 'Invalid account status';end if;
if exists(select 1 from public.profiles where id=p_user and role='admin' and account_status='active') and p_status<>'active' and (select count(*) from public.profiles where role='admin' and account_status='active')<2 then raise exception 'Keep at least one active administrator';end if;
if p_status='active' and exists(select 1 from public.profiles where id=p_user and
 ((role='barangay' and barangay_id is null) or (role='office' and not exists(select 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id and o.active where m.user_id=p_user)))) then raise exception 'Assign jurisdiction or active organization before approval';end if;
update public.profiles set account_status=p_status where id=p_user;
if not found then raise exception 'Account not found';end if;end$$;

create function public.staff_context() returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('profile',to_jsonb(p),'authorized',private.active_staff(),
 'organizations',coalesce((select jsonb_agg(to_jsonb(o)) from public.organizations o join public.organization_memberships m on m.organization_id=o.id where m.user_id=auth.uid() and o.active),'[]'::jsonb),
 'rules',coalesce((select jsonb_agg(to_jsonb(a)) from public.organization_access_rules a join public.organization_memberships m on m.organization_id=a.organization_id join public.organizations o on o.id=a.organization_id and o.active where m.user_id=auth.uid() and a.enabled),'[]'::jsonb))
from public.profiles p where p.id=auth.uid()$$;
create function public.report_permissions(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('read',private.report_action(p_id),'review',private.report_action(p_id,'review'),'update',private.report_action(p_id,'update'),'refer',private.report_action(p_id,'refer'))$$;
create function public.community_permissions(p_table text,p_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
select case p_table when 'consultations' then exists(select 1 from public.consultations c where c.id=p_id and private.community_access(c.barangay_id,c.organization_id,'consultations'))
when 'announcements' then exists(select 1 from public.announcements a where a.id=p_id and private.community_access(a.barangay_id,a.organization_id,'announcements'))
when 'meeting_requests' then private.meeting_access(p_id,'manage') else false end$$;

-- Seed only explicitly labelled existing demo organizations, preserving their assignment workflow.
insert into public.organization_access_rules(organization_id,category_id,enabled,assignment_only,can_review,can_update,can_refer,notes)
select o.id,c.id,true,true,true,true,true,'Demonstration configuration; approve local responsibilities before operational use.'
from public.organizations o cross join public.report_categories c where o.name like 'DEMO — %';

revoke all on function public.set_account_status,public.staff_context,public.report_permissions,public.community_permissions from public,anon;
grant execute on function public.set_account_status,public.staff_context,public.report_permissions,public.community_permissions to authenticated;
revoke execute on all functions in schema private from public,anon;
grant execute on all functions in schema private to authenticated;

create or replace function public.change_report(p_id uuid,p_status public.report_status,p_note text,p_organization uuid default null,p_severity integer default null,p_duplicate uuid default null,p_public_summary text default null) returns void language plpgsql security definer set search_path='' as $$
declare r public.reports; allowed boolean; begin
select * into r from public.reports where id=p_id for update;
if r.id is null or not private.report_action(p_id,case when p_status='assigned' then 'refer' when p_status in ('in_progress','resolved') then 'update' else 'review' end) then raise exception 'Not authorized'; end if;
if length(trim(coalesce(p_note,''))) not between 5 and 4000 then raise exception 'Provide an action reason'; end if;
allowed := case r.status when 'submitted' then p_status in ('under_review','rejected','duplicate') when 'under_review' then p_status in ('verified','rejected','duplicate') when 'verified' then p_status in ('assigned','duplicate') when 'assigned' then p_status in ('in_progress','duplicate') when 'in_progress' then p_status in ('resolved','assigned') else p_status='under_review' end;
if not allowed then raise exception 'Invalid status transition'; end if;
if p_status='assigned' and p_organization is null then raise exception 'Choose an organization'; end if;
if p_organization is not null and p_status<>'assigned' then raise exception 'Assignment requires referral permission';end if;
if p_status='assigned' and not exists(select 1 from public.organizations o join public.organization_access_rules a on a.organization_id=o.id and a.enabled where o.id=p_organization and o.active and a.category_id=r.category_id and (a.barangay_id is null or a.barangay_id=r.barangay_id)) then raise exception 'Office has no approved responsibility for this category and jurisdiction';end if;
if p_status='verified' and p_severity is null then raise exception 'Record assessed severity'; end if;
if p_status='duplicate' then
if not exists(select 1 from public.reports x where x.id=p_duplicate and x.id<>p_id and x.status not in ('duplicate','rejected') and private.report_action(x.id)) or exists(select 1 from public.report_duplicate_links where canonical_id=p_id) then raise exception 'Choose an authorized canonical report without duplicate chains'; end if;
insert into public.report_duplicate_links values(p_id,p_duplicate,p_note) on conflict(report_id) do update set canonical_id=excluded.canonical_id,reason=excluded.reason;
else delete from public.report_duplicate_links where report_id=p_id; end if;
update public.reports set status=p_status,organization_id=coalesce(p_organization,organization_id),severity=case when p_status='verified' then p_severity else severity end,verified_at=case when p_status='verified' then now() when p_status='under_review' then null else verified_at end,public_summary=case when p_status='verified' then coalesce(nullif(trim(p_public_summary),''),public_summary) else public_summary end,public_visible=case when p_status in ('rejected','duplicate','under_review') then false when p_status='verified' and nullif(trim(p_public_summary),'') is not null then true else public_visible end where id=p_id;
insert into public.report_status_history(report_id,actor_id,old_status,new_status,public_note) values(p_id,auth.uid(),r.status,p_status,p_note);
if p_organization is not null then insert into public.report_assignments(report_id,organization_id,actor_id,reason) values(p_id,p_organization,auth.uid(),p_note); end if;
insert into public.notifications(user_id,title,report_id) select p.id,'A followed report has an update',p_id from public.profiles p where p.notifications_enabled and (p.id=r.resident_id or exists(select 1 from public.report_followers f where f.report_id=p_id and f.user_id=p.id));
end$$;

drop policy consultations_staff on public.consultations;
create policy consultations_staff on public.consultations for all to authenticated using(private.community_access(barangay_id,organization_id,'consultations')) with check(private.community_access(barangay_id,organization_id,'consultations'));

drop policy announcements_staff on public.announcements;
create policy announcements_staff on public.announcements for all to authenticated using(private.community_access(barangay_id,organization_id,'announcements')) with check(private.community_access(barangay_id,organization_id,'announcements'));

drop policy comments_moderate on public.consultation_comments;
create policy comments_moderate on public.consultation_comments for update to authenticated using(exists(select 1 from public.consultations c where c.id=consultation_id and private.community_access(c.barangay_id,c.organization_id,'consultations'))) with check(exists(select 1 from public.consultations c where c.id=consultation_id and private.community_access(c.barangay_id,c.organization_id,'consultations')) and moderation_reason is not null);

drop policy flags_staff_read on public.comment_flags;
create policy flags_staff_read on public.comment_flags for select to authenticated using(exists(select 1 from public.consultation_comments cc join public.consultations c on c.id=cc.consultation_id where cc.id=comment_id and private.community_access(c.barangay_id,c.organization_id,'consultations')));

drop policy flags_staff_delete on public.comment_flags;
create policy flags_staff_delete on public.comment_flags for delete to authenticated using(exists(select 1 from public.consultation_comments cc join public.consultations c on c.id=cc.consultation_id where cc.id=comment_id and private.community_access(c.barangay_id,c.organization_id,'consultations')));

drop policy requests_read on public.meeting_requests;
create policy requests_read on public.meeting_requests for select to authenticated using(private.meeting_access(id) or (private.active_resident() and (resident_id=auth.uid() or barangay_id=(select p.barangay_id from public.profiles p where p.id=auth.uid()))));

drop policy requests_staff on public.meeting_requests;
create policy requests_staff on public.meeting_requests for update to authenticated using(private.meeting_access(id,'manage')) with check(private.meeting_access(id,'manage'));

drop policy meetings_staff on public.meetings;
create policy meetings_staff on public.meetings for all to authenticated using(private.meeting_access(request_id,'manage')) with check(private.meeting_access(request_id,'manage') and exists(select 1 from public.meeting_requests r where r.id=request_id and r.status='approved'));

drop policy participants_staff on public.meeting_participants;
create policy participants_staff on public.meeting_participants for all to authenticated using(exists(select 1 from public.meetings m where m.id=meeting_id and private.meeting_access(m.request_id,'manage'))) with check(exists(select 1 from public.meetings m where m.id=meeting_id and private.meeting_access(m.request_id,'manage')));

drop policy actions_staff on public.meeting_action_items;
create policy actions_staff on public.meeting_action_items for all to authenticated using(exists(select 1 from public.meetings m where m.id=meeting_id and private.meeting_access(m.request_id,'manage'))) with check(exists(select 1 from public.meetings m where m.id=meeting_id and private.meeting_access(m.request_id,'manage')));

drop policy announcement_image_write on storage.objects;
create policy announcement_image_write on storage.objects for insert to authenticated with check(bucket_id='announcement-media' and exists(select 1 from public.announcements a where a.id::text=(storage.foldername(name))[1] and private.community_access(a.barangay_id,a.organization_id,'announcements')));

drop policy announcement_image_delete on storage.objects;
create policy announcement_image_delete on storage.objects for delete to authenticated using(bucket_id='announcement-media' and exists(select 1 from public.announcements a where a.id::text=(storage.foldername(name))[1] and private.community_access(a.barangay_id,a.organization_id,'announcements')));

create or replace function private.mark_official_comment() returns trigger language plpgsql security definer set search_path='' as $$begin
select private.community_access(c.barangay_id,c.organization_id,'consultations') into new.official from public.consultations c where c.id=new.consultation_id;
new.official=coalesce(new.official,false);return new;end$$;
-- Inactive staff cannot fall through public/resident community policies.
do $$declare t text;begin
foreach t in array array['consultations','consultation_comments','consultation_followers','comment_flags','meeting_requests','meeting_supporters','meetings','meeting_action_items','meeting_participants','announcements','notifications','report_followers'] loop
execute format('create policy active_account on public.%I as restrictive for all to authenticated using(private.active_staff() or private.active_resident()) with check(private.active_staff() or private.active_resident())',t);
end loop;end$$;

create or replace function public.map_reports(west float8,south float8,east float8,north float8,category uuid default null,barangay uuid default null,report_state public.report_status default null,since timestamptz default null,until timestamptz default null,verified_only boolean default false,unresolved_only boolean default false,office uuid default null,recurring_only boolean default false)
returns setof public.reports language sql stable security invoker set search_path='' as $$select r.* from public.reports r where private.active_staff() and extensions.st_intersects(r.location::extensions.geometry,extensions.st_makeenvelope(west,south,east,north,4326)) and (category is null or r.category_id=category) and (barangay is null or r.barangay_id=barangay) and (report_state is null or r.status=report_state) and (since is null or r.created_at>=since) and (until is null or r.created_at<until) and (not verified_only or r.verified_at is not null) and (not unresolved_only or r.status not in ('resolved','rejected','duplicate')) and (office is null or r.organization_id=office) and r.status not in ('rejected','duplicate') and (not recurring_only or exists(select 1 from public.reports x cross join public.analytics_settings settings where x.id<>r.id and x.category_id=r.category_id and x.status not in ('rejected','duplicate') and abs(extract(epoch from r.created_at-x.created_at))<=settings.window_days*86400 and extensions.st_dwithin(r.location,x.location,settings.radius_m))) order by r.created_at desc limit 1000$$;

create or replace function public.geographic_analytics(p_barangay uuid default null,p_category uuid default null,p_since timestamptz default null,p_until timestamptz default null,p_status public.report_status default null,p_office uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$
with filtered as materialized(select * from public.reports r where private.active_staff() and (p_barangay is null or r.barangay_id=p_barangay) and (p_category is null or r.category_id=p_category) and (p_since is null or r.created_at>=p_since) and (p_until is null or r.created_at<p_until) and (p_status is null or r.status=p_status) and (p_office is null or r.organization_id=p_office)),
recurring as (select a.id from filtered a cross join public.analytics_settings s where a.status not in ('rejected','duplicate') and exists(select 1 from public.reports b where b.id<>a.id and b.category_id=a.category_id and b.status not in ('rejected','duplicate') and abs(extract(epoch from a.created_at-b.created_at))<=s.window_days*86400 and extensions.st_dwithin(a.location,b.location,s.radius_m))),
categories as (select c.name,count(r.id) as received,count(r.id) filter(where r.verified_at is not null and r.status not in ('rejected','duplicate')) as verified from public.report_categories c left join filtered r on r.category_id=c.id group by c.id),
trend as (select to_char(date_trunc('week',created_at at time zone 'Asia/Manila'),'YYYY-MM-DD') as week,count(*) as received,count(*) filter(where verified_at is not null and status not in ('duplicate','rejected')) as verified from filtered group by 1 order by 1),
barangays as (select b.id,b.name,count(r.id) as received,count(r.id) filter(where r.verified_at is not null and r.status not in ('rejected','duplicate')) as verified,count(r.id) filter(where r.verified_at is not null and r.status not in ('resolved','rejected','duplicate')) as unresolved,count(r.id) filter(where r.id in(select id from recurring)) as recurring from public.barangays b left join filtered r on r.barangay_id=b.id group by b.id order by unresolved desc,b.name)
select jsonb_build_object('counts',(select jsonb_build_object('total',count(*),'review',count(*) filter(where status in ('submitted','under_review')),'verified',count(*) filter(where verified_at is not null and status not in ('duplicate','rejected')),'progress',count(*) filter(where status='in_progress'),'resolved',count(*) filter(where status='resolved'),'unresolved',count(*) filter(where verified_at is not null and status not in ('resolved','rejected','duplicate')),'recurring',(select count(*) from recurring)) from filtered),'categories',coalesce((select jsonb_agg(categories) from categories),'[]'::jsonb),'trend',coalesce((select jsonb_agg(trend) from trend),'[]'::jsonb),'barangays',coalesce((select jsonb_agg(barangays) from barangays),'[]'::jsonb))$$;

create or replace function public.barangay_summary() returns table(id uuid,name text,submitted bigint,verified bigint,unresolved bigint,resolved bigint,oldest_days numeric,severity_total bigint,score numeric) language sql stable security invoker set search_path='' as $$select b.id,b.name,count(r.id),count(r.id) filter(where r.verified_at is not null and r.status not in ('rejected','duplicate')),count(r.id) filter(where r.verified_at is not null and r.status not in ('resolved','rejected','duplicate')),count(r.id) filter(where r.status='resolved'),coalesce(max(extract(epoch from now()-r.created_at)/86400) filter(where r.verified_at is not null and r.status not in ('resolved','rejected','duplicate')),0),coalesce(sum(r.severity) filter(where r.verified_at is not null and r.status not in ('resolved','rejected','duplicate')),0),count(r.id) filter(where r.verified_at is not null and r.status not in ('resolved','rejected','duplicate'))*s.count_weight+coalesce(sum(r.severity) filter(where r.verified_at is not null and r.status not in ('resolved','rejected','duplicate')),0)*s.severity_weight+coalesce(max(extract(epoch from now()-r.created_at)/86400) filter(where r.verified_at is not null and r.status not in ('resolved','rejected','duplicate')),0)*s.age_weight from public.barangays b cross join public.analytics_settings s left join public.reports r on r.barangay_id=b.id where private.active_staff() and (private.is_admin() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='barangay' and p.barangay_id=b.id) or exists(select 1 from public.reports permitted where permitted.barangay_id=b.id)) group by b.id,b.name,s.count_weight,s.severity_weight,s.age_weight order by 9 desc$$;

create or replace function public.dashboard_counts() returns jsonb language sql stable security invoker set search_path='' as $$select jsonb_build_object('total',count(*),'review',count(*) filter(where status in ('submitted','under_review')),'verified',count(*) filter(where verified_at is not null and status not in ('duplicate','rejected')),'progress',count(*) filter(where status='in_progress'),'resolved',count(*) filter(where status='resolved'),'unresolved',count(*) filter(where status not in ('resolved','rejected','duplicate'))) from public.reports where private.active_staff()$$;

create or replace function public.recurrence_candidates(p_id uuid) returns table(id uuid,title text,status public.report_status,distance_m float8,verified_at timestamptz) language sql stable security invoker set search_path='' as $$select b.id,b.title,b.status,extensions.st_distance(a.location,b.location),b.verified_at from public.reports a join public.reports b on a.category_id=b.category_id and a.id<>b.id cross join public.analytics_settings s where private.active_staff() and a.id=p_id and b.status not in ('rejected','duplicate') and abs(extract(epoch from a.created_at-b.created_at))<=s.window_days*86400 and extensions.st_dwithin(a.location,b.location,s.radius_m) order by 4 limit 50$$;
