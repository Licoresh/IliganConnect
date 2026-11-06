set local lock_timeout = '5s';

alter table public.reports add column urgency integer check (urgency between 1 and 5);
comment on column public.reports.urgency is 'Official staff time-sensitivity rating, 1..5. NULL means not assessed; separate from impact severity.';

create table public.report_assessments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id),
  actor_id uuid not null references public.profiles(id),
  severity integer not null check (severity between 1 and 5),
  urgency integer not null check (urgency between 1 and 5),
  note text not null check (private.valid_input_text(note,5,4000)),
  created_at timestamptz not null default now()
);
create index report_assessments_report_date on public.report_assessments(report_id,created_at desc,id desc);
create index report_assessments_actor on public.report_assessments(actor_id);
alter table public.report_assessments enable row level security;
revoke all on public.report_assessments from public,anon,authenticated;
grant select on public.report_assessments to authenticated;
create policy report_assessments_staff_read on public.report_assessments for select to authenticated
  using (private.active_staff() and private.report_action(report_id) and private.sample_report_visible(report_id));

-- Ratings are official fields; resident submissions cannot provide them.
drop policy report_submit on public.reports;
create policy report_submit on public.reports for insert to authenticated with check
 (private.active_resident() and resident_id=auth.uid() and status='submitted' and organization_id is null
  and severity is null and urgency is null and verified_at is null and not public_visible and not is_demo and public_summary is null);

