create function public.provision_staff_account(
  p_user uuid,
  p_role text,
  p_barangay uuid default null,
  p_organization uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Not authorized'; end if;
  if p_role = 'barangay' then
    if p_barangay is null or p_organization is not null then raise exception 'Choose one barangay for barangay staff'; end if;
    if not exists(select 1 from public.barangays where id = p_barangay) then raise exception 'Barangay not found'; end if;
  elsif p_role = 'office' then
    if p_organization is null or p_barangay is not null then raise exception 'Choose one active organization for office staff'; end if;
    if not exists(select 1 from public.organizations where id = p_organization and active) then raise exception 'Active organization not found'; end if;
  else
    raise exception 'Choose barangay staff or office staff';
  end if;

  perform 1 from public.profiles where id = p_user and role = 'resident' and account_status = 'active' for update;
  if not found then
    raise exception 'New invited account not found or already assigned';
  end if;

  update public.profiles
  set role = p_role, barangay_id = p_barangay, account_status = 'pending'
  where id = p_user;

  delete from public.organization_memberships where user_id = p_user;
  if p_role = 'office' then
    insert into public.organization_memberships(user_id, organization_id)
    values (p_user, p_organization);
  end if;
end;
$$;

revoke all on function public.provision_staff_account(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.provision_staff_account(uuid, text, uuid, uuid) to authenticated;
