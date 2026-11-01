create extension if not exists postgis with schema extensions;
create type public.report_status as enum ('submitted','under_review','verified','assigned','in_progress','resolved','rejected','duplicate');
create table public.barangays(id uuid primary key default gen_random_uuid(),name text unique not null,boundary extensions.geometry(MultiPolygon,4326),source_url text);
create table public.report_categories(id uuid primary key default gen_random_uuid(),name text unique not null,active boolean not null default true);
create table public.organizations(id uuid primary key default gen_random_uuid(),name text unique not null,active boolean not null default true);
create table public.profiles(id uuid primary key references auth.users on delete cascade,display_name text not null default '',role text not null default 'resident' check(role in ('resident','barangay','office','admin')),barangay_id uuid references public.barangays,notifications_enabled boolean not null default true);
create table public.organization_memberships(user_id uuid references public.profiles,organization_id uuid references public.organizations,primary key(user_id,organization_id));
create table public.reports(id uuid primary key default gen_random_uuid(),resident_id uuid not null default auth.uid() references public.profiles,category_id uuid not null references public.report_categories,barangay_id uuid not null references public.barangays,title text not null check(length(title) between 8 and 160),description text not null check(length(description) between 20 and 4000),latitude double precision not null check(latitude between -90 and 90),longitude double precision not null check(longitude between -180 and 180),location extensions.geography(Point,4326) generated always as (extensions.st_setsrid(extensions.st_makepoint(longitude,latitude),4326)::extensions.geography) stored,landmark text not null default '',status public.report_status not null default 'submitted',organization_id uuid references public.organizations,severity integer check(severity between 1 and 5),verified_at timestamptz,public_summary text,public_visible boolean not null default false,is_demo boolean not null default false,created_at timestamptz not null default now());
create index reports_location on public.reports using gist(location);
create index reports_scope on public.reports(barangay_id,status,category_id,created_at desc);
create index reports_owner on public.reports(resident_id,created_at desc);
create index reports_office on public.reports(organization_id);
create table public.report_status_history(id bigint generated always as identity primary key,report_id uuid not null references public.reports,actor_id uuid not null references public.profiles,old_status public.report_status,new_status public.report_status not null,public_note text not null,created_at timestamptz not null default now());
create table public.report_assignments(id bigint generated always as identity primary key,report_id uuid not null references public.reports,organization_id uuid not null references public.organizations,actor_id uuid not null references public.profiles,reason text not null,created_at timestamptz not null default now());
create table public.report_duplicate_links(report_id uuid primary key references public.reports,canonical_id uuid not null references public.reports,reason text not null,check(report_id<>canonical_id));
create table public.report_followers(report_id uuid references public.reports,user_id uuid default auth.uid() references public.profiles,endorsement boolean not null default false,primary key(report_id,user_id));
create table public.report_attachments(id uuid primary key default gen_random_uuid(),report_id uuid not null references public.reports,path text unique not null,owner_id uuid not null default auth.uid() references public.profiles,created_at timestamptz not null default now());
create table public.routing_rules(id uuid primary key default gen_random_uuid(),category_id uuid not null references public.report_categories,barangay_id uuid references public.barangays,organization_id uuid not null references public.organizations,notes text not null default '');
create table public.analytics_settings(id boolean primary key default true check(id),radius_m integer not null default 100 check(radius_m between 10 and 1000),window_days integer not null default 90 check(window_days between 1 and 365),count_weight numeric not null default 1 check(count_weight>=0),severity_weight numeric not null default 2 check(severity_weight>=0),age_weight numeric not null default 0.1 check(age_weight>=0));
insert into public.analytics_settings default values;
create table public.issue_assessments(id uuid primary key default gen_random_uuid(),barangay_id uuid not null references public.barangays,actor_id uuid not null default auth.uid() references public.profiles,assessment text not null check(length(assessment) between 5 and 4000),created_at timestamptz not null default now());
create table public.consultations(id uuid primary key default gen_random_uuid(),barangay_id uuid not null references public.barangays,organization_id uuid references public.organizations,title text not null,body text not null,status text not null default 'draft' check(status in ('draft','open','closed','archived')),report_id uuid references public.reports,opens_at timestamptz not null default now(),closes_at timestamptz not null default now()+interval '30 days',outcome text,created_by uuid not null default auth.uid() references public.profiles,created_at timestamptz not null default now(),check(closes_at>opens_at));
create table public.consultation_comments(id uuid primary key default gen_random_uuid(),consultation_id uuid not null references public.consultations,author_id uuid not null default auth.uid() references public.profiles,body text not null check(length(body) between 2 and 2000),parent_id uuid references public.consultation_comments,hidden boolean not null default false,moderation_reason text,created_at timestamptz not null default now());
create table public.consultation_followers(consultation_id uuid references public.consultations,user_id uuid default auth.uid() references public.profiles,primary key(consultation_id,user_id));
create table public.comment_flags(comment_id uuid references public.consultation_comments,user_id uuid default auth.uid() references public.profiles,reason text not null,primary key(comment_id,user_id));
create table public.meeting_requests(id uuid primary key default gen_random_uuid(),barangay_id uuid not null references public.barangays,resident_id uuid not null default auth.uid() references public.profiles,title text not null,body text not null,consultation_id uuid references public.consultations,status text not null default 'pending' check(status in ('pending','approved','declined')),decision_reason text,created_at timestamptz not null default now());
create table public.meeting_supporters(request_id uuid references public.meeting_requests,user_id uuid default auth.uid() references public.profiles,primary key(request_id,user_id));
create table public.meetings(id uuid primary key default gen_random_uuid(),request_id uuid unique not null references public.meeting_requests,starts_at timestamptz not null,venue text not null,outcome text,created_at timestamptz not null default now());
create table public.meeting_action_items(id uuid primary key default gen_random_uuid(),meeting_id uuid not null references public.meetings,organization_id uuid references public.organizations,description text not null,due_at date,completed boolean not null default false);
create table public.announcements(id uuid primary key default gen_random_uuid(),barangay_id uuid references public.barangays,organization_id uuid references public.organizations,title text not null,body text not null,kind text not null default 'General announcement',status text not null default 'draft' check(status in ('draft','published','archived')),publish_at timestamptz not null default now(),created_by uuid not null default auth.uid() references public.profiles,created_at timestamptz not null default now());
create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles,title text not null,report_id uuid references public.reports,read_at timestamptz,created_at timestamptz not null default now());
create table public.audit_logs(id bigint generated always as identity primary key,actor_id uuid references public.profiles,entity text not null,record_id text,action text not null,old_value jsonb,new_value jsonb,created_at timestamptz not null default now());

