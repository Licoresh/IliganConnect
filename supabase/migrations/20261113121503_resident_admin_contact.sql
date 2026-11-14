set local lock_timeout = '5s';

drop function public.admin_update_resident(uuid,text,uuid,text,boolean,text);
drop function private.admin_update_resident(uuid,text,uuid,text,boolean,text);

create function private.admin_update_resident(
  p_user uuid,
  p_name text,
  p_barangay uuid,
  p_phone text,
  p_status text,
  p_notifications boolean,
  p_reason text
) returns void
language plpgsql security definer set search_path='' as $$
declare old_profile public.profiles;
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if not coalesce(private.valid_input_text(p_name,2,100),false)
    or not coalesce(private.valid_input_text(p_reason,5,500),false)
    or (p_phone is not null and p_phone !~ '^\+639[0-9]{9}$')
    or p_status is null or p_status not in ('active','pending','disabled')
    or p_notifications is null
    or not exists(select 1 from public.barangays where id=p_barangay) then
    raise exception 'Check resident details and give a valid change reason';
  end if;

  select * into old_profile from public.profiles where id=p_user for update;
  if old_profile.id is null or old_profile.role<>'resident' then
    raise exception 'Resident account not found';
  end if;

  update public.profiles set display_name=btrim(p_name),barangay_id=p_barangay,
    phone=p_phone,account_status=p_status,notifications_enabled=p_notifications
  where id=p_user;

  insert into public.audit_logs(actor_id,entity,record_id,action,old_value,new_value)
    values(auth.uid(),'resident_account',p_user::text,'MANAGE',to_jsonb(old_profile),
      jsonb_build_object('display_name',btrim(p_name),'barangay_id',p_barangay,
        'phone',p_phone,'account_status',p_status,
        'notifications_enabled',p_notifications,'reason',btrim(p_reason)));
end $$;
revoke all on function private.admin_update_resident(uuid,text,uuid,text,text,boolean,text) from public,anon;
grant execute on function private.admin_update_resident(uuid,text,uuid,text,text,boolean,text) to authenticated;

create function public.admin_update_resident(
  p_user uuid,
  p_name text,
  p_barangay uuid,
  p_phone text,
  p_status text,
  p_notifications boolean,
  p_reason text
) returns void
language sql security invoker set search_path='' as $$
  select private.admin_update_resident(p_user,p_name,p_barangay,p_phone,p_status,p_notifications,p_reason)
$$;
revoke all on function public.admin_update_resident(uuid,text,uuid,text,text,boolean,text) from public,anon;
grant execute on function public.admin_update_resident(uuid,text,uuid,text,text,boolean,text) to authenticated;
