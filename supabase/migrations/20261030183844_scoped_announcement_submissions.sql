-- Let every active stakeholder submit a scoped announcement for review.
-- Publishing remains restricted to administrators and explicitly authorized publishers.

-- Keep authorship truthful when a publisher reviews another stakeholder's submission.
create function private.guard_announcement_author()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (
    (tg_op = 'INSERT' and new.created_by is distinct from auth.uid())
    or (tg_op = 'UPDATE' and new.created_by is distinct from old.created_by)
  ) then
    raise check_violation using message = 'Announcement authorship cannot be changed or impersonated';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_announcement_author() from public, anon, authenticated;
create trigger announcement_author before insert or update on public.announcements
for each row execute function private.guard_announcement_author();

alter table public.announcements
  drop constraint if exists announcements_status_check;

alter table public.announcements
  add constraint announcements_status_check
  check (status in ('draft', 'pending_review', 'published', 'archived'));

create or replace function private.community_access(b uuid, o uuid, action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'active'
      and (
        p.role = 'admin'
        or (
          p.role = 'barangay'
          and b = p.barangay_id
          and (action not in ('announcements', 'announcement_submit') or o is null)
        )
        or (
          p.role = 'office'
          and exists (
            select 1
            from public.organization_memberships m
            join public.organizations org on org.id = m.organization_id and org.active
            join public.organization_access_rules a on a.organization_id = org.id and a.enabled
            where m.user_id = p.id
              and org.id = o
              and case action
                when 'consultations' then org.can_consult
                when 'meetings' then org.can_coordinate
                when 'announcements' then org.can_publish
                when 'announcement_submit' then true
                when 'read' then true
                else false
              end
              and (a.barangay_id is null or a.barangay_id = b)
          )
        )
      )
  )
$$;

drop policy if exists announcements_submit on public.announcements;
create policy announcements_submit on public.announcements
  for insert to authenticated
  with check (
    status = 'pending_review'
    and created_by = auth.uid()
    and private.community_access(barangay_id, organization_id, 'announcement_submit')
  );

drop policy if exists announcements_submit_update on public.announcements;
create policy announcements_submit_update on public.announcements
  for update to authenticated
  using (
    status = 'pending_review'
    and created_by = auth.uid()
    and private.community_access(barangay_id, organization_id, 'announcement_submit')
  )
  with check (
    status = 'pending_review'
    and created_by = auth.uid()
    and private.community_access(barangay_id, organization_id, 'announcement_submit')
  );