create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin') $$;
create function public.can_manage(b uuid,o uuid default null) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin' or (p.role='barangay' and p.barangay_id=b) or (p.role='office' and exists(select 1 from public.organization_memberships m where m.user_id=p.id and m.organization_id=o)))) $$;
create function public.owns_report(r uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.reports where id=r and resident_id=auth.uid())$$;
create function public.can_read_report(r uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.reports where id=r and (resident_id=auth.uid() or public.can_manage(barangay_id,organization_id)))$$;
create function public.new_profile() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name','')); return new; end$$;
create trigger on_signup after insert on auth.users for each row execute function public.new_profile();
create function public.audit_change() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.audit_logs(actor_id,entity,record_id,action,old_value,new_value) values(auth.uid(),tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id'),tg_op,case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end); return coalesce(new,old); end$$;

do $$declare t text; begin
foreach t in array array['barangays','report_categories','organizations','profiles','organization_memberships','reports','report_status_history','report_assignments','report_duplicate_links','report_followers','report_attachments','routing_rules','analytics_settings','issue_assessments','consultations','consultation_comments','consultation_followers','comment_flags','meeting_requests','meeting_supporters','meetings','meeting_action_items','announcements','notifications','audit_logs'] loop
execute format('alter table public.%I enable row level security',t);
end loop;
foreach t in array array['reports','profiles','organization_memberships','routing_rules','analytics_settings','consultations','consultation_comments','meeting_requests','meetings','meeting_action_items','announcements','issue_assessments'] loop
execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_change()',t);
end loop;
foreach t in array array['barangays','report_categories','organizations','routing_rules','analytics_settings'] loop
execute format('create policy read_reference on public.%I for select to authenticated using(true)',t);
execute format('create policy admin_config on public.%I for all to authenticated using(public.is_admin()) with check(public.is_admin())',t);
end loop;
end$$;
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy edit_profile on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
revoke update on public.profiles from authenticated;
grant update(display_name,barangay_id,notifications_enabled) on public.profiles to authenticated;
create policy memberships on public.organization_memberships for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy staff_accounts on public.organization_memberships for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy report_read on public.reports for select to authenticated using(resident_id=auth.uid() or public.can_manage(barangay_id,organization_id));
create policy report_submit on public.reports for insert to authenticated with check(resident_id=auth.uid() and status='submitted' and organization_id is null and severity is null and verified_at is null and not public_visible and not is_demo and public_summary is null);
create policy history_read on public.report_status_history for select to authenticated using(public.can_read_report(report_id));
create policy assignment_read on public.report_assignments for select to authenticated using(public.can_read_report(report_id));
create policy duplicate_read on public.report_duplicate_links for select to authenticated using(public.can_read_report(report_id));
create policy attachment_read on public.report_attachments for select to authenticated using(public.can_read_report(report_id));
create policy attachment_insert on public.report_attachments for insert to authenticated with check(owner_id=auth.uid() and public.owns_report(report_id) and path like auth.uid()::text||'/'||report_id::text||'/%');
create policy follow_read on public.report_followers for select to authenticated using(user_id=auth.uid());
create function public.public_reports() returns table(id uuid,title text,category_id uuid,barangay_id uuid,status public.report_status,latitude double precision,longitude double precision,created_at timestamptz,is_demo boolean) language sql stable security definer set search_path='' as $$ select r.id,r.public_summary,r.category_id,r.barangay_id,r.status,round(r.latitude::numeric,3)::float8,round(r.longitude::numeric,3)::float8,r.created_at,r.is_demo from public.reports r where r.public_visible and r.public_summary is not null and r.status not in ('rejected','duplicate') order by r.created_at desc limit 500 $$;
create policy follow_insert on public.report_followers for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.public_reports() p where p.id=report_id));
create policy unfollow on public.report_followers for delete to authenticated using(user_id=auth.uid());
create policy consultations_read on public.consultations for select to authenticated using(status in ('open','closed') or public.can_manage(barangay_id,organization_id));
create policy consultations_staff on public.consultations for all to authenticated using(public.can_manage(barangay_id,organization_id)) with check(public.can_manage(barangay_id,organization_id));
create policy comments_read on public.consultation_comments for select to authenticated using(exists(select 1 from public.consultations c where c.id=consultation_id and (not hidden or public.can_manage(c.barangay_id,c.organization_id))));
create policy comments_insert on public.consultation_comments for insert to authenticated with check(author_id=auth.uid() and not hidden and moderation_reason is null and exists(select 1 from public.consultations c where c.id=consultation_id and c.status='open' and now() between c.opens_at and c.closes_at));
create policy comments_moderate on public.consultation_comments for update to authenticated using(exists(select 1 from public.consultations c where c.id=consultation_id and public.can_manage(c.barangay_id,c.organization_id))) with check(moderation_reason is not null);
revoke update on public.consultation_comments from authenticated;
grant update(hidden,moderation_reason) on public.consultation_comments to authenticated;
create policy consultation_follow on public.consultation_followers for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and exists(select 1 from public.consultations where id=consultation_id));
create policy flag_own on public.comment_flags for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy requests_read on public.meeting_requests for select to authenticated using(resident_id=auth.uid() or public.can_manage(barangay_id) or barangay_id=(select barangay_id from public.profiles where id=auth.uid()));
create policy requests_insert on public.meeting_requests for insert to authenticated with check(resident_id=auth.uid() and status='pending' and decision_reason is null);
create policy requests_staff on public.meeting_requests for update to authenticated using(public.can_manage(barangay_id)) with check(public.can_manage(barangay_id));
revoke update on public.meeting_requests from authenticated;
grant update(status,decision_reason) on public.meeting_requests to authenticated;
create policy support on public.meeting_supporters for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and exists(select 1 from public.meeting_requests where id=request_id and status='pending'));
create policy meetings_read on public.meetings for select to authenticated using(exists(select 1 from public.meeting_requests where id=request_id));
create policy meetings_staff on public.meetings for all to authenticated using(exists(select 1 from public.meeting_requests where id=request_id and public.can_manage(barangay_id))) with check(exists(select 1 from public.meeting_requests where id=request_id and status='approved' and public.can_manage(barangay_id)));
create policy actions_read on public.meeting_action_items for select to authenticated using(exists(select 1 from public.meetings where id=meeting_id));
create policy actions_staff on public.meeting_action_items for all to authenticated using(exists(select 1 from public.meetings m join public.meeting_requests r on r.id=m.request_id where m.id=meeting_id and public.can_manage(r.barangay_id))) with check(exists(select 1 from public.meetings m join public.meeting_requests r on r.id=m.request_id where m.id=meeting_id and public.can_manage(r.barangay_id)));
create policy announcements_read on public.announcements for select to authenticated using(public.can_manage(barangay_id,organization_id) or (status='published' and publish_at<=now() and (barangay_id is null or barangay_id=(select barangay_id from public.profiles where id=auth.uid()))));
create policy announcements_staff on public.announcements for all to authenticated using(public.can_manage(barangay_id,organization_id)) with check(public.can_manage(barangay_id,organization_id));
create policy assessment_read on public.issue_assessments for select to authenticated using(public.can_manage(barangay_id));
create policy assessment_insert on public.issue_assessments for insert to authenticated with check(actor_id=auth.uid() and public.can_manage(barangay_id));
create policy notifications_read on public.notifications for select to authenticated using(user_id=auth.uid());
create policy notifications_update on public.notifications for update to authenticated using(user_id=auth.uid());
revoke update on public.notifications from authenticated;
grant update(read_at) on public.notifications to authenticated;
create policy audit_admin on public.audit_logs for select to authenticated using(public.is_admin());

