alter table public.meetings
  add column if not exists meet_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meetings_meet_url_format'
      and conrelid = 'public.meetings'::regclass
  ) then
    alter table public.meetings
      add constraint meetings_meet_url_format
      check (
        meet_url is null or
        meet_url ~* '^https://meet[.]google[.]com/([[:alnum:]_-]+/)*[[:alnum:]-]+/?([?][[:alnum:]_.~!$&()*+,;=:@%/?-]+)?$'
      );
  end if;
end;
$$;

comment on column public.meetings.meet_url is
  'Optional validated Google Meet join link for this scheduled meeting.';

drop policy if exists meetings_read on public.meetings;
create policy meetings_read on public.meetings for select to authenticated
  using (
    private.meeting_access(request_id)
    or private.meeting_invited_office_access(request_id)
    or exists (
      select 1 from public.meeting_requests r
      where r.id = request_id
        and r.resident_id = (select auth.uid())
        and private.active_resident()
    )
    or exists (
      select 1
      from public.meeting_participants mp
      join public.organization_memberships m on m.organization_id = mp.organization_id
      join public.organizations o on o.id = m.organization_id and o.active
      join public.profiles p on p.id = m.user_id and p.role = 'office' and p.account_status = 'active'
      where mp.meeting_id = meetings.id and p.id = (select auth.uid())
    )
  );
