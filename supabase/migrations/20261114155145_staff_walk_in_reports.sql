set local lock_timeout = '5s';

-- A walk-in reporter has no resident account. Keep the responsible staff member
-- and the caller-provided reporter identity separately from resident ownership.
alter table public.reports
  alter column resident_id drop not null,
  add column submission_source text not null default 'resident'
    check (submission_source in ('resident','walk_in')),
  add column created_by uuid references public.profiles;

update public.reports set created_by=resident_id where created_by is null;
alter table public.reports
  alter column created_by set default auth.uid(),
  alter column created_by set not null,
  add constraint reports_submission_identity check (
    (submission_source='resident' and resident_id is not null and created_by=resident_id
      ) or (submission_source='walk_in' and resident_id is null)
  );

comment on column public.reports.submission_source is 'resident for self-submitted reports; walk_in for reports recorded by barangay staff for an in-person visitor.';
comment on column public.reports.created_by is 'Authenticated profile that entered the report, distinct from the resident who owns a self-submitted report.';

create table private.walk_in_reporter_details(
  report_id uuid primary key references public.reports(id) on delete cascade,
  reporter_name text not null check(private.valid_input_text(reporter_name,2,100)),
  reporter_contact text check(reporter_contact is null or (
    private.valid_input_text(reporter_contact,5,254)
    and (reporter_contact ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or (reporter_contact ~ '^[+]?[0-9][0-9 ().-]{6,24}$'
        and length(regexp_replace(reporter_contact,'\D','','g')) between 7 and 15))
  )),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
revoke all on private.walk_in_reporter_details from public,anon,authenticated;
comment on table private.walk_in_reporter_details is 'Private walk-in reporter identity, accessed through the scoped report_residents function only.';

create table private.walk_in_location_history(
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  status_snapshot public.report_status not null,
  old_latitude double precision not null,
  old_longitude double precision not null,
  new_latitude double precision not null,
  new_longitude double precision not null,
  created_at timestamptz not null default now()
);
create index walk_in_location_history_report on private.walk_in_location_history(report_id,created_at,id);
revoke all on private.walk_in_location_history from public,anon,authenticated;

drop policy report_submit on public.reports;
create policy report_submit on public.reports for insert to authenticated with check
  (private.active_resident() and submission_source='resident' and resident_id=auth.uid()
    and created_by=auth.uid()
    and status='submitted' and organization_id is null and severity is null and verified_at is null
    and not public_visible and not is_demo and public_summary is null);

create or replace function private.capture_resident_barangay() returns trigger
language plpgsql security definer set search_path='' as $$
declare reporter public.profiles;
begin
  if new.submission_source='walk_in' then
    if new.resident_id is not null or new.created_by is distinct from auth.uid() then
      raise exception 'Walk-in reports must be entered by the signed-in barangay staff member.' using errcode='42501';
    end if;
    select * into reporter from public.profiles p where p.id=auth.uid()
      and p.role='barangay' and p.account_status='active' and p.barangay_id=new.barangay_id;
    if reporter.id is null then
      raise exception 'Only active staff of the report barangay can record a walk-in report.' using errcode='42501';
    end if;
    new.resident_barangay_id:=null;
    new.assigned_to:=null;
    return new;
  end if;

  if new.submission_source is distinct from 'resident' or new.resident_id is distinct from auth.uid() then
    raise exception 'Resident reports must be submitted by their signed-in account.' using errcode='42501';
  end if;
  select barangay_id into new.resident_barangay_id from public.profiles
    where id=new.resident_id and role='resident' and account_status='active';
  if new.resident_barangay_id is null then
    raise exception 'Choose your registered barangay in Profile before submitting a report' using errcode='23514';
  end if;
  new.created_by:=auth.uid();
  new.assigned_to:=null;
  return new;
end $$;

create or replace function public.rate_limit() returns trigger
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text||tg_table_name));
  if tg_table_name='reports' then
    select count(*) into n from public.reports
    where (resident_id=auth.uid() or created_by=auth.uid()) and created_at>now()-interval '1 hour';
  elsif tg_table_name='consultation_comments' then
    select count(*) into n from public.consultation_comments where author_id=auth.uid() and created_at>now()-interval '1 hour';
  else
    select count(*) into n from public.meeting_requests where resident_id=auth.uid() and created_at>now()-interval '1 hour';
  end if;
  if n>=20 then raise exception 'Hourly limit reached. Please try later.'; end if;
  return new;
end $$;

