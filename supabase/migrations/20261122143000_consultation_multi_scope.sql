alter table public.consultations
  add column target_barangay_ids uuid[] not null default '{}',
  add column target_organization_ids uuid[] not null default '{}',
  add column include_barangay_admins boolean not null default true;

update public.consultations
   set target_barangay_ids = array[barangay_id],
       target_organization_ids = case when organization_id is null then '{}'::uuid[] else array[organization_id] end;

create index consultations_target_barangays on public.consultations using gin(target_barangay_ids);
create index consultations_target_organizations on public.consultations using gin(target_organization_ids);

create or replace function private.consultation_scope_access(p_id uuid)
returns boolean
language sql stable security definer set search_path=''
as $$
select exists (
  select 1
    from public.consultations c
    join public.profiles p on p.id=auth.uid() and p.account_status='active'
   where c.id=p_id
     and (
       p.role='admin'
       or (p.role='barangay' and p.barangay_id is not null and (
         p.barangay_id=c.barangay_id
         or (c.include_barangay_admins and p.barangay_id=any(coalesce(nullif(c.target_barangay_ids,'{}'::uuid[]),array[c.barangay_id])))
       ))
       or (p.role='office' and exists (
         select 1
           from public.organization_memberships m
           join public.organizations o on o.id=m.organization_id and o.active and o.can_consult
          where m.user_id=p.id
            and o.id=any(coalesce(nullif(c.target_organization_ids,'{}'::uuid[]),array[c.organization_id]))
       ))
     )
)
$$;
revoke all on function private.consultation_scope_access(uuid) from public,anon;
grant execute on function private.consultation_scope_access(uuid) to authenticated;

create or replace function private.validate_consultation_scope()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  v_profile public.profiles;
  v_barangays uuid[];
  v_organizations uuid[];
begin
  if tg_op='UPDATE'
     and row(new.barangay_id,new.organization_id,new.target_barangay_ids,new.target_organization_ids,new.include_barangay_admins)
         is not distinct from
         row(old.barangay_id,old.organization_id,old.target_barangay_ids,old.target_organization_ids,old.include_barangay_admins) then
    return new;
  end if;

  select * into v_profile from public.profiles where id=auth.uid() and account_status='active';
  if v_profile.id is null or v_profile.role not in ('admin','barangay','office') then
    raise exception 'An active staff account is required to set consultation scope';
  end if;

  v_barangays := coalesce(nullif(new.target_barangay_ids,'{}'::uuid[]),array[new.barangay_id]);
  v_organizations := coalesce(new.target_organization_ids,'{}'::uuid[]);
  if new.barangay_id is null or cardinality(v_barangays)=0 or not (new.barangay_id=any(v_barangays)) then
    raise exception 'Choose at least one barangay and keep the primary location in its scope';
  end if;
  if exists(select 1 from unnest(v_barangays) as selected(value) where selected.value is null)
     or cardinality(v_barangays)<>(select count(distinct selected.value) from unnest(v_barangays) as selected(value)) then
    raise exception 'Barangay selections must be unique and valid';
  end if;
  if exists(select 1 from unnest(v_organizations) as selected(value) where selected.value is null)
     or cardinality(v_organizations)<>(select count(distinct selected.value) from unnest(v_organizations) as selected(value)) then
    raise exception 'Office selections must be unique and valid';
  end if;
  if exists(select 1 from unnest(v_barangays) as selected(value) where not exists(select 1 from public.barangays b where b.id=selected.value)) then
    raise exception 'One or more selected barangays no longer exist';
  end if;
  if exists(select 1 from unnest(v_organizations) as selected(value) where not exists(select 1 from public.organizations o where o.id=selected.value)) then
    raise exception 'One or more selected offices no longer exist';
  end if;
  if cardinality(v_organizations)=0 and not new.include_barangay_admins and v_profile.role<>'barangay' then
    raise exception 'Choose an issuing office or include barangay administration';
  end if;

  if v_profile.role='barangay' then
    if v_profile.barangay_id is null or new.barangay_id<>v_profile.barangay_id
       or exists(select 1 from unnest(v_barangays) as selected(value) where selected.value<>v_profile.barangay_id) then
      raise exception 'Barangay staff can only create consultations for their assigned barangay';
    end if;
    if exists(select 1 from unnest(v_organizations) as selected(value) where not exists(
      select 1 from public.organizations o where o.id=selected.value and o.active and o.can_consult
    )) then
      raise exception 'Choose active offices that can participate in consultations';
    end if;
    new.include_barangay_admins := true;
  elsif v_profile.role='office' then
    if cardinality(v_organizations)=0 or new.organization_id is null or not (new.organization_id=any(v_organizations)) then
      raise exception 'Choose at least one of your consultation-enabled offices';
    end if;
    if exists(select 1 from unnest(v_organizations) as selected(value) where not exists(
      select 1 from public.organization_memberships m
      join public.organizations o on o.id=m.organization_id and o.active and o.can_consult
      where m.user_id=v_profile.id and o.id=selected.value
    )) then
      raise exception 'Office staff can only select their own active consultation-enabled offices';
    end if;
    if exists(select 1 from unnest(v_barangays) as selected(value) where not exists(
      select 1 from unnest(v_organizations) as picked(organization_id)
      join public.organization_access_rules a on a.organization_id=picked.organization_id and a.enabled
      where a.barangay_id is null or a.barangay_id=selected.value
    )) then
      raise exception 'One or more barangays are outside your selected offices’ consultation scope';
    end if;
    new.include_barangay_admins := true;
  end if;

  if new.organization_id is not null and not (new.organization_id=any(v_organizations)) then
    raise exception 'The primary office must be one of the selected offices';
  end if;
  return new;
