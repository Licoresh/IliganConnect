-- One publication notification per announcement. Internal-only delivery state.
create table private.announcement_deliveries (
  announcement_id uuid primary key references public.announcements(id) on delete cascade,
  delivered_at timestamptz not null default now()
);
alter table private.announcement_deliveries enable row level security;
revoke all on private.announcement_deliveries from public, anon, authenticated, service_role;

-- Do not replay historical announcements when enabling the worker.
insert into private.announcement_deliveries(announcement_id)
select id from public.announcements where status='published' and publish_at<=now()
union select announcement_id from public.notifications where announcement_id is not null;

create index announcements_due_publication on public.announcements(publish_at, id) where status='published';

-- Only the owner, the publication trigger and the database scheduler may invoke this.
create function private.deliver_announcement(p_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare a public.announcements; claimed uuid; recipients integer;
begin
  select * into a from public.announcements where id=p_id for update;
  if not found or a.status<>'published' or a.publish_at>now() then return 0; end if;
  insert into private.announcement_deliveries(announcement_id) values(a.id)
    on conflict do nothing returning announcement_id into claimed;
  if claimed is null then return 0; end if;
  insert into public.notifications(user_id,title,announcement_id)
    select p.id,'A new official announcement is available',a.id
    from public.profiles p
    where p.notifications_enabled and p.account_status='active'
      and (a.barangay_id is null or p.barangay_id=a.barangay_id);
  get diagnostics recipients = row_count;
  return recipients;
end $$;
revoke all on function private.deliver_announcement(uuid) from public, anon, authenticated, service_role;

create function private.announcement_publication_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.deliver_announcement(new.id);
  return new;
end $$;
revoke all on function private.announcement_publication_trigger() from public, anon, authenticated, service_role;

drop trigger community_notifications on public.announcements;
create trigger announcement_publication after insert or update on public.announcements
for each row execute function private.announcement_publication_trigger();

create function private.deliver_due_announcements() returns integer
language plpgsql security definer set search_path='' as $$
declare a record; recipients integer := 0;
begin
  for a in
    select announcement.id from public.announcements announcement
    where announcement.status='published' and announcement.publish_at<=now()
      and not exists(select 1 from private.announcement_deliveries d where d.announcement_id=announcement.id)
    order by announcement.publish_at,announcement.id
    limit 100 for update of announcement skip locked
  loop
    recipients := recipients + private.deliver_announcement(a.id);
  end loop;
  return recipients;
end $$;
revoke all on function private.deliver_due_announcements() from public, anon, authenticated, service_role;

create extension if not exists pg_cron;
select cron.schedule('iligan-announcement-publication','* * * * *','select private.deliver_due_announcements();');