create function private.record_report_assessment(p_id uuid,p_severity integer,p_urgency integer,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.reports;
begin
  if auth.uid() is null or not private.report_action(p_id,'review') or not private.sample_report_visible(p_id) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select * into r from public.reports where id=p_id for update;
  if r.id is null or not private.report_action(p_id,'review') or not private.sample_report_visible(p_id) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if r.status not in ('under_review','verified','assigned','in_progress') then
    raise exception 'Assess an active case under review. Reopen a closed case or assess its main report.' using errcode='23514';
  end if;
  if p_severity is null or p_severity not between 1 and 5 or p_urgency is null or p_urgency not between 1 and 5 then
    raise exception 'Choose severity and urgency from 1 to 5.' using errcode='23514';
  end if;
  if p_note is null or not private.valid_input_text(p_note,5,4000) then
    raise exception 'Provide an assessment rationale of 5 to 4000 characters.' using errcode='23514';
  end if;
  update public.reports set severity=p_severity,urgency=p_urgency where id=p_id;
  insert into public.report_assessments(report_id,actor_id,severity,urgency,note)
    values(p_id,auth.uid(),p_severity,p_urgency,btrim(p_note));
end $$;
revoke all on function private.record_report_assessment(uuid,integer,integer,text) from public,anon;
grant execute on function private.record_report_assessment(uuid,integer,integer,text) to authenticated;

create function public.record_report_assessment(p_id uuid,p_severity integer,p_urgency integer,p_note text)
returns void language sql security invoker set search_path='' as $$
  select private.record_report_assessment(p_id,p_severity,p_urgency,p_note)
$$;
revoke all on function public.record_report_assessment(uuid,integer,integer,text) from public,anon;
grant execute on function public.record_report_assessment(uuid,integer,integer,text) to authenticated;

-- Replace the signature rather than adding an ambiguous API overload.
drop function public.change_report(uuid,public.report_status,text,uuid,integer,uuid,text);

CREATE OR REPLACE FUNCTION public.change_report(p_id uuid, p_status public.report_status, p_note text, p_organization uuid DEFAULT NULL::uuid, p_severity integer DEFAULT NULL::integer, p_duplicate uuid DEFAULT NULL::uuid, p_public_summary text DEFAULT NULL::text, p_urgency integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.reports; allowed boolean; begin
-- Serialize duplicate-link changes before row locks, then recheck both records.
if p_status='duplicate' then
  if not private.report_action(p_id,'review') or not exists(
    select 1 from public.reports s join public.reports c on c.id=p_duplicate and c.is_demo=s.is_demo
    where s.id=p_id and (not s.is_demo or private.sample_data_enabled()) and private.report_action(c.id)
  ) then raise exception 'Not authorized'; end if;
  perform pg_catalog.pg_advisory_xact_lock(731104,1);
  perform 1 from public.reports where id in (p_id,p_duplicate) order by id for update;
end if;
select * into r from public.reports where id=p_id for update;
if r.id is null or not private.report_action(p_id,case when p_status='assigned' then 'refer' when p_status in ('in_progress','resolved') then 'update' else 'review' end) then raise exception 'Not authorized'; end if;
if r.is_demo and not private.sample_data_enabled() then raise exception 'Not authorized'; end if;
if length(trim(coalesce(p_note,''))) not between 5 and 4000 then raise exception 'Provide an action reason'; end if;
allowed := case r.status when 'submitted' then p_status in ('under_review','rejected','duplicate') when 'under_review' then p_status in ('verified','rejected','duplicate') when 'verified' then p_status in ('assigned','duplicate') when 'assigned' then p_status in ('in_progress','duplicate') when 'in_progress' then p_status in ('resolved','assigned') else p_status='under_review' end;
if not allowed then raise exception 'Invalid status transition'; end if;
if p_status='assigned' and p_organization is null then raise exception 'Choose an organization'; end if;
if p_organization is not null and p_status<>'assigned' then raise exception 'Assignment requires referral permission';end if;
if p_status='assigned' and not exists(select 1 from public.organizations o join public.organization_access_rules a on a.organization_id=o.id and a.enabled where o.id=p_organization and o.active and a.category_id=r.category_id and (a.barangay_id is null or a.barangay_id=r.barangay_id)) then raise exception 'Office has no approved responsibility for this category and jurisdiction';end if;
if p_status='verified' and (p_severity is null or p_severity not between 1 and 5 or p_urgency is null or p_urgency not between 1 and 5) then
  raise exception 'Record assessed severity and urgency from 1 to 5.' using errcode='23514';
end if;
if p_status<>'verified' and (p_severity is not null or p_urgency is not null) then
  raise exception 'Use the staff assessment action to change ratings.' using errcode='23514';
end if;
if p_status='duplicate' then
if not exists(select 1 from public.reports x where x.id=p_duplicate and x.id<>p_id and x.status not in ('duplicate','rejected') and private.report_action(x.id) and x.is_demo=r.is_demo and (not x.is_demo or private.sample_data_enabled()) and not exists(select 1 from public.report_duplicate_links l where l.report_id=x.id)) or exists(select 1 from public.report_duplicate_links where canonical_id=p_id) then raise exception 'Choose an authorized canonical report without duplicate chains'; end if;
insert into public.report_duplicate_links values(p_id,p_duplicate,p_note) on conflict(report_id) do update set canonical_id=excluded.canonical_id,reason=excluded.reason;
else delete from public.report_duplicate_links where report_id=p_id; end if;
update public.reports set status=p_status,organization_id=coalesce(p_organization,organization_id),severity=case when p_status='verified' then p_severity else severity end,urgency=case when p_status='verified' then p_urgency else urgency end,verified_at=case when p_status='verified' then now() when p_status='under_review' then null else verified_at end,public_summary=case when p_status='verified' then coalesce(nullif(trim(p_public_summary),''),public_summary) else public_summary end,public_visible=case when p_status in ('rejected','duplicate','under_review') then false when p_status='verified' and nullif(trim(p_public_summary),'') is not null then true else public_visible end where id=p_id;
if p_status='verified' then
  insert into public.report_assessments(report_id,actor_id,severity,urgency,note) values(p_id,auth.uid(),p_severity,p_urgency,btrim(p_note));
end if;
insert into public.report_status_history(report_id,actor_id,old_status,new_status,public_note) values(p_id,auth.uid(),r.status,p_status,p_note);
if p_organization is not null then insert into public.report_assignments(report_id,organization_id,actor_id,reason) values(p_id,p_organization,auth.uid(),p_note); end if;
insert into public.notifications(user_id,title,report_id) select p.id,'A followed report has an update',p_id from public.profiles p where p.notifications_enabled and (p.id=r.resident_id or exists(select 1 from public.report_followers f where f.report_id=p_id and f.user_id=p.id));
end$function$;
revoke all on function public.change_report(uuid,public.report_status,text,uuid,integer,uuid,text,integer) from public,anon;
grant execute on function public.change_report(uuid,public.report_status,text,uuid,integer,uuid,text,integer) to authenticated;
notify pgrst,'reload schema';
