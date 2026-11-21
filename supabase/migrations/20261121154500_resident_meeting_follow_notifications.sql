create table public.meeting_followers (
  request_id uuid not null references public.meeting_requests(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

create index meeting_followers_user_request_idx
  on public.meeting_followers (user_id, request_id);

alter table public.meeting_followers enable row level security;
revoke all on public.meeting_followers from public, anon, authenticated;
grant select, insert, delete on public.meeting_followers to authenticated;

create policy meeting_followers_read_own
  on public.meeting_followers for select to authenticated
  using (user_id = (select auth.uid()));

create policy meeting_followers_insert_resident
  on public.meeting_followers for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'resident'
        and p.account_status = 'active'
    )
    and private.meeting_request_resident_can_view(request_id)
  );

create policy meeting_followers_delete_own
  on public.meeting_followers for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.notify_meeting_followers()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_request uuid;
  v_meeting uuid;
  v_owner uuid;
  v_actor uuid := auth.uid();
  v_title text;
  v_sample boolean;
  v_skip_owner boolean := false;
  v_skip_participants boolean := false;
begin
  if tg_table_name = 'meeting_requests' then
    if row(new.title, new.body, new.status, new.decision_reason, new.barangay_id, new.category_id, new.participation_mode)
      is not distinct from row(old.title, old.body, old.status, old.decision_reason, old.barangay_id, old.category_id, old.participation_mode) then
      return new;
    end if;
    v_request := new.id;
    v_title := case
      when new.status is distinct from old.status then 'A meeting you follow has a decision update'
      when new.participation_mode is distinct from old.participation_mode then 'Participation details changed for a meeting you follow'
      else 'A meeting you follow has new details'
    end;
    v_skip_owner := new.status is distinct from old.status;
    v_skip_participants := new.status is distinct from old.status
      or new.decision_reason is distinct from old.decision_reason
      or new.participation_mode is distinct from old.participation_mode;
  elsif tg_table_name = 'meetings' then
    if tg_op = 'UPDATE'
      and row(new.starts_at, new.ends_at, new.venue, new.venue_type, new.meet_url, new.outcome, new.completed)
        is not distinct from row(old.starts_at, old.ends_at, old.venue, old.venue_type, old.meet_url, old.outcome, old.completed) then
      return new;
    end if;
    v_request := new.request_id;
    v_title := case when tg_op = 'INSERT'
      then 'A meeting you follow has been scheduled'
      when new.completed and not old.completed
      then 'A meeting you follow was marked complete'
      else 'A meeting you follow has schedule or outcome changes' end;
    v_skip_owner := true;
    v_skip_participants := tg_op = 'INSERT'
      or row(new.starts_at, new.ends_at, new.venue, new.venue_type, new.meet_url, new.completed)
        is distinct from row(old.starts_at, old.ends_at, old.venue, old.venue_type, old.meet_url, old.completed);
  elsif tg_table_name = 'meeting_request_barangays' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
    v_request := new.request_id;
    v_title := case
      when tg_op = 'INSERT' then 'A barangay was invited to a meeting you follow'
      when new.status = 'accepted' then 'A barangay accepted an invitation to a meeting you follow'
      else 'A barangay declined an invitation to a meeting you follow'
    end;
    v_skip_owner := tg_op = 'UPDATE';
    v_skip_participants := tg_op = 'UPDATE';
  elsif tg_table_name = 'meeting_resident_participants' then
    v_request := new.request_id;
    v_title := 'A resident joined a meeting you follow';
    v_skip_owner := true;
    v_skip_participants := true;
  elsif tg_table_name = 'meeting_action_items' then
    v_meeting := case when tg_op = 'DELETE' then old.meeting_id else new.meeting_id end;
    if tg_op = 'UPDATE'
      and row(new.description, new.due_at, new.completed, new.organization_id)
        is not distinct from row(old.description, old.due_at, old.completed, old.organization_id) then
      return new;
    end if;
    select m.request_id into v_request from public.meetings m where m.id = v_meeting;
    v_title := case
      when tg_op = 'INSERT' then 'A follow-up action was added to a meeting you follow'
      when tg_op = 'DELETE' then 'A follow-up action was removed from a meeting you follow'
      else 'A follow-up action changed for a meeting you follow'
    end;
  else
    return new;
  end if;

  select r.resident_id, r.is_sample
    into v_owner, v_sample
    from public.meeting_requests r
   where r.id = v_request;
  if not found or coalesce(v_sample, true) then return new; end if;

  insert into public.notifications(user_id, title, meeting_request_id)
  select p.id, v_title, v_request
    from public.meeting_followers f
    join public.profiles p on p.id = f.user_id
   where f.request_id = v_request
     and p.role = 'resident'
     and p.account_status = 'active'
     and p.notifications_enabled
     and p.id is distinct from v_actor
     and (not v_skip_owner or p.id is distinct from v_owner)
     and (not v_skip_participants or not exists (
       select 1 from public.meeting_resident_participants participant
        where participant.request_id = v_request and participant.resident_id = p.id
     ));
  return new;
end
$function$;

revoke all on function private.notify_meeting_followers() from public, anon, authenticated;

create trigger meeting_request_follower_updates
after update of title, body, status, decision_reason, barangay_id, category_id, participation_mode
on public.meeting_requests
for each row execute function private.notify_meeting_followers();

create trigger meeting_schedule_follower_updates
after insert or update of starts_at, ends_at, venue, venue_type, meet_url, outcome, completed
on public.meetings
for each row execute function private.notify_meeting_followers();

create trigger meeting_invitation_follower_updates
after insert or update of status
on public.meeting_request_barangays
for each row execute function private.notify_meeting_followers();

create trigger meeting_participant_follower_updates
after insert on public.meeting_resident_participants
for each row execute function private.notify_meeting_followers();

create trigger meeting_action_follower_updates
after insert or update or delete on public.meeting_action_items
for each row execute function private.notify_meeting_followers();

comment on table public.meeting_followers is
  'Residents following a meeting request to receive permitted update notifications.';

notify pgrst, 'reload schema';
