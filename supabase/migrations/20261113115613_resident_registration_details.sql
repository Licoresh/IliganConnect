set local lock_timeout = '5s';

alter table public.profiles
  add column phone text,
  add constraint profiles_phone_ph_mobile check (phone is null or phone ~ '^\+639[0-9]{9}$');

revoke update on public.profiles from authenticated;
grant update(display_name, barangay_id, notifications_enabled, avatar_path, phone)
  on public.profiles to authenticated;

create or replace function public.new_profile()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  profile_name text;
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
    if not coalesce(private.valid_input_text(profile_name, 2, 100), false) then
      raise exception 'Enter a valid full name before creating a resident account';
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

  insert into public.profiles(id, display_name, barangay_id, phone)
  values (new.id, profile_name, profile_barangay, profile_phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

create function public.signup_barangays()
returns table(id uuid, name text)
language sql stable security definer set search_path=''
as $$
  select b.id, b.name
  from public.barangays b
  order by b.name
$$;
revoke all on function public.signup_barangays() from public, anon, authenticated;
grant execute on function public.signup_barangays() to anon, authenticated;

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
      and (coalesce(p_search,'')='' or strpos(lower(concat_ws(' ',p.display_name,u.email,p.phone,u.phone)),lower(p_search))>0);
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into items from (
    select p.id,p.display_name,p.barangay_id,p.account_status,p.notifications_enabled,
      u.email,coalesce(nullif(p.phone,''),nullif(u.phone,'')) as phone,
      u.created_at,u.last_sign_in_at
    from public.profiles p join auth.users u on u.id=p.id
    where p.role='resident' and (p_barangay is null or p.barangay_id=p_barangay)
      and (p_status is null or p.account_status=p_status)
      and (coalesce(p_search,'')='' or strpos(lower(concat_ws(' ',p.display_name,u.email,p.phone,u.phone)),lower(p_search))>0)
    order by case when p_sort='name' then lower(p.display_name) end,
      case when p_sort='newest' then u.created_at end desc,
      case when p_sort='oldest' then u.created_at end,p.id
    limit 25 offset p_offset
  ) rows;
  return jsonb_build_object('items',items,'total',total);
end $$;
