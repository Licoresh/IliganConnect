create or replace function private.require_resident_terms_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
  v_registration_type text := new.raw_user_meta_data ->> 'registration_type';
begin
  if v_registration_type = 'resident' or v_provider in ('google', 'facebook') then
    if new.raw_user_meta_data ->> 'terms_version' is distinct from '2026-11-15'
       or nullif(btrim(new.raw_user_meta_data ->> 'terms_accepted_at'), '') is null then
      raise exception 'Review and accept the current Iligan Connect Terms before creating a resident account';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.require_resident_terms_on_signup() from public, anon, authenticated;

drop trigger if exists require_resident_terms_on_signup on auth.users;
create trigger require_resident_terms_on_signup
before insert on auth.users
for each row
execute function private.require_resident_terms_on_signup();
