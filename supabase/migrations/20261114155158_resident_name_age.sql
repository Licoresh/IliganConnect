set local lock_timeout = '5s';

alter table public.profiles
  add column first_name text,
  add column middle_name text,
  add column last_name text,
  add column age smallint,
  add constraint profiles_first_name_input_limits
    check (first_name is null or private.valid_input_text(first_name, 1, 60)),
  add constraint profiles_middle_name_input_limits
    check (middle_name is null or private.valid_input_text(middle_name, 1, 60)),
  add constraint profiles_last_name_input_limits
    check (last_name is null or private.valid_input_text(last_name, 1, 60)),
  add constraint profiles_name_parts_pair
    check ((first_name is null and middle_name is null and last_name is null)
      or (first_name is not null and last_name is not null)),
  add constraint profiles_age_range check (age is null or age between 1 and 120);

create function private.sync_profile_name_parts()
returns trigger
language plpgsql set search_path=''
as $$
begin
  if new.first_name is null and new.middle_name is null and new.last_name is null then
    return new;
  end if;
  if not coalesce(private.valid_input_text(new.first_name,1,60),false)
    or not coalesce(private.valid_input_text(new.last_name,1,60),false)
    or (new.middle_name is not null and not coalesce(private.valid_input_text(new.middle_name,1,60),false)) then
    raise exception 'Enter a valid first name and last name; middle name is optional';
  end if;
  new.display_name := concat_ws(' ',new.first_name,new.middle_name,new.last_name);
  if not coalesce(private.valid_input_text(new.display_name,2,100),false) then
    raise exception 'The full name must be no longer than 100 characters';
  end if;
  return new;
end;
$$;
revoke all on function private.sync_profile_name_parts() from public,anon;
grant execute on function private.sync_profile_name_parts() to authenticated;
create trigger sync_profile_name_parts
  before insert or update on public.profiles
  for each row execute function private.sync_profile_name_parts();

grant update(first_name, middle_name, last_name, age)
  on public.profiles to authenticated;

create or replace function public.new_profile()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  profile_name text;
  profile_first_name text;
  profile_middle_name text;
  profile_last_name text;
  profile_age integer;
  profile_age_text text;
  profile_phone text;
  profile_barangay uuid;
