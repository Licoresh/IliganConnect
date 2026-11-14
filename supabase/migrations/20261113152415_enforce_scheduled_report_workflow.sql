alter table public.reports
  add constraint reports_scheduled_requires_time
  check (status <> 'scheduled' or scheduled_at is not null);

create or replace function private.record_report_assessment(p_id uuid,p_severity integer,p_urgency integer,p_note text)
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
  if r.status in ('submitted','under_review') then
    raise exception 'Record ratings together with the barangay review decision.' using errcode='23514';
  end if;
  if r.status not in ('verified','assigned','scheduled','in_progress') then
    raise exception 'Assess an active case or reopen it for barangay review.' using errcode='23514';
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

drop function public.change_report(uuid,public.report_status,text,uuid,integer,uuid,text,integer,uuid[]);

create function public.change_report(
  p_id uuid,
  p_status public.report_status,
  p_note text,
  p_organization uuid default null,
  p_severity integer default null,
  p_duplicate uuid default null,
  p_public_summary text default null,
  p_urgency integer default null,
  p_evidence uuid[] default '{}',
  p_scheduled_at timestamptz default null
) returns void
language plpgsql security definer set search_path='' as $$
declare
  r public.reports;
  allowed boolean;
  requires_review boolean;
  requires_assessment boolean;
  event_id bigint;
begin
  if p_status='duplicate' then
    if not private.report_action(p_id,'review') or not exists(
      select 1 from public.reports s join public.reports c on c.id=p_duplicate and c.is_demo=s.is_demo
      where s.id=p_id and (not s.is_demo or private.sample_data_enabled()) and private.report_action(c.id)
    ) then raise exception 'Not authorized'; end if;
    perform pg_catalog.pg_advisory_xact_lock(731104,1);
    perform 1 from public.reports where id in (p_id,p_duplicate) order by id for update;
  end if;

  select * into r from public.reports where id=p_id for update;
  if r.id is null or not private.report_action(p_id,
    case when p_status='assigned' then 'refer'
         when p_status in ('scheduled','in_progress','resolved') then 'update'
         else 'review' end) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if r.is_demo and not private.sample_data_enabled() then raise exception 'Not authorized'; end if;

  requires_review := r.status in ('submitted','under_review')
    and p_status in ('verified','assigned','rejected','duplicate');
  if p_status='under_review' and not exists(
    select 1 from public.profiles p where p.id=auth.uid() and p.account_status='active'
      and (p.role='admin' or (p.role='barangay' and p.barangay_id=r.barangay_id))
  ) then raise exception 'Only the responsible barangay can reopen a report for review' using errcode='42501'; end if;
  if requires_review and not exists(
    select 1 from public.profiles p where p.id=auth.uid() and p.account_status='active'
      and (p.role='admin' or (p.role='barangay' and p.barangay_id=r.barangay_id))
  ) then raise exception 'Only the responsible barangay can review this report' using errcode='42501'; end if;

  if not coalesce(private.valid_input_text(p_note,5,4000),false) then
    raise exception 'Provide an action reason';
  end if;
  allowed := case r.status
    when 'submitted' then p_status in ('under_review','verified','assigned','rejected','duplicate')
    when 'under_review' then p_status in ('verified','assigned','rejected','duplicate')
    when 'verified' then p_status in ('assigned','scheduled','duplicate')
    when 'assigned' then p_status in ('scheduled','duplicate')
    when 'scheduled' then p_status in ('scheduled','in_progress','duplicate')
    when 'in_progress' then p_status in ('resolved','assigned')
    else p_status='under_review'
  end;
  if not allowed then raise exception 'Invalid status transition'; end if;

  if p_status='scheduled' then
    if p_scheduled_at is null then raise exception 'Choose a planned work date and time.' using errcode='23514'; end if;
    if p_scheduled_at <= now() and not (r.is_demo and private.sample_data_enabled()) then
      raise exception 'Choose a future work date and time.' using errcode='23514';
    end if;
  elsif p_scheduled_at is not null then
    raise exception 'A planned work date is only accepted when scheduling the report.' using errcode='23514';
  end if;

  if p_status='assigned' and p_organization is null then raise exception 'Choose an organization'; end if;
  if p_organization is not null and p_status<>'assigned' then raise exception 'Assignment requires referral permission'; end if;
  if p_status='assigned' and not exists(
    select 1 from public.organizations o
    join public.organization_access_rules a on a.organization_id=o.id and a.enabled
    where o.id=p_organization and o.active and a.category_id=r.category_id
      and (a.barangay_id is null or a.barangay_id=r.barangay_id)
  ) then raise exception 'Office has no approved responsibility for this category and jurisdiction'; end if;

  requires_assessment := p_status='verified'
    or (p_status='assigned' and r.status in ('submitted','under_review'));
  if requires_assessment and (p_severity is null or p_severity not between 1 and 5
    or p_urgency is null or p_urgency not between 1 and 5) then
    raise exception 'Record assessed severity and urgency from 1 to 5.' using errcode='23514';
  end if;
  if not requires_assessment and (p_severity is not null or p_urgency is not null) then
    raise exception 'Use the staff assessment action to change ratings.' using errcode='23514';
  end if;

  if p_status='duplicate' then
    if not exists(
      select 1 from public.reports x where x.id=p_duplicate and x.id<>p_id
        and x.status not in ('duplicate','rejected') and private.report_action(x.id)
        and x.is_demo=r.is_demo and (not x.is_demo or private.sample_data_enabled())
        and not exists(select 1 from public.report_duplicate_links l where l.report_id=x.id)
    ) or exists(select 1 from public.report_duplicate_links where canonical_id=p_id) then
      raise exception 'Choose an authorized canonical report without duplicate chains';
    end if;
    insert into public.report_duplicate_links values(p_id,p_duplicate,p_note)
      on conflict(report_id) do update set canonical_id=excluded.canonical_id,reason=excluded.reason;
  else
    delete from public.report_duplicate_links where report_id=p_id;
  end if;

  update public.reports set
    status=p_status,
    scheduled_at=case when p_status='scheduled' then p_scheduled_at
      when p_status in ('assigned','under_review','duplicate') then null else scheduled_at end,
    organization_id=case when p_status='under_review' then null else coalesce(p_organization,organization_id) end,
    assigned_to=case when p_status in ('assigned','under_review','duplicate') then null
      when p_status='in_progress' and r.organization_id is null then coalesce(assigned_to,
        (select id from public.profiles where id=auth.uid() and role='barangay'))
      else assigned_to end,
    severity=case when requires_assessment then p_severity else severity end,
    urgency=case when requires_assessment then p_urgency else urgency end,
    verified_at=case when requires_assessment then now() when p_status='under_review' then null else verified_at end,
    public_summary=case when requires_assessment then coalesce(nullif(trim(p_public_summary),''),public_summary) else public_summary end,
    public_visible=case when p_status in ('rejected','duplicate','under_review') then false
      when requires_assessment and nullif(trim(p_public_summary),'') is not null then true
      else public_visible end
  where id=p_id;

  if requires_assessment then
    insert into public.report_assessments(report_id,actor_id,severity,urgency,note)
      values(p_id,auth.uid(),p_severity,p_urgency,btrim(p_note));
  end if;
  insert into public.report_status_history(report_id,actor_id,old_status,new_status,public_note,action_kind)
    values(p_id,auth.uid(),r.status,p_status,btrim(p_note),
      case when requires_review then 'report_review' else 'status_change' end)
    returning id into event_id;
  perform private.link_action_evidence(p_id,event_id,p_evidence);
  if p_organization is not null then
    insert into public.report_assignments(report_id,organization_id,actor_id,reason)
      values(p_id,p_organization,auth.uid(),p_note);
  end if;
  insert into public.notifications(user_id,title,report_id)
    select p.id,'A followed report has an update',p_id from public.profiles p
    where p.notifications_enabled and (p.id=r.resident_id or exists(
      select 1 from public.report_followers f where f.report_id=p_id and f.user_id=p.id
    ));