create function private.submit_walk_in_report(
  p_id uuid,p_category uuid,p_barangay uuid,p_reporter_name text,p_reporter_contact text,
  p_title text,p_description text,p_latitude double precision,p_longitude double precision,
  p_landmark text,p_problem_type text,p_problem_other text,p_purok text,p_zone text
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.profiles; point extensions.geometry; existing public.reports;
begin
  select * into actor from public.profiles p where p.id=auth.uid()
    and p.role='barangay' and p.account_status='active' and p.barangay_id=p_barangay;
  if actor.id is null then raise exception 'Only active barangay staff can record a walk-in report for their own barangay.' using errcode='42501'; end if;
  if p_id is null or p_category is null or p_barangay is null
    or not coalesce(private.valid_input_text(p_reporter_name,2,100),false)
    or (p_reporter_contact is not null and not (
      coalesce(private.valid_input_text(p_reporter_contact,5,254),false)
      and (p_reporter_contact ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or (p_reporter_contact ~ '^[+]?[0-9][0-9 ().-]{6,24}$'
          and length(regexp_replace(p_reporter_contact,'\D','','g')) between 7 and 15))))
    or not coalesce(private.valid_input_text(p_title,8,160),false)
    or not coalesce(private.valid_input_text(p_description,20,4000),false)
    or not coalesce(private.valid_input_text(coalesce(p_landmark,''),0,240),false)
    or not coalesce(private.valid_input_text(coalesce(p_purok,''),0,80),false)
    or not coalesce(private.valid_input_text(coalesce(p_zone,''),0,80),false)
    or p_latitude is null or p_longitude is null
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
    or not exists(select 1 from public.report_categories c where c.id=p_category and c.active) then
    raise exception 'Check the reporter, report details, category and required map pin.' using errcode='23514';
  end if;
  if p_problem_other is not null and not coalesce(private.valid_input_text(p_problem_other,1,240),false) then
    raise exception 'Describe the selected other problem in 1 to 240 characters.' using errcode='23514';
  end if;
  if not exists(select 1 from public.report_problem_types t where t.category_id=p_category and t.code=p_problem_type) then
    raise exception 'Choose a problem type for the selected category.' using errcode='23514';
  end if;

  point:=extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326);
  if not exists(select 1 from public.barangays b where b.id=p_barangay and b.boundary is not null
      and extensions.st_covers(b.boundary,point)) then
    raise exception 'Place the pin inside your barangay boundary.' using errcode='23514';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_id::text));
  select * into existing from public.reports where id=p_id;
  if existing.id is not null then
    if existing.created_by=actor.id and existing.submission_source='walk_in' then return p_id; end if;
    raise exception 'This report identifier is already in use.' using errcode='23505';
  end if;

  insert into public.reports(id,resident_id,submission_source,created_by,
    category_id,barangay_id,title,description,latitude,longitude,landmark,problem_type,problem_other,
    purok,zone,location_source,status,is_demo)
  values(p_id,null,'walk_in',actor.id,
    p_category,p_barangay,btrim(p_title),btrim(p_description),p_latitude,p_longitude,coalesce(btrim(p_landmark),''),
    p_problem_type,nullif(btrim(p_problem_other),''),nullif(btrim(p_purok),''),nullif(btrim(p_zone),''),'pin','submitted',false);
  insert into private.walk_in_reporter_details(report_id,reporter_name,reporter_contact,created_by)
    values(p_id,btrim(p_reporter_name),nullif(btrim(p_reporter_contact),''),actor.id);
  return p_id;
end $$;

revoke all on function private.submit_walk_in_report(uuid,uuid,uuid,text,text,text,text,double precision,double precision,text,text,text,text,text) from public,anon;
grant execute on function private.submit_walk_in_report(uuid,uuid,uuid,text,text,text,text,double precision,double precision,text,text,text,text,text) to authenticated;
create function public.submit_walk_in_report(
  p_id uuid,p_category uuid,p_barangay uuid,p_reporter_name text,p_reporter_contact text,
  p_title text,p_description text,p_latitude double precision,p_longitude double precision,
  p_landmark text,p_problem_type text,p_problem_other text,p_purok text,p_zone text
) returns uuid language sql security invoker set search_path='' as $$
  select private.submit_walk_in_report(p_id,p_category,p_barangay,p_reporter_name,p_reporter_contact,
    p_title,p_description,p_latitude,p_longitude,p_landmark,p_problem_type,p_problem_other,p_purok,p_zone)
$$;
revoke all on function public.submit_walk_in_report(uuid,uuid,uuid,text,text,text,text,double precision,double precision,text,text,text,text,text) from public,anon;
grant execute on function public.submit_walk_in_report(uuid,uuid,uuid,text,text,text,text,double precision,double precision,text,text,text,text,text) to authenticated;

create function private.update_walk_in_report_location(p_id uuid,p_latitude double precision,p_longitude double precision)
returns void language plpgsql security definer set search_path='' as $$
declare report public.reports; actor public.profiles; point extensions.geometry;
begin
  select * into report from public.reports r where r.id=p_id for update;
  select * into actor from public.profiles p where p.id=auth.uid()
    and p.role='barangay' and p.account_status='active';
  if report.id is null or actor.id is null or report.submission_source<>'walk_in'
    or actor.barangay_id is distinct from report.barangay_id
    or not private.report_action(p_id,'review') or not private.sample_report_visible(p_id) then
    raise exception 'Only the assigned barangay can correct a walk-in report location.' using errcode='42501';
  end if;
  if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90
    or p_longitude not between -180 and 180 then
    raise exception 'Choose a valid pin on the barangay map.' using errcode='23514';
  end if;
  point:=extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326);
  if not exists(select 1 from public.barangays b where b.id=report.barangay_id
      and b.boundary is not null and extensions.st_covers(b.boundary,point)) then
    raise exception 'The corrected pin must remain inside the report barangay boundary.' using errcode='23514';
  end if;
  if report.latitude=p_latitude and report.longitude=p_longitude then
    raise exception 'Choose a different pin to record an on-site correction.' using errcode='23514';
  end if;
  update public.reports set latitude=p_latitude,longitude=p_longitude,location_source='pin',location_accuracy=null
    where id=p_id;
  insert into private.walk_in_location_history(report_id,actor_id,status_snapshot,old_latitude,old_longitude,new_latitude,new_longitude)
    values(p_id,actor.id,report.status,report.latitude,report.longitude,p_latitude,p_longitude);
