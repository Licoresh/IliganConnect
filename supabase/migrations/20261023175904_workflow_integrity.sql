create or replace function private.community_notifications() returns trigger language plpgsql security definer set search_path='' as $$begin
if tg_table_name='consultation_comments' then
 if new.official then insert into public.notifications(user_id,title,consultation_id) select p.id,'An official response was posted to a consultation',new.consultation_id from public.profiles p join public.consultation_followers f on f.user_id=p.id where f.consultation_id=new.consultation_id and p.notifications_enabled and p.id<>new.author_id;end if;
elsif tg_table_name='meeting_requests' then
 if new.status is distinct from old.status then insert into public.notifications(user_id,title,meeting_request_id) select p.id,'A community meeting request has an update',new.id from public.profiles p where p.notifications_enabled and (p.id=new.resident_id or exists(select 1 from public.meeting_supporters s where s.request_id=new.id and s.user_id=p.id));end if;
elsif tg_table_name='meetings' then
 insert into public.notifications(user_id,title,meeting_request_id) select p.id,'Community meeting details have been updated',new.request_id from public.profiles p join public.meeting_requests r on r.id=new.request_id where p.notifications_enabled and (p.id=r.resident_id or p.barangay_id=r.barangay_id);
elsif tg_table_name='announcements' then
 if new.status='published' and new.publish_at<=now() then
 if tg_op='INSERT' then insert into public.notifications(user_id,title,announcement_id) select p.id,'A new official announcement is available',new.id from public.profiles p where p.notifications_enabled and (new.barangay_id is null or p.barangay_id=new.barangay_id);
 elsif old.status is distinct from new.status then insert into public.notifications(user_id,title,announcement_id) select p.id,'A new official announcement is available',new.id from public.profiles p where p.notifications_enabled and (new.barangay_id is null or p.barangay_id=new.barangay_id);end if;
 end if;
end if;return new;end$$;
create function private.is_public_report(r uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.reports where id=r and public_visible and public_summary is not null and status not in ('duplicate','rejected'))$$;
revoke execute on function private.is_public_report from public,anon;
grant execute on function private.is_public_report to authenticated;
drop policy follow_insert on public.report_followers;
create policy follow_insert on public.report_followers for insert to authenticated with check(user_id=auth.uid() and private.is_public_report(report_id));
create function private.validate_coordination() returns trigger language plpgsql set search_path='' as $$begin
if tg_table_name in ('consultations','announcements') then
 if length(trim(new.title)) not between 8 and 160 or length(trim(new.body)) not between 20 and 10000 then raise exception 'Provide a title of 8–160 characters and content of 20–10000 characters';end if;
elsif tg_table_name='meeting_action_items' then
 if length(trim(new.description)) not between 5 and 4000 then raise exception 'Describe the follow-up action';end if;
elsif tg_table_name='meetings' then
 if length(trim(new.venue))<3 then raise exception 'Provide a venue or meeting link';end if;
elsif tg_table_name='consultation_comments' then
 if new.hidden is distinct from old.hidden and length(trim(coalesce(new.moderation_reason,'')))<5 then raise exception 'Provide a moderation reason';end if;
end if;return new;end$$;
create trigger content_validation before insert or update on public.consultations for each row execute function private.validate_coordination();
create trigger content_validation before insert or update on public.announcements for each row execute function private.validate_coordination();
create trigger content_validation before insert or update on public.meetings for each row execute function private.validate_coordination();
create trigger content_validation before insert or update on public.meeting_action_items for each row execute function private.validate_coordination();
create trigger content_validation before update on public.consultation_comments for each row execute function private.validate_coordination();
revoke execute on function private.validate_coordination from public,anon;