end $$;

revoke all on function public.change_report(uuid,public.report_status,text,uuid,integer,uuid,text,integer,uuid[],timestamptz) from public,anon;
grant execute on function public.change_report(uuid,public.report_status,text,uuid,integer,uuid,text,integer,uuid[],timestamptz) to authenticated;

create or replace function private.record_report_update(p_id uuid,p_note text,p_evidence uuid[] default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare r public.reports; event_id bigint;
begin
  select * into r from public.reports where id=p_id for update;
  if r.id is null or not private.report_action(p_id,'update') or not private.sample_report_visible(p_id) then
    raise exception 'Not authorized' using errcode='42501'; end if;
  if r.status not in ('scheduled','in_progress') or not coalesce(private.valid_input_text(p_note,5,4000),false)
    then raise exception 'Record progress after work has been scheduled or started.'; end if;
  insert into public.report_status_history(report_id,actor_id,old_status,new_status,public_note,action_kind)
    values(p_id,auth.uid(),r.status,r.status,btrim(p_note),'progress_update') returning id into event_id;
  perform private.link_action_evidence(p_id,event_id,p_evidence);
  insert into public.notifications(user_id,title,report_id)
    select p.id,'A followed report has a progress update',p_id from public.profiles p
    where p.notifications_enabled and (p.id=r.resident_id or exists(
      select 1 from public.report_followers f where f.report_id=p_id and f.user_id=p.id));
end $$;

notify pgrst,'reload schema';
