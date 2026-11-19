-- Authorized staff announcements publish directly; future publish_at values remain scheduled.
drop policy if exists announcements_submit on public.announcements;
create policy announcements_submit on public.announcements
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and private.community_access(barangay_id, organization_id, 'announcement_submit')
    and (
      status = 'published'
      or (status = 'draft' and attachment_path is not null)
    )
  );

drop policy if exists announcements_submit_update on public.announcements;
create policy announcements_submit_update on public.announcements
  for update to authenticated
  using (
    status in ('draft', 'pending_review', 'published')
    and created_by = auth.uid()
    and private.community_access(barangay_id, organization_id, 'announcement_submit')
  )
  with check (
    status = 'published'
    and created_by = auth.uid()
    and private.community_access(barangay_id, organization_id, 'announcement_submit')
  );

drop policy if exists announcements_submit_delete_draft on public.announcements;
create policy announcements_submit_delete_draft on public.announcements
  for delete to authenticated
  using (
    status = 'draft'
    and created_by = auth.uid()
    and private.community_access(barangay_id, organization_id, 'announcement_submit')
  );

drop policy if exists announcement_image_write on storage.objects;
create policy announcement_image_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'announcement-media'
    and exists (
      select 1 from public.announcements a
      where a.id::text = (storage.foldername(name))[1]
        and (
          private.community_access(a.barangay_id, a.organization_id, 'announcements')
          or (a.created_by = auth.uid() and private.community_access(a.barangay_id, a.organization_id, 'announcement_submit'))
        )
    )
  );

drop policy if exists announcement_image_delete on storage.objects;
create policy announcement_image_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'announcement-media'
    and exists (
      select 1 from public.announcements a
      where a.id::text = (storage.foldername(name))[1]
        and (
          private.community_access(a.barangay_id, a.organization_id, 'announcements')
          or (a.created_by = auth.uid() and private.community_access(a.barangay_id, a.organization_id, 'announcement_submit'))
        )
    )
  );