end
$$;
revoke all on function private.validate_consultation_scope() from public,anon,authenticated;
drop trigger if exists validate_consultation_scope on public.consultations;
create trigger validate_consultation_scope
  before insert or update on public.consultations
  for each row execute function private.validate_consultation_scope();

create or replace function public.community_permissions(p_table text,p_id uuid)
returns boolean language sql stable security invoker set search_path=''
as $$
select case p_table
  when 'consultations' then private.consultation_scope_access(p_id)
  when 'announcements' then exists(select 1 from public.announcements a where a.id=p_id and private.community_access(a.barangay_id,a.organization_id,'announcements'))
  when 'meeting_requests' then private.meeting_access(p_id,'manage')
  else false
end
$$;

drop policy consultations_read on public.consultations;
create policy consultations_read on public.consultations for select to authenticated
  using(status in ('open','closed') or private.consultation_scope_access(id));
drop policy consultations_staff on public.consultations;
create policy consultations_staff on public.consultations for all to authenticated
  using(private.consultation_scope_access(id)) with check(private.active_staff());

drop policy comments_read on public.consultation_comments;
create policy comments_read on public.consultation_comments for select to authenticated
  using(exists(select 1 from public.consultations c where c.id=consultation_id and (not hidden or private.consultation_scope_access(c.id))));
drop policy comments_moderate on public.consultation_comments;
create policy comments_moderate on public.consultation_comments for update to authenticated
  using(exists(select 1 from public.consultations c where c.id=consultation_id and private.consultation_scope_access(c.id)))
  with check(exists(select 1 from public.consultations c where c.id=consultation_id and private.consultation_scope_access(c.id)) and moderation_reason is not null);
drop policy flags_staff_read on public.comment_flags;
create policy flags_staff_read on public.comment_flags for select to authenticated
  using(exists(select 1 from public.consultation_comments cc join public.consultations c on c.id=cc.consultation_id where cc.id=comment_id and private.consultation_scope_access(c.id)));
drop policy flags_staff_delete on public.comment_flags;
create policy flags_staff_delete on public.comment_flags for delete to authenticated
  using(exists(select 1 from public.consultation_comments cc join public.consultations c on c.id=cc.consultation_id where cc.id=comment_id and private.consultation_scope_access(c.id)));

create or replace function private.mark_official_comment()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  select private.consultation_scope_access(c.id) into new.official
    from public.consultations c where c.id=new.consultation_id;
  new.official=coalesce(new.official,false);
  return new;
end
$$;

create or replace function private.notify_consultation_lifecycle()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
  v_opened boolean;
  v_barangays uuid[];
begin
  if new.is_sample then return new; end if;
  v_barangays := coalesce(nullif(new.target_barangay_ids,'{}'::uuid[]),array[new.barangay_id]);
  if tg_op='INSERT' then
    v_opened := new.status='open';
  else
    v_opened := new.status='open' and old.status is distinct from new.status;
  end if;
  if v_opened and new.closes_at>now() then
    insert into public.notifications(user_id,title,consultation_id)
    select p.id,
      case when new.opens_at>now() then 'A community consultation is scheduled' else 'A new community consultation is open' end,
      new.id
      from public.profiles p
     where p.role='resident' and p.account_status='active' and p.notifications_enabled
       and p.barangay_id=any(v_barangays) and p.id is distinct from new.created_by;
  elsif tg_op='UPDATE' and old.status='open' and new.status in ('closed','archived') then
    insert into public.notifications(user_id,title,consultation_id)
    select p.id,'A consultation you follow has closed',new.id
      from public.consultation_followers f join public.profiles p on p.id=f.user_id
     where f.consultation_id=new.id and p.account_status='active' and p.notifications_enabled and p.id is distinct from auth.uid();
  elsif tg_op='UPDATE' and new.status='open'
    and row(new.title,new.body,new.opens_at,new.closes_at) is distinct from row(old.title,old.body,old.opens_at,old.closes_at) then
    insert into public.notifications(user_id,title,consultation_id)
    select p.id,'A consultation you follow has been updated',new.id
      from public.consultation_followers f join public.profiles p on p.id=f.user_id
     where f.consultation_id=new.id and p.account_status='active' and p.notifications_enabled and p.id is distinct from auth.uid();
  end if;
  return new;
end
$function$;
revoke all on function private.notify_consultation_lifecycle() from public,anon,authenticated;
drop trigger if exists consultation_lifecycle_notification on public.consultations;
create trigger consultation_lifecycle_notification
  after insert or update on public.consultations
  for each row execute function private.notify_consultation_lifecycle();
