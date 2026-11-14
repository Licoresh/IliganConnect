set local lock_timeout='5s';

alter table public.reports
  add column resident_barangay_id uuid references public.barangays,
  add column assigned_to uuid references public.profiles;
create index reports_resident_barangay on public.reports(resident_barangay_id);
create index reports_assigned_person on public.reports(assigned_to);
alter table public.report_status_history add column action_kind text not null default 'status_change';
alter table public.report_attachments add column action_id bigint references public.report_status_history;
alter table public.report_status_history add constraint report_history_identity unique(report_id,id);
alter table public.report_attachments add constraint report_attachment_action_report foreign key(report_id,action_id) references public.report_status_history(report_id,id);
create index report_attachments_action on public.report_attachments(action_id);
revoke insert on public.report_attachments from authenticated;
grant insert(id,report_id,path,owner_id,created_at,source_url,attribution,is_illustrative)
  on public.report_attachments to authenticated;

-- Capture the registered jurisdiction from the authenticated account at submission.
create function private.capture_resident_barangay() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select barangay_id into new.resident_barangay_id from public.profiles where id=new.resident_id;
  if new.resident_barangay_id is null then
    raise exception 'Choose your registered barangay in Profile before submitting a report' using errcode='23514';
  end if;
  new.assigned_to:=null;
  return new;
end $$;
revoke all on function private.capture_resident_barangay() from public,anon,authenticated;
create trigger capture_resident_barangay before insert on public.reports
for each row execute function private.capture_resident_barangay();

create function private.report_residents(p_ids uuid[],p_contact boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(cardinality(p_ids),0)>20 then raise exception 'Request up to 20 reports'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'report_id',r.id,'resident_name',p.display_name,'registered_barangay_id',p.barangay_id,
    'submission_barangay_id',r.resident_barangay_id,'assigned_to_name',handler.display_name,
    'email',case when p_contact and (private.is_admin() or
      exists(select 1 from public.profiles caller where caller.id=auth.uid() and caller.role='barangay' and caller.barangay_id=r.barangay_id)
      or (r.organization_id is not null and (private.report_action(r.id,'update') or private.report_action(r.id,'review'))))
      then u.email else null end))
    from public.reports r join public.profiles p on p.id=r.resident_id
    left join auth.users u on u.id=p.id left join public.profiles handler on handler.id=r.assigned_to
    where r.id=any(p_ids) and private.report_action(r.id) and private.sample_report_visible(r.id)),'[]'::jsonb);
end $$;

