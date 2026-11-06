alter table public.profiles
  add column avatar_path text,
  add constraint profiles_avatar_path_owner
    check (avatar_path is null or avatar_path like id::text || '/%');

revoke update on public.profiles from authenticated;
grant update(display_name, barangay_id, notifications_enabled, avatar_path)
  on public.profiles to authenticated;

create or replace function public.new_profile()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  insert into public.profiles(id, display_name)
  values (
    new.id,
    coalesce(
      nullif(left(trim(new.raw_user_meta_data->>'display_name'), 100), ''),
      nullif(left(trim(new.raw_user_meta_data->>'full_name'), 100), ''),
      nullif(left(trim(new.raw_user_meta_data->>'name'), 100), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Resident'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy profile_media_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy profile_media_upload_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy profile_media_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy profile_media_active_account on storage.objects as restrictive
  for all to authenticated
  using (bucket_id <> 'profile-media' or private.active_staff() or private.active_resident())
  with check (bucket_id <> 'profile-media' or private.active_staff() or private.active_resident());
