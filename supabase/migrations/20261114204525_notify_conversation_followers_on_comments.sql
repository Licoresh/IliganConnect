create or replace function private.notify_consultation_followers_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.official then
    return new;
  end if;

  insert into public.notifications(user_id, title, consultation_id)
  select p.id, 'A conversation you follow has a new comment', new.consultation_id
    from public.consultation_followers f
    join public.profiles p on p.id = f.user_id
   where f.consultation_id = new.consultation_id
     and p.notifications_enabled
     and p.account_status = 'active'
     and p.id <> new.author_id;

  return new;
end;
$$;

revoke all on function private.notify_consultation_followers_on_comment() from public, anon, authenticated;

drop trigger if exists consultation_follower_comment_notification on public.consultation_comments;
create trigger consultation_follower_comment_notification
after insert on public.consultation_comments
for each row
execute function private.notify_consultation_followers_on_comment();