create function private.admin_residents(p_search text default '',p_barangay uuid default null,
  p_status text default null,p_sort text default 'name',p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb; total bigint;
begin
  if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  if length(coalesce(p_search,''))>160 or p_offset<0 or p_offset>1000000
    or p_sort not in ('name','newest','oldest') or (p_status is not null and p_status not in ('active','pending','disabled'))
    then raise exception 'Invalid resident filters'; end if;
  select count(*) into total from public.profiles p join auth.users u on u.id=p.id
    where p.role='resident' and (p_barangay is null or p.barangay_id=p_barangay)
      and (p_status is null or p.account_status=p_status)
      and (coalesce(p_search,'')='' or strpos(lower(p.display_name||' '||coalesce(u.email,'')),lower(p_search))>0);
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into items from (
    select p.id,p.display_name,p.barangay_id,p.account_status,p.notifications_enabled,u.email,u.phone,
      u.created_at,u.last_sign_in_at
    from public.profiles p join auth.users u on u.id=p.id
    where p.role='resident' and (p_barangay is null or p.barangay_id=p_barangay)
      and (p_status is null or p.account_status=p_status)
      and (coalesce(p_search,'')='' or strpos(lower(p.display_name||' '||coalesce(u.email,'')),lower(p_search))>0)
    order by case when p_sort='name' then lower(p.display_name) end,
      case when p_sort='newest' then u.created_at end desc,
      case when p_sort='oldest' then u.created_at end,p.id
    limit 25 offset p_offset
  ) rows;
  return jsonb_build_object('items',items,'total',total);
end $$;

create function private.admin_update_resident(p_user uuid,p_name text,p_barangay uuid,p_status text,
  p_notifications boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare old_profile public.profiles;
begin
  if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  if not coalesce(private.valid_input_text(p_name,2,100),false)
    or not coalesce(private.valid_input_text(p_reason,5,4000),false)
    or p_status is null or p_status not in ('active','pending','disabled') or p_notifications is null
    or not exists(select 1 from public.barangays where id=p_barangay) then raise exception 'Check resident details and give a reason'; end if;
  select * into old_profile from public.profiles where id=p_user for update;
  if old_profile.id is null or old_profile.role<>'resident' then raise exception 'Resident account not found'; end if;
  update public.profiles set display_name=btrim(p_name),barangay_id=p_barangay,
    account_status=p_status,notifications_enabled=p_notifications where id=p_user;
  insert into public.audit_logs(actor_id,entity,record_id,action,old_value,new_value)
    values(auth.uid(),'resident_account',p_user::text,'MANAGE',to_jsonb(old_profile),
      jsonb_build_object('display_name',btrim(p_name),'barangay_id',p_barangay,'account_status',p_status,
        'notifications_enabled',p_notifications,'reason',btrim(p_reason)));
end $$;

create function private.report_personnel(p_id uuid) returns table(id uuid,display_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.report_action(p_id,'review') or not private.sample_report_visible(p_id) then
    raise exception 'Not authorized' using errcode='42501'; end if;
  return query select p.id,p.display_name from public.profiles p join public.reports r on r.id=p_id
    where p.role='barangay' and p.account_status='active' and p.barangay_id=r.barangay_id
    order by p.display_name,p.id;
end $$;

create function private.link_action_evidence(p_id uuid,p_action bigint,p_evidence uuid[]) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if coalesce(cardinality(p_evidence),0)>10 then raise exception 'Link up to 10 photos per action'; end if;
  if exists(select 1 from unnest(p_evidence) id where id is null)
    or (select count(*) from public.report_attachments where id=any(p_evidence) and report_id=p_id and action_id is null)
      <>coalesce(cardinality(p_evidence),0) then raise exception 'Choose unlinked photos from this report'; end if;
  update public.report_attachments set action_id=p_action where id=any(p_evidence);
end $$;
revoke all on function private.link_action_evidence(uuid,bigint,uuid[]) from public,anon,authenticated;

create function private.assign_barangay_personnel(p_id uuid,p_person uuid,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.reports;
begin
  select * into r from public.reports where id=p_id for update;
  if r.id is null or not private.report_action(p_id,'review') or not private.sample_report_visible(p_id)
    or not exists(select 1 from public.profiles where id=auth.uid() and
      (private.is_admin() or (role='barangay' and barangay_id=r.barangay_id and account_status='active')))
    then raise exception 'Not authorized' using errcode='42501'; end if;
  if r.status not in ('under_review','verified','in_progress') or r.organization_id is not null
    or not coalesce(private.valid_input_text(p_note,5,4000),false) then raise exception 'Assign an active local case with a reason'; end if;
  if p_person is not null and not exists(select 1 from public.profiles where id=p_person
    and role='barangay' and account_status='active' and barangay_id=r.barangay_id)
    then raise exception 'Choose active personnel from the report barangay'; end if;
  if r.assigned_to is not distinct from p_person then return; end if;
  update public.reports set assigned_to=p_person where id=p_id;
  insert into public.report_status_history(report_id,actor_id,old_status,new_status,public_note,action_kind)
    values(p_id,auth.uid(),r.status,r.status,btrim(p_note),'personnel_assignment');
  insert into public.notifications(user_id,title,report_id)
    select p.id,'A barangay report has been assigned to you',p_id from public.profiles p
    where p.id=p_person and p.notifications_enabled and p.id<>auth.uid();
end $$;

create function private.record_report_update(p_id uuid,p_note text,p_evidence uuid[] default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare r public.reports; event_id bigint;
begin
  select * into r from public.reports where id=p_id for update;
  if r.id is null or not (private.report_action(p_id,'update') or private.report_action(p_id,'review'))
    or not private.sample_report_visible(p_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  if r.status not in ('under_review','verified','assigned','in_progress')
    or not coalesce(private.valid_input_text(p_note,5,4000),false)
    then raise exception 'Record a clear update on an active report'; end if;
  insert into public.report_status_history(report_id,actor_id,old_status,new_status,public_note,action_kind)
    values(p_id,auth.uid(),r.status,r.status,btrim(p_note),'progress_update') returning id into event_id;
  perform private.link_action_evidence(p_id,event_id,p_evidence);
  insert into public.notifications(user_id,title,report_id)
    select p.id,'A followed report has a progress update',p_id from public.profiles p
    where p.notifications_enabled and (p.id=r.resident_id or exists(
      select 1 from public.report_followers f where f.report_id=p_id and f.user_id=p.id));
end $$;

create function private.report_action_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_read_report(p_id) or not private.sample_report_visible(p_id) then
    raise exception 'Not authorized' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'old_status',h.old_status,
    'new_status',h.new_status,'public_note',h.public_note,'created_at',h.created_at,
    'action_kind',h.action_kind,'actor_name',p.display_name,
    'attachment_count',(select count(*) from public.report_attachments a where a.action_id=h.id))
    order by h.created_at,h.id) from public.report_status_history h
    join public.profiles p on p.id=h.actor_id where h.report_id=p_id),'[]'::jsonb);
end $$;

create function public.report_residents(p_ids uuid[],p_contact boolean default false) returns jsonb
language sql security invoker set search_path='' as $$ select private.report_residents(p_ids,p_contact) $$;
revoke all on function private.report_residents(uuid[],boolean) from public,anon;
grant execute on function private.report_residents(uuid[],boolean) to authenticated;

create function public.admin_residents(p_search text default '',p_barangay uuid default null,p_status text default null,p_sort text default 'name',p_offset int default 0) returns jsonb
language sql security invoker set search_path='' as $$ select private.admin_residents(p_search,p_barangay,p_status,p_sort,p_offset) $$;
revoke all on function private.admin_residents(text,uuid,text,text,int) from public,anon;
grant execute on function private.admin_residents(text,uuid,text,text,int) to authenticated;

create function public.admin_update_resident(p_user uuid,p_name text,p_barangay uuid,p_status text,p_notifications boolean,p_reason text) returns void
language sql security invoker set search_path='' as $$ select private.admin_update_resident(p_user,p_name,p_barangay,p_status,p_notifications,p_reason) $$;
revoke all on function private.admin_update_resident(uuid,text,uuid,text,boolean,text) from public,anon;
grant execute on function private.admin_update_resident(uuid,text,uuid,text,boolean,text) to authenticated;

create function public.report_personnel(p_id uuid) returns table(id uuid,display_name text)
language sql security invoker set search_path='' as $$ select * from private.report_personnel(p_id) $$;
revoke all on function private.report_personnel(uuid) from public,anon;
grant execute on function private.report_personnel(uuid) to authenticated;

create function public.assign_barangay_personnel(p_id uuid,p_person uuid,p_note text) returns void
language sql security invoker set search_path='' as $$ select private.assign_barangay_personnel(p_id,p_person,p_note) $$;
revoke all on function private.assign_barangay_personnel(uuid,uuid,text) from public,anon;
grant execute on function private.assign_barangay_personnel(uuid,uuid,text) to authenticated;

create function public.record_report_update(p_id uuid,p_note text,p_evidence uuid[] default '{}') returns void
language sql security invoker set search_path='' as $$ select private.record_report_update(p_id,p_note,p_evidence) $$;
revoke all on function private.record_report_update(uuid,text,uuid[]) from public,anon;
grant execute on function private.record_report_update(uuid,text,uuid[]) to authenticated;

create function public.report_action_history(p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.report_action_history(p_id) $$;
revoke all on function private.report_action_history(uuid) from public,anon;
grant execute on function private.report_action_history(uuid) to authenticated;

revoke all on function public.report_residents(uuid[],boolean),
  public.admin_residents(text,uuid,text,text,int),public.admin_update_resident(uuid,text,uuid,text,boolean,text),
  public.report_personnel(uuid),public.assign_barangay_personnel(uuid,uuid,text),
  public.record_report_update(uuid,text,uuid[]),public.report_action_history(uuid) from public,anon;
grant execute on function public.report_residents(uuid[],boolean),
  public.admin_residents(text,uuid,text,text,int),public.admin_update_resident(uuid,text,uuid,text,boolean,text),
  public.report_personnel(uuid),public.assign_barangay_personnel(uuid,uuid,text),
  public.record_report_update(uuid,text,uuid[]),public.report_action_history(uuid) to authenticated;

-- Extend the existing status operation without exposing an ambiguous overload.
drop function public.change_report(uuid,public.report_status,text,uuid,integer,uuid,text,integer);
CREATE OR REPLACE FUNCTION public.change_report(p_id uuid, p_status public.report_status, p_note text, p_organization uuid DEFAULT NULL::uuid, p_severity integer DEFAULT NULL::integer, p_duplicate uuid DEFAULT NULL::uuid, p_public_summary text DEFAULT NULL::text, p_urgency integer DEFAULT NULL::integer, p_evidence uuid[] DEFAULT '{}'::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.reports; allowed boolean; event_id bigint; begin
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
if not coalesce(private.valid_input_text(p_note,5,4000),false) then raise exception 'Provide an action reason'; end if;
allowed := case r.status when 'submitted' then p_status in ('under_review','rejected','duplicate') when 'under_review' then p_status in ('verified','rejected','duplicate') when 'verified' then p_status in ('assigned','in_progress','duplicate') when 'assigned' then p_status in ('in_progress','duplicate') when 'in_progress' then p_status in ('resolved','assigned') else p_status='under_review' end;
if not allowed then raise exception 'Invalid status transition'; end if;
if r.status='verified' and p_status='in_progress' and (r.organization_id is not null or not exists(select 1 from public.profiles where id=auth.uid() and account_status='active' and (role='admin' or (role='barangay' and barangay_id=r.barangay_id)))) then raise exception 'Only barangay personnel can start verified local work'; end if;
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
update public.reports set status=p_status,organization_id=case when p_status='under_review' then null else coalesce(p_organization,organization_id) end,assigned_to=case when p_status in ('assigned','under_review','duplicate') then null when p_status='in_progress' and r.organization_id is null then coalesce(assigned_to,(select id from public.profiles where id=auth.uid() and role='barangay')) else assigned_to end,severity=case when p_status='verified' then p_severity else severity end,urgency=case when p_status='verified' then p_urgency else urgency end,verified_at=case when p_status='verified' then now() when p_status='under_review' then null else verified_at end,public_summary=case when p_status='verified' then coalesce(nullif(trim(p_public_summary),''),public_summary) else public_summary end,public_visible=case when p_status in ('rejected','duplicate','under_review') then false when p_status='verified' and nullif(trim(p_public_summary),'') is not null then true else public_visible end where id=p_id;
if p_status='verified' then
  insert into public.report_assessments(report_id,actor_id,severity,urgency,note) values(p_id,auth.uid(),p_severity,p_urgency,btrim(p_note));
end if;
insert into public.report_status_history(report_id,actor_id,old_status,new_status,public_note) values(p_id,auth.uid(),r.status,p_status,btrim(p_note)) returning id into event_id;
perform private.link_action_evidence(p_id,event_id,p_evidence);
if p_organization is not null then insert into public.report_assignments(report_id,organization_id,actor_id,reason) values(p_id,p_organization,auth.uid(),p_note); end if;
insert into public.notifications(user_id,title,report_id) select p.id,'A followed report has an update',p_id from public.profiles p where p.notifications_enabled and (p.id=r.resident_id or exists(select 1 from public.report_followers f where f.report_id=p_id and f.user_id=p.id));
end$function$;
revoke all on function public.change_report(uuid,public.report_status,text,uuid,integer,uuid,text,integer,uuid[]) from public,anon;
grant execute on function public.change_report(uuid,public.report_status,text,uuid,integer,uuid,text,integer,uuid[]) to authenticated;

notify pgrst,'reload schema';