create function public.change_report(p_id uuid,p_status public.report_status,p_note text,p_organization uuid default null,p_severity integer default null,p_duplicate uuid default null,p_public_summary text default null) returns void language plpgsql security definer set search_path='' as $$
declare r public.reports; allowed boolean; begin
select * into r from public.reports where id=p_id for update;
if r.id is null or not public.can_manage(r.barangay_id,r.organization_id) then raise exception 'Not authorized'; end if;
if length(trim(p_note))<5 then raise exception 'Provide an action reason'; end if;
allowed := case r.status when 'submitted' then p_status in ('under_review','rejected','duplicate') when 'under_review' then p_status in ('verified','rejected','duplicate') when 'verified' then p_status in ('assigned','duplicate') when 'assigned' then p_status in ('in_progress','duplicate') when 'in_progress' then p_status in ('resolved','assigned') else p_status='under_review' end;
if not allowed then raise exception 'Invalid status transition'; end if;
if p_status='assigned' and p_organization is null then raise exception 'Choose an organization'; end if;
if p_status='verified' and p_severity is null then raise exception 'Record assessed severity'; end if;
if p_status='duplicate' then
if not exists(select 1 from public.reports x where x.id=p_duplicate and x.id<>p_id and x.status not in ('duplicate','rejected') and public.can_manage(x.barangay_id,x.organization_id)) or exists(select 1 from public.report_duplicate_links where canonical_id=p_id) then raise exception 'Choose an authorized canonical report without duplicate chains'; end if;
insert into public.report_duplicate_links values(p_id,p_duplicate,p_note) on conflict(report_id) do update set canonical_id=excluded.canonical_id,reason=excluded.reason;
else delete from public.report_duplicate_links where report_id=p_id; end if;
update public.reports set status=p_status,organization_id=coalesce(p_organization,organization_id),severity=coalesce(p_severity,severity),verified_at=case when p_status='verified' then now() when p_status='under_review' then null else verified_at end,public_summary=coalesce(nullif(trim(p_public_summary),''),public_summary),public_visible=case when p_status in ('rejected','duplicate','under_review') then false when p_public_summary is not null then true else public_visible end where id=p_id;
insert into public.report_status_history(report_id,actor_id,old_status,new_status,public_note) values(p_id,auth.uid(),r.status,p_status,p_note);
if p_organization is not null then insert into public.report_assignments(report_id,organization_id,actor_id,reason) values(p_id,p_organization,auth.uid(),p_note); end if;
insert into public.notifications(user_id,title,report_id) select p.id,'A followed report has an update',p_id from public.profiles p where p.notifications_enabled and (p.id=r.resident_id or exists(select 1 from public.report_followers f where f.report_id=p_id and f.user_id=p.id));
end$$;
create function public.set_role(p_user uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$begin if not public.is_admin() then raise exception 'Not authorized'; end if; update public.profiles set role=p_role where id=p_user; end$$;

create function public.rate_limit() returns trigger language plpgsql security definer set search_path='' as $$declare n integer; begin
perform pg_advisory_xact_lock(hashtext(auth.uid()::text||tg_table_name));
if tg_table_name='reports' then select count(*) into n from public.reports where resident_id=auth.uid() and created_at>now()-interval '1 hour';
elsif tg_table_name='consultation_comments' then select count(*) into n from public.consultation_comments where author_id=auth.uid() and created_at>now()-interval '1 hour';
else select count(*) into n from public.meeting_requests where resident_id=auth.uid() and created_at>now()-interval '1 hour'; end if;
if n>=20 then raise exception 'Hourly limit reached. Please try later.'; end if; return new; end$$;
create trigger report_rate before insert on public.reports for each row execute function public.rate_limit();
create trigger comment_rate before insert on public.consultation_comments for each row execute function public.rate_limit();
create trigger request_rate before insert on public.meeting_requests for each row execute function public.rate_limit();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('report-evidence','report-evidence',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy evidence_insert on storage.objects for insert to authenticated with check(bucket_id='report-evidence' and (storage.foldername(name))[1]=auth.uid()::text and public.owns_report(((storage.foldername(name))[2])::uuid));
create policy evidence_read on storage.objects for select to authenticated using(bucket_id='report-evidence' and public.can_read_report(((storage.foldername(name))[2])::uuid));
create policy evidence_delete on storage.objects for delete to authenticated using(bucket_id='report-evidence' and owner_id=auth.uid()::text);

revoke execute on all functions in schema public from public,anon;
grant execute on all functions in schema public to authenticated;
