set local lock_timeout = '5s';

create function private.barangay_residents(
  p_search text default '',
  p_sort text default 'name',
  p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  scope_barangay uuid;
  items jsonb;
  total bigint;
begin
  select p.barangay_id into scope_barangay
  from public.profiles p
  where p.id=auth.uid() and p.role='barangay' and p.account_status='active';

  if scope_barangay is null then
    raise exception 'Active barangay staff access is required' using errcode='42501';
  end if;
  if length(coalesce(p_search,''))>160 or p_offset is null or p_offset<0 or p_offset>1000000
    or p_sort is null or p_sort not in ('name','newest','oldest') then
    raise exception 'Invalid resident filters';
  end if;

  select count(*) into total
  from public.profiles p join auth.users u on u.id=p.id
  where p.role='resident' and p.barangay_id=scope_barangay
    and (coalesce(p_search,'')='' or strpos(lower(concat_ws(' ',p.display_name,p.first_name,p.middle_name,p.last_name,u.email,p.phone,u.phone)),lower(p_search))>0);

  select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into items from (
    select p.id,p.display_name,p.age,p.account_status,p.barangay_id,
      u.email,coalesce(nullif(p.phone,''),nullif(u.phone,'')) as phone,
      u.created_at
    from public.profiles p join auth.users u on u.id=p.id
    where p.role='resident' and p.barangay_id=scope_barangay
      and (coalesce(p_search,'')='' or strpos(lower(concat_ws(' ',p.display_name,p.first_name,p.middle_name,p.last_name,u.email,p.phone,u.phone)),lower(p_search))>0)
    order by case when p_sort='name' then lower(p.display_name) end,
      case when p_sort='newest' then u.created_at end desc,
      case when p_sort='oldest' then u.created_at end,p.id
    limit 25 offset p_offset
  ) rows;

  return jsonb_build_object('items',items,'total',total);
end $$;
revoke all on function private.barangay_residents(text,text,int) from public,anon;
grant execute on function private.barangay_residents(text,text,int) to authenticated;

create function public.barangay_residents(
  p_search text default '',
  p_sort text default 'name',
  p_offset int default 0
) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.barangay_residents(p_search,p_sort,p_offset)
$$;
revoke all on function public.barangay_residents(text,text,int) from public,anon;
grant execute on function public.barangay_residents(text,text,int) to authenticated;

create function private.admin_update_stakeholder_account(
  p_user uuid,
  p_role text,
  p_barangay uuid,
  p_status text,
  p_organization_ids uuid[]
) returns void
language plpgsql security definer set search_path='' as $$
declare
  old_profile public.profiles;
  next_status text;
  requested_organizations uuid[];
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(147205);

  if p_role is null or p_role not in ('barangay','office')
    or p_status is null or p_status not in ('pending','active','disabled') then
    raise exception 'Choose a valid stakeholder role and account status';
  end if;

  select * into old_profile from public.profiles where id=p_user for update;
  if old_profile.id is null or old_profile.role not in ('barangay','office') then
    raise exception 'Only barangay and office staff accounts can be managed here';
  end if;

  if p_barangay is not null and not exists(select 1 from public.barangays where id=p_barangay) then
    raise exception 'Choose a valid barangay';
  end if;
  if p_role='office' and p_barangay is not null then
    raise exception 'Office staff do not use a barangay jurisdiction';
  end if;

  select coalesce(array_agg(distinct requested.organization_id order by requested.organization_id),array[]::uuid[])
    into requested_organizations
  from unnest(coalesce(p_organization_ids,array[]::uuid[])) as requested(organization_id);

  if p_role='barangay' and cardinality(requested_organizations)>0 then
    raise exception 'Barangay staff accounts do not use office organization memberships';
  end if;

  if exists(
    select 1 from unnest(requested_organizations) as requested(organization_id)
    left join public.organizations o on o.id=requested.organization_id
    left join public.organization_memberships existing
      on existing.user_id=p_user and existing.organization_id=requested.organization_id
    where o.id is null or (not o.active and existing.user_id is null)
  ) then
    raise exception 'Choose active organizations; an existing inactive membership may be retained';
  end if;

  next_status := case when old_profile.role is distinct from p_role then 'pending' else p_status end;
  if next_status='active' and p_role='barangay' and p_barangay is null then
    raise exception 'Assign a barangay before activating this account';
  end if;
  if next_status='active' and p_role='office' and not exists(
    select 1 from unnest(requested_organizations) as requested(organization_id)
    join public.organizations o on o.id=requested.organization_id and o.active
  ) then
    raise exception 'Assign an active organization before activating this account';
  end if;

  update public.profiles set
    role=p_role,
    barangay_id=case when p_role='barangay' then p_barangay else null end,
    account_status=next_status
  where id=p_user;

  delete from public.organization_memberships m
  where m.user_id=p_user and not (m.organization_id=any(requested_organizations));
  insert into public.organization_memberships(user_id,organization_id)
  select p_user,requested.organization_id
  from unnest(requested_organizations) as requested(organization_id)
  on conflict(user_id,organization_id) do nothing;
end $$;
revoke all on function private.admin_update_stakeholder_account(uuid,text,uuid,text,uuid[]) from public,anon;
grant execute on function private.admin_update_stakeholder_account(uuid,text,uuid,text,uuid[]) to authenticated;

create function public.admin_update_stakeholder_account(
  p_user uuid,
  p_role text,
  p_barangay uuid,
  p_status text,
  p_organization_ids uuid[]
) returns void
language sql security invoker set search_path='' as $$
  select private.admin_update_stakeholder_account(p_user,p_role,p_barangay,p_status,p_organization_ids)
$$;
revoke all on function public.admin_update_stakeholder_account(uuid,text,uuid,text,uuid[]) from public,anon;
grant execute on function public.admin_update_stakeholder_account(uuid,text,uuid,text,uuid[]) to authenticated;
