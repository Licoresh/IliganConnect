alter table public.analytics_settings add column include_samples boolean not null default false;
alter table public.consultations add column is_sample boolean not null default false;
alter table public.meeting_requests add column is_sample boolean not null default false;
alter table public.announcements add column is_sample boolean not null default false;
grant select(is_sample) on public.meeting_requests to authenticated;

alter table public.report_attachments
  add column source_url text,
  add column attribution text,
  add column is_illustrative boolean not null default false,
  add constraint attachment_source_url check (source_url is null or (length(source_url)<=2000 and source_url ~ '^https://[^[:space:]]+$')),
  add constraint attachment_attribution_length check (attribution is null or length(attribution) between 1 and 1200),
  add constraint illustrative_attachment_credit check (not is_illustrative or (source_url is not null and attribution is not null));

create function private.sample_data_enabled() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select include_samples from public.analytics_settings where id),false)
$$;

-- RLS also covers invoker-based dashboards, maps, analytics and resident totals.
create policy report_sample_scope on public.reports as restrictive for select to authenticated
  using (not is_demo or (select private.sample_data_enabled()));
create policy consultation_sample_scope on public.consultations as restrictive for select to authenticated
  using (not is_sample or (select private.sample_data_enabled()));
create policy request_sample_scope on public.meeting_requests as restrictive for select to authenticated
  using (not is_sample or (select private.sample_data_enabled()));
create policy announcement_sample_scope on public.announcements as restrictive for select to authenticated
  using (not is_sample or (select private.sample_data_enabled()));

create function private.sample_request_visible(p_request uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.meeting_requests where id=p_request and (not is_sample or private.sample_data_enabled()))
$$;
create policy meeting_sample_scope on public.meetings as restrictive for select to authenticated
  using (private.sample_request_visible(request_id));

create function private.sample_notification_visible(p_report uuid,p_consultation uuid,p_request uuid,p_announcement uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.sample_data_enabled() or (
    not exists(select 1 from public.reports where id=p_report and is_demo)
    and not exists(select 1 from public.consultations where id=p_consultation and is_sample)
    and not exists(select 1 from public.meeting_requests where id=p_request and is_sample)
    and not exists(select 1 from public.announcements where id=p_announcement and is_sample))
$$;
create policy notification_sample_scope on public.notifications as restrictive for select to authenticated
  using (private.sample_notification_visible(report_id,consultation_id,meeting_request_id,announcement_id));

-- All public projections retain active-account checks and their privacy-limited columns.
do $$
declare endpoint record; definition text; updated integer:=0;
begin
  for endpoint in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname in ('public_reports','public_report_page','public_report_filter_counts'))
       or (n.nspname='private' and p.proname='published_report_by_id')
  loop
    definition:=pg_get_functiondef(endpoint.oid);
    if position('not r.is_demo' in definition)=0 then raise exception 'Public projection changed; inspect sample guard';end if;
    execute replace(definition,'not r.is_demo','(not r.is_demo or private.sample_data_enabled())');
    updated:=updated+1;
  end loop;
  if updated<>5 then raise exception 'Expected five public projections, found %',updated;end if;
end $$;

-- Website illustrations on published samples may be shared; actual case evidence stays private.
create function private.sample_attachment_readable(p_report uuid,p_illustrative boolean) returns boolean
language sql stable security definer set search_path='' as $$
  select p_illustrative and private.sample_data_enabled()
    and (private.active_resident() or private.active_staff())
    and exists(select 1 from public.reports where id=p_report and is_demo and public_visible
      and public_summary is not null and status not in ('rejected','duplicate'))
$$;
create policy sample_attachment_read on public.report_attachments for select to authenticated
  using (private.sample_attachment_readable(report_id,is_illustrative));

create function private.sample_image_readable(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.report_attachments a where a.path=p_path
    and private.sample_attachment_readable(a.report_id,a.is_illustrative))
$$;
create policy sample_image_read on storage.objects for select to authenticated
  using (bucket_id='report-evidence' and private.sample_image_readable(name));

revoke all on function private.sample_data_enabled(),private.sample_request_visible(uuid),
  private.sample_notification_visible(uuid,uuid,uuid,uuid),private.sample_attachment_readable(uuid,boolean),
  private.sample_image_readable(text) from public,anon;
grant execute on function private.sample_data_enabled(),private.sample_request_visible(uuid),
  private.sample_notification_visible(uuid,uuid,uuid,uuid),private.sample_attachment_readable(uuid,boolean),
  private.sample_image_readable(text) to authenticated;
