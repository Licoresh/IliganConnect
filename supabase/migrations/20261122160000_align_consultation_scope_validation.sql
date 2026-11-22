-- Keep consultation form choices, legacy single-scope writes, and staff access aligned.

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
       or (p.role='barangay' and p.barangay_id is not null
         and c.include_barangay_admins
         and p.barangay_id=any(coalesce(nullif(c.target_barangay_ids,'{}'::uuid[]),array[c.barangay_id])))
       or (p.role='office' and exists (
         select 1
           from public.organization_memberships m
           join public.organizations o on o.id=m.organization_id and o.active and o.can_consult
          where m.user_id=p.id
            and o.id=any(coalesce(nullif(c.target_organization_ids,'{}'::uuid[]),
              case when c.organization_id is null then '{}'::uuid[] else array[c.organization_id] end))
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
  v_organizations := coalesce(nullif(new.target_organization_ids,'{}'::uuid[]),
    case when new.organization_id is null then '{}'::uuid[] else array[new.organization_id] end);
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
  elsif v_profile.role='admin' and exists(
    select 1 from unnest(v_organizations) as selected(value)
    where not exists(select 1 from public.organizations o where o.id=selected.value and o.active and o.can_consult)
  ) then
    raise exception 'Choose active offices that can participate in consultations';
  end if;

  if new.organization_id is not null and not (new.organization_id=any(v_organizations)) then
    raise exception 'The primary office must be one of the selected offices';
  end if;
  return new;
end
$$;
revoke all on function private.validate_consultation_scope() from public,anon,authenticated;

notify pgrst, 'reload schema';
