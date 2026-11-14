set local lock_timeout='5s';

create function public.report_linked_duplicates(p_id uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb; total integer;
begin
  if not private.active_staff() or not exists(select 1 from public.reports where id=p_id) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if p_offset is null or p_offset<0 or p_offset>1000000 then
    raise exception 'Choose a valid report page' using errcode='22023';
  end if;
  select count(*)::integer into total from public.report_duplicate_links l join public.reports r on r.id=l.report_id
    where l.canonical_id=p_id and r.status='duplicate';
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at,s.id),'[]'::jsonb) into rows from (
    select r.id,r.title,r.status,r.created_at,l.reason
    from public.report_duplicate_links l join public.reports r on r.id=l.report_id
    where l.canonical_id=p_id and r.status='duplicate'
    order by r.created_at,r.id limit 20 offset p_offset
  ) s;
  return jsonb_build_object('items',rows,'total_count',total,'offset',p_offset,'page_size',20);
end;
$$;
revoke all on function public.report_linked_duplicates(uuid,integer) from public,anon;
grant execute on function public.report_linked_duplicates(uuid,integer) to authenticated;

-- The duplicate owner may need progress even when the main submission is private.
-- This projection deliberately omits descriptions, locations, reporter IDs and free-text notes.
create function public.report_duplicate_progress(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.reports; main public.reports; updates jsonb; readable boolean; published boolean;
begin
  if not (private.active_resident() or private.active_staff()) or not private.can_read_report(p_id)
    or not private.sample_report_visible(p_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into source from public.reports where id=p_id;
  if source.status<>'duplicate' then return null; end if;
  select r.* into main from public.report_duplicate_links l join public.reports r on r.id=l.canonical_id
    where l.report_id=p_id and r.is_demo=source.is_demo and r.status not in ('duplicate','rejected')
      and (not r.is_demo or private.sample_data_enabled());
  if main.id is null then return null; end if;
  readable:=private.can_read_report(main.id);
  published:=private.is_public_report(main.id);
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at,s.id),'[]'::jsonb) into updates from (
    select h.id,h.new_status,h.created_at from public.report_status_history h
    where h.report_id=main.id order by h.created_at desc,h.id desc limit 100
  ) s;
  return jsonb_build_object('main_report_id',main.id,'status',main.status,
    'organization_name',(select name from public.organizations where id=main.organization_id),
    'history',updates,'main_title',case when readable then main.title when published then main.public_summary else null end,
    'can_open_main',readable or published);
end;
$$;
revoke all on function public.report_duplicate_progress(uuid) from public,anon;
grant execute on function public.report_duplicate_progress(uuid) to authenticated;
comment on function public.report_duplicate_progress(uuid) is 'Linked-report progress projection. Requires current source access; reveals only canonical status, office and latest 100 status/time events unless the main report itself is readable.';

create function private.notify_duplicate_progress() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(user_id,title,report_id)
    select distinct on (p.id) p.id,'The main report linked to your submission has an update',r.id
    from public.report_duplicate_links l join public.reports r on r.id=l.report_id
    join public.profiles p on (p.id=r.resident_id or exists(
      select 1 from public.report_followers f where f.report_id=r.id and f.user_id=p.id))
    where l.canonical_id=new.id and r.status='duplicate' and r.is_demo=new.is_demo
      and (not r.is_demo or private.sample_data_enabled()) and p.account_status='active' and p.notifications_enabled
      and p.id<>new.resident_id and not exists(select 1 from public.report_followers f where f.report_id=new.id and f.user_id=p.id)
    order by p.id,r.created_at,r.id;
  return new;
end;
$$;
revoke all on function private.notify_duplicate_progress() from public,anon,authenticated;
create trigger notify_duplicate_progress after update of status,organization_id on public.reports
for each row when (old.status is distinct from new.status or old.organization_id is distinct from new.organization_id)
execute function private.notify_duplicate_progress();