end $$;
revoke all on function private.update_walk_in_report_location(uuid,double precision,double precision) from public,anon;
grant execute on function private.update_walk_in_report_location(uuid,double precision,double precision) to authenticated;
create function public.update_walk_in_report_location(p_id uuid,p_latitude double precision,p_longitude double precision)
returns void language sql security invoker set search_path='' as $$
  select private.update_walk_in_report_location(p_id,p_latitude,p_longitude)
$$;
revoke all on function public.update_walk_in_report_location(uuid,double precision,double precision) from public,anon;
grant execute on function public.update_walk_in_report_location(uuid,double precision,double precision) to authenticated;

create or replace function private.report_residents(p_ids uuid[],p_contact boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(cardinality(p_ids),0)>20 then raise exception 'Request up to 20 reports'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'report_id',r.id,'resident_name',coalesce(walkin.reporter_name,resident.display_name),
    'submission_source',r.submission_source,'created_by_name',coalesce(walkin_creator.display_name,creator.display_name),
    'registered_barangay_id',resident.barangay_id,'submission_barangay_id',r.resident_barangay_id,
    'assigned_to_name',handler.display_name,
    'email',case when p_contact and r.submission_source='resident' and (private.is_admin()
      or exists(select 1 from public.profiles caller where caller.id=auth.uid() and caller.role='barangay' and caller.barangay_id=r.barangay_id)
      or (r.organization_id is not null and (private.report_action(r.id,'update') or private.report_action(r.id,'review'))))
      then u.email else null end,
    'reporter_contact',case when p_contact and r.submission_source='walk_in' and (private.is_admin()
      or exists(select 1 from public.profiles caller where caller.id=auth.uid() and caller.role='barangay' and caller.barangay_id=r.barangay_id)
      or (r.organization_id is not null and (private.report_action(r.id,'update') or private.report_action(r.id,'review'))))
      then walkin.reporter_contact else null end))
    from public.reports r left join public.profiles resident on resident.id=r.resident_id
    left join auth.users u on u.id=resident.id
    left join public.profiles creator on creator.id=r.created_by
    left join private.walk_in_reporter_details walkin on walkin.report_id=r.id
    left join public.profiles walkin_creator on walkin_creator.id=walkin.created_by
    left join public.profiles handler on handler.id=r.assigned_to
    where r.id=any(p_ids) and private.report_action(r.id) and private.sample_report_visible(r.id)),'[]'::jsonb);
end $$;

create or replace function private.queue_report_submission_email()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.is_demo then return new; end if;

  if new.resident_id is not null and new.submission_source='resident' then
    insert into public.email_outbox(dedupe_key,recipient_id,event_key,report_id)
    values('report-received:'||new.id::text,new.resident_id,'report_received',new.id)
    on conflict(dedupe_key) do nothing;
  end if;

  insert into public.notifications(user_id,title,report_id)
  select p.id,'A new report was submitted in your barangay',new.id
    from public.profiles p
   where p.role='barangay' and p.barangay_id=new.barangay_id
     and p.account_status='active' and p.notifications_enabled
     and p.id is distinct from new.created_by;
  return new;
end $$;

create or replace function private.report_action_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_read_report(p_id) or not private.sample_report_visible(p_id) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(events.event order by events.created_at,events.sort_id)
    from (
      select jsonb_build_object('id',h.id,'old_status',h.old_status,'new_status',h.new_status,
        'public_note',h.public_note,'created_at',h.created_at,'action_kind',h.action_kind,
        'actor_name',p.display_name,
        'attachment_count',(select count(*) from public.report_attachments a where a.action_id=h.id)) as event,
        h.created_at,h.id as sort_id
      from public.report_status_history h join public.profiles p on p.id=h.actor_id where h.report_id=p_id
      union all
      select jsonb_build_object('id',-location.id,'old_status',null,'new_status',location.status_snapshot,
        'public_note','Barangay staff corrected the pin after an on-site visit.',
        'created_at',location.created_at,'action_kind','location_update',
        'actor_name',p.display_name,'attachment_count',0) as event,
        location.created_at,-location.id as sort_id
      from private.walk_in_location_history location
      join public.profiles p on p.id=location.actor_id where location.report_id=p_id
    ) events),'[]'::jsonb);
end $$;

create index reports_created_by on public.reports(created_by,created_at desc);
notify pgrst,'reload schema';
