-- Complete coordination and analysis. Every query retains the caller's RLS scope.
alter table public.consultation_comments add column official boolean not null default false;
grant select(official) on public.consultation_comments to authenticated;
alter table public.meeting_requests add column category_id uuid references public.report_categories;
alter table public.meeting_requests add column report_id uuid references public.reports;
grant select(category_id,report_id) on public.meeting_requests to authenticated;
alter table public.meetings add column completed boolean not null default false;
alter table public.announcements add column attachment_path text;
alter table public.notifications add column consultation_id uuid references public.consultations;
alter table public.notifications add column meeting_request_id uuid references public.meeting_requests;
alter table public.notifications add column announcement_id uuid references public.announcements;

create table public.report_internal_notes(id uuid primary key default gen_random_uuid(),report_id uuid not null references public.reports,body text not null check(length(trim(body)) between 5 and 4000),actor_id uuid not null default auth.uid() references public.profiles,created_at timestamptz not null default now());
alter table public.report_internal_notes enable row level security;
create policy notes_staff_read on public.report_internal_notes for select to authenticated using(exists(select 1 from public.reports r where r.id=report_id and private.can_manage(r.barangay_id,r.organization_id)));
create policy notes_staff_insert on public.report_internal_notes for insert to authenticated with check(actor_id=auth.uid() and exists(select 1 from public.reports r where r.id=report_id and private.can_manage(r.barangay_id,r.organization_id)));
create table public.meeting_participants(meeting_id uuid references public.meetings on delete cascade,organization_id uuid references public.organizations,primary key(meeting_id,organization_id));
alter table public.meeting_participants enable row level security;
create policy participants_read on public.meeting_participants for select to authenticated using(exists(select 1 from public.meetings where id=meeting_id));
create policy participants_staff on public.meeting_participants for all to authenticated using(exists(select 1 from public.meetings m join public.meeting_requests r on r.id=m.request_id where m.id=meeting_id and private.can_manage(r.barangay_id))) with check(exists(select 1 from public.meetings m join public.meeting_requests r on r.id=m.request_id where m.id=meeting_id and private.can_manage(r.barangay_id)));
create policy flags_staff_read on public.comment_flags for select to authenticated using(exists(select 1 from public.consultation_comments cc join public.consultations c on c.id=cc.consultation_id where cc.id=comment_id and private.can_manage(c.barangay_id,c.organization_id)));
create policy flags_staff_delete on public.comment_flags for delete to authenticated using(exists(select 1 from public.consultation_comments cc join public.consultations c on c.id=cc.consultation_id where cc.id=comment_id and private.can_manage(c.barangay_id,c.organization_id)));
create index notes_report on public.report_internal_notes(report_id);
create index participant_org on public.meeting_participants(organization_id);

create function private.mark_official_comment() returns trigger language plpgsql security definer set search_path='' as $$begin
select private.can_manage(c.barangay_id,c.organization_id) into new.official from public.consultations c where c.id=new.consultation_id;
return new;end$$;
create trigger official_comment before insert on public.consultation_comments for each row execute function private.mark_official_comment();
create function private.community_notifications() returns trigger language plpgsql security definer set search_path='' as $$begin
if tg_table_name='consultation_comments' and new.official then
insert into public.notifications(user_id,title,consultation_id) select p.id,'An official response was posted to a consultation',new.consultation_id from public.profiles p join public.consultation_followers f on f.user_id=p.id where f.consultation_id=new.consultation_id and p.notifications_enabled and p.id<>new.author_id;
elsif tg_table_name='meeting_requests' and new.status is distinct from old.status then
insert into public.notifications(user_id,title,meeting_request_id) select p.id,'A community meeting request has an update',new.id from public.profiles p where p.notifications_enabled and (p.id=new.resident_id or exists(select 1 from public.meeting_supporters s where s.request_id=new.id and s.user_id=p.id));
elsif tg_table_name='meetings' then
insert into public.notifications(user_id,title,meeting_request_id) select p.id,'Community meeting details have been updated',new.request_id from public.profiles p join public.meeting_requests r on r.id=new.request_id where p.notifications_enabled and (p.id=r.resident_id or p.barangay_id=r.barangay_id);
elsif tg_table_name='announcements' and new.status='published' and new.publish_at<=now() and (tg_op='INSERT' or old.status is distinct from new.status) then
insert into public.notifications(user_id,title,announcement_id) select p.id,'A new official announcement is available',new.id from public.profiles p where p.notifications_enabled and (new.barangay_id is null or p.barangay_id=new.barangay_id);
end if;return new;end$$;
create trigger community_notifications after insert on public.consultation_comments for each row execute function private.community_notifications();
create trigger community_notifications after update on public.meeting_requests for each row execute function private.community_notifications();
create trigger community_notifications after insert or update on public.meetings for each row execute function private.community_notifications();
create trigger community_notifications after insert or update on public.announcements for each row execute function private.community_notifications();
revoke execute on all functions in schema private from public,anon;

