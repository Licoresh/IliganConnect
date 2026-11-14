create function private.sample_report_visible(p_report uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.reports where id=p_report and (not is_demo or private.sample_data_enabled()))
$$;
create policy attachment_sample_scope on public.report_attachments as restrictive for select to authenticated
  using (private.sample_report_visible(report_id));

create function private.sample_storage_visible(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.sample_data_enabled() or case p_bucket
    when 'report-evidence' then not exists(select 1 from public.reports where id::text=(storage.foldername(p_path))[2] and is_demo)
    when 'announcement-media' then not exists(select 1 from public.announcements where id::text=(storage.foldername(p_path))[1] and is_sample)
    else true end
$$;
create policy storage_sample_scope on storage.objects as restrictive for select to authenticated
  using (private.sample_storage_visible(bucket_id,name));

create or replace function private.is_public_report(r uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select (private.active_resident() or private.active_staff()) and exists(
    select 1 from public.reports where id=r and public_visible and public_summary is not null
      and status not in ('duplicate','rejected') and (not is_demo or private.sample_data_enabled()))
$$;
revoke all on function private.sample_report_visible(uuid),private.sample_storage_visible(text,text) from public,anon;
grant execute on function private.sample_report_visible(uuid),private.sample_storage_visible(text,text) to authenticated;