begin
  profile_name := coalesce(
    nullif(left(trim(new.raw_user_meta_data->>'display_name'), 100), ''),
    nullif(left(trim(new.raw_user_meta_data->>'full_name'), 100), ''),
    nullif(left(trim(new.raw_user_meta_data->>'name'), 100), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Resident'
  );

  if new.raw_user_meta_data->>'registration_type' = 'resident' then
    profile_first_name := nullif(btrim(new.raw_user_meta_data->>'first_name'), '');
    profile_middle_name := nullif(btrim(new.raw_user_meta_data->>'middle_name'), '');
    profile_last_name := nullif(btrim(new.raw_user_meta_data->>'last_name'), '');
    if not coalesce(private.valid_input_text(profile_first_name, 1, 60), false)
      or not coalesce(private.valid_input_text(profile_last_name, 1, 60), false)
      or (profile_middle_name is not null and not coalesce(private.valid_input_text(profile_middle_name, 1, 60), false)) then
      raise exception 'Enter a valid first name and last name; middle name is optional';
    end if;

    profile_name := concat_ws(' ', profile_first_name, profile_middle_name, profile_last_name);
    if not coalesce(private.valid_input_text(profile_name, 2, 100), false) then
      raise exception 'The full name must be no longer than 100 characters';
    end if;

    profile_age_text := btrim(coalesce(new.raw_user_meta_data->>'age', ''));
    if profile_age_text !~ '^[0-9]{1,3}$' then
      raise exception 'Enter an age as a whole number from 1 to 120';
    end if;
    profile_age := profile_age_text::integer;
    if profile_age not between 1 and 120 then
      raise exception 'Enter an age as a whole number from 1 to 120';
    end if;

    begin
      profile_barangay := nullif(new.raw_user_meta_data->>'barangay_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Choose a valid registered barangay before creating a resident account';
    end;
    if profile_barangay is null or not exists (
      select 1 from public.barangays where id = profile_barangay
    ) then
      raise exception 'Choose a valid registered barangay before creating a resident account';
    end if;

    profile_phone := nullif(btrim(new.raw_user_meta_data->>'phone'), '');
    if profile_phone is not null and profile_phone !~ '^\+639[0-9]{9}$' then
      raise exception 'Enter a valid Philippine mobile number';
    end if;
  end if;

  insert into public.profiles(
    id, display_name, first_name, middle_name, last_name, age, barangay_id, phone
  ) values (
    new.id, profile_name, profile_first_name, profile_middle_name, profile_last_name,
    profile_age, profile_barangay, profile_phone
  ) on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.admin_residents(
  p_search text default '',
  p_barangay uuid default null,
  p_status text default null,
  p_sort text default 'name',
  p_offset int default 0
) returns jsonb
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
      and (coalesce(p_search,'')='' or strpos(lower(concat_ws(' ',p.display_name,p.first_name,p.middle_name,p.last_name,u.email,p.phone,u.phone)),lower(p_search))>0);
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into items from (
    select p.id,p.display_name,p.first_name,p.middle_name,p.last_name,p.age,
      p.barangay_id,p.account_status,p.notifications_enabled,
      u.email,coalesce(nullif(p.phone,''),nullif(u.phone,'')) as phone,
      u.created_at,u.last_sign_in_at
    from public.profiles p join auth.users u on u.id=p.id
    where p.role='resident' and (p_barangay is null or p.barangay_id=p_barangay)
      and (p_status is null or p.account_status=p_status)
      and (coalesce(p_search,'')='' or strpos(lower(concat_ws(' ',p.display_name,p.first_name,p.middle_name,p.last_name,u.email,p.phone,u.phone)),lower(p_search))>0)
    order by case when p_sort='name' then lower(p.display_name) end,
      case when p_sort='newest' then u.created_at end desc,
      case when p_sort='oldest' then u.created_at end,p.id
    limit 25 offset p_offset
  ) rows;
  return jsonb_build_object('items',items,'total',total);
end $$;

drop function public.admin_update_resident(uuid,text,uuid,text,text,boolean,text);
drop function private.admin_update_resident(uuid,text,uuid,text,text,boolean,text);

create function private.admin_update_resident(
  p_user uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_age smallint,
  p_barangay uuid,
  p_phone text,
  p_status text,
  p_notifications boolean,
  p_reason text
) returns void
language plpgsql security definer set search_path='' as $$
declare
  old_profile public.profiles;
  next_first_name text;
  next_middle_name text;
  next_last_name text;
  next_display_name text;
  has_name_parts boolean;
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  next_first_name := nullif(btrim(p_first_name), '');
  next_middle_name := nullif(btrim(p_middle_name), '');
  next_last_name := nullif(btrim(p_last_name), '');
  has_name_parts := next_first_name is not null or next_middle_name is not null or next_last_name is not null;

  if p_age is not null and p_age not between 1 and 120 then
    raise exception 'Enter an age from 1 to 120';
  end if;
  if has_name_parts then
    if not coalesce(private.valid_input_text(next_first_name,1,60),false)
      or not coalesce(private.valid_input_text(next_last_name,1,60),false)
      or (next_middle_name is not null and not coalesce(private.valid_input_text(next_middle_name,1,60),false)) then
      raise exception 'Enter a valid first name and last name; middle name is optional';
    end if;
    next_display_name := concat_ws(' ',next_first_name,next_middle_name,next_last_name);
    if not coalesce(private.valid_input_text(next_display_name,2,100),false) then
      raise exception 'The full name must be no longer than 100 characters';
    end if;
  end if;

  if not coalesce(private.valid_input_text(p_reason,5,500),false)
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

  update public.profiles set
    display_name=case when has_name_parts then next_display_name else old_profile.display_name end,
    first_name=case when has_name_parts then next_first_name else old_profile.first_name end,
    middle_name=case when has_name_parts then next_middle_name else old_profile.middle_name end,
    last_name=case when has_name_parts then next_last_name else old_profile.last_name end,
    age=coalesce(p_age,old_profile.age),
    barangay_id=p_barangay,phone=p_phone,account_status=p_status,
    notifications_enabled=p_notifications
  where id=p_user;

  insert into public.audit_logs(actor_id,entity,record_id,action,old_value,new_value)
    values(auth.uid(),'resident_account',p_user::text,'MANAGE',to_jsonb(old_profile),
      jsonb_build_object('display_name',case when has_name_parts then next_display_name else old_profile.display_name end,
        'first_name',case when has_name_parts then next_first_name else old_profile.first_name end,
        'middle_name',case when has_name_parts then next_middle_name else old_profile.middle_name end,
        'last_name',case when has_name_parts then next_last_name else old_profile.last_name end,
        'age',coalesce(p_age,old_profile.age),'barangay_id',p_barangay,
        'phone',p_phone,'account_status',p_status,
        'notifications_enabled',p_notifications,'reason',btrim(p_reason)));
end $$;
revoke all on function private.admin_update_resident(uuid,text,text,text,smallint,uuid,text,text,boolean,text) from public,anon;
grant execute on function private.admin_update_resident(uuid,text,text,text,smallint,uuid,text,text,boolean,text) to authenticated;

create function public.admin_update_resident(
  p_user uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_age smallint,
  p_barangay uuid,
  p_phone text,
  p_status text,
  p_notifications boolean,
  p_reason text
) returns void
language sql security invoker set search_path='' as $$
  select private.admin_update_resident(
    p_user,p_first_name,p_middle_name,p_last_name,p_age,p_barangay,p_phone,
    p_status,p_notifications,p_reason
  )
$$;
revoke all on function public.admin_update_resident(uuid,text,text,text,smallint,uuid,text,text,boolean,text) from public,anon;
grant execute on function public.admin_update_resident(uuid,text,text,text,smallint,uuid,text,text,boolean,text) to authenticated;