-- A stable client-generated identifier makes retrying a timed-out submission safe.
create function public.submit_report(p_id uuid,p_category uuid,p_barangay uuid,p_title text,p_description text,p_latitude float8,p_longitude float8,p_landmark text default '') returns uuid language plpgsql security invoker set search_path='' as $$begin
perform pg_advisory_xact_lock(hashtext(p_id::text));
if exists(select 1 from public.reports where id=p_id and resident_id=auth.uid()) then return p_id;end if;
insert into public.reports(id,category_id,barangay_id,title,description,latitude,longitude,landmark) values(p_id,p_category,p_barangay,p_title,p_description,p_latitude,p_longitude,p_landmark);
return p_id;end$$;

create function public.geographic_analytics(p_barangay uuid default null,p_category uuid default null,p_since timestamptz default null,p_until timestamptz default null,p_status public.report_status default null,p_office uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$
with filtered as materialized(select * from public.reports r where (p_barangay is null or r.barangay_id=p_barangay) and (p_category is null or r.category_id=p_category) and (p_since is null or r.created_at>=p_since) and (p_until is null or r.created_at<p_until) and (p_status is null or r.status=p_status) and (p_office is null or r.organization_id=p_office)),
recurring as (select a.id from filtered a cross join public.analytics_settings s where a.status not in ('rejected','duplicate') and exists(select 1 from public.reports b where b.id<>a.id and b.category_id=a.category_id and b.status not in ('rejected','duplicate') and abs(extract(epoch from a.created_at-b.created_at))<=s.window_days*86400 and extensions.st_dwithin(a.location,b.location,s.radius_m))),
categories as (select c.name,count(r.id) as received,count(r.id) filter(where r.verified_at is not null and r.status not in ('rejected','duplicate')) as verified from public.report_categories c left join filtered r on r.category_id=c.id group by c.id),
trend as (select to_char(date_trunc('week',created_at at time zone 'Asia/Manila'),'YYYY-MM-DD') as week,count(*) as received,count(*) filter(where verified_at is not null and status not in ('duplicate','rejected')) as verified from filtered group by 1 order by 1),
barangays as (select b.id,b.name,count(r.id) as received,count(r.id) filter(where r.verified_at is not null and r.status not in ('rejected','duplicate')) as verified,count(r.id) filter(where r.verified_at is not null and r.status not in ('resolved','rejected','duplicate')) as unresolved,count(r.id) filter(where r.id in(select id from recurring)) as recurring from public.barangays b left join filtered r on r.barangay_id=b.id group by b.id order by unresolved desc,b.name)
select jsonb_build_object('counts',(select jsonb_build_object('total',count(*),'review',count(*) filter(where status in ('submitted','under_review')),'verified',count(*) filter(where verified_at is not null and status not in ('duplicate','rejected')),'progress',count(*) filter(where status='in_progress'),'resolved',count(*) filter(where status='resolved'),'unresolved',count(*) filter(where verified_at is not null and status not in ('resolved','rejected','duplicate')),'recurring',(select count(*) from recurring)) from filtered),'categories',coalesce((select jsonb_agg(categories) from categories),'[]'::jsonb),'trend',coalesce((select jsonb_agg(trend) from trend),'[]'::jsonb),'barangays',coalesce((select jsonb_agg(barangays) from barangays),'[]'::jsonb))$$;

create function public.public_report_page(p_category uuid default null,p_barangay uuid default null,p_search text default '',p_offset integer default 0) returns table(id uuid,title text,category_id uuid,barangay_id uuid,status public.report_status,latitude float8,longitude float8,created_at timestamptz,is_demo boolean) language sql stable security definer set search_path='' as $$
select r.id,r.public_summary,r.category_id,r.barangay_id,r.status,round(r.latitude::numeric,3)::float8,round(r.longitude::numeric,3)::float8,r.created_at,r.is_demo from public.reports r where r.public_visible and r.public_summary is not null and r.status not in ('rejected','duplicate') and (p_category is null or r.category_id=p_category) and (p_barangay is null or r.barangay_id=p_barangay) and r.public_summary ilike '%'||left(p_search,160)||'%' order by r.created_at desc,r.id limit 30 offset greatest(0,p_offset)$$;

-- Private announcement images inherit announcement audience and staff jurisdiction.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('announcement-media','announcement-media',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy announcement_image_read on storage.objects for select to authenticated using(bucket_id='announcement-media' and exists(select 1 from public.announcements a where a.id::text=(storage.foldername(name))[1]));
create policy announcement_image_write on storage.objects for insert to authenticated with check(bucket_id='announcement-media' and exists(select 1 from public.announcements a where a.id::text=(storage.foldername(name))[1] and private.can_manage(a.barangay_id,a.organization_id)));
create policy announcement_image_delete on storage.objects for delete to authenticated using(bucket_id='announcement-media' and exists(select 1 from public.announcements a where a.id::text=(storage.foldername(name))[1] and private.can_manage(a.barangay_id,a.organization_id)));
-- Staff can attach resolution evidence; ownership stays with the uploader.
drop policy attachment_insert on public.report_attachments;
create policy attachment_insert on public.report_attachments for insert to authenticated with check(owner_id=auth.uid() and path like auth.uid()::text||'/'||report_id::text||'/%' and exists(select 1 from public.reports r where r.id=report_id and (r.resident_id=auth.uid() or private.can_manage(r.barangay_id,r.organization_id))));
drop policy evidence_insert on storage.objects;
create policy evidence_insert on storage.objects for insert to authenticated with check(bucket_id='report-evidence' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.reports r where r.id::text=(storage.foldername(name))[2] and (r.resident_id=auth.uid() or private.can_manage(r.barangay_id,r.organization_id))));

create or replace function public.set_role(p_user uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$begin
if not private.is_admin() then raise exception 'Not authorized';end if;
perform pg_advisory_xact_lock(147205);
if p_role not in ('resident','barangay','office','admin') then raise exception 'Invalid role';end if;
if exists(select 1 from public.profiles where id=p_user and role='admin') and p_role<>'admin' and (select count(*) from public.profiles where role='admin')<2 then raise exception 'Keep at least one administrator';end if;
update public.profiles set role=p_role where id=p_user;
if not found then raise exception 'Account not found';end if;end$$;
revoke execute on function public.submit_report,public.geographic_analytics,public.public_report_page from public,anon;
grant execute on function public.submit_report,public.geographic_analytics,public.public_report_page to authenticated;
drop function public.map_reports;
create function public.map_reports(west float8,south float8,east float8,north float8,category uuid default null,barangay uuid default null,report_state public.report_status default null,since timestamptz default null,until timestamptz default null,verified_only boolean default false,unresolved_only boolean default false,office uuid default null,recurring_only boolean default false)
returns setof public.reports language sql stable security invoker set search_path='' as $$select r.* from public.reports r where extensions.st_intersects(r.location::extensions.geometry,extensions.st_makeenvelope(west,south,east,north,4326)) and (category is null or r.category_id=category) and (barangay is null or r.barangay_id=barangay) and (report_state is null or r.status=report_state) and (since is null or r.created_at>=since) and (until is null or r.created_at<until) and (not verified_only or r.verified_at is not null) and (not unresolved_only or r.status not in ('resolved','rejected','duplicate')) and (office is null or r.organization_id=office) and r.status not in ('rejected','duplicate') and (not recurring_only or exists(select 1 from public.reports x cross join public.analytics_settings settings where x.id<>r.id and x.category_id=r.category_id and x.status not in ('rejected','duplicate') and abs(extract(epoch from r.created_at-x.created_at))<=settings.window_days*86400 and extensions.st_dwithin(r.location,x.location,settings.radius_m))) order by r.created_at desc limit 1000$$;
revoke execute on function public.map_reports from public,anon; grant execute on function public.map_reports to authenticated;
