create function public.protect_profile_scope() returns trigger language plpgsql set search_path='' as $$begin
if current_user='authenticated' and old.role<>'resident' and new.barangay_id is distinct from old.barangay_id then raise exception 'Staff jurisdiction must be assigned by an administrator'; end if; return new; end$$;
create trigger protect_scope before update on public.profiles for each row execute function public.protect_profile_scope();
create function public.set_staff_scope(p_user uuid,p_barangay uuid) returns void language plpgsql security definer set search_path='' as $$begin if not public.is_admin() then raise exception 'Not authorized'; end if; update public.profiles set barangay_id=p_barangay where id=p_user; end$$;
create function public.validate_community_write() returns trigger language plpgsql set search_path='' as $$begin
if tg_table_name='meeting_requests' then
if length(trim(new.title))<8 or length(trim(new.body))<20 then raise exception 'Provide a descriptive title and purpose'; end if;
if tg_op='UPDATE' and new.status<>old.status then
if old.status<>'pending' or length(trim(coalesce(new.decision_reason,'')))<5 then raise exception 'Only pending requests can be decided; provide a reason'; end if;
end if;
elsif tg_table_name='consultation_comments' and new.parent_id is not null then
if not exists(select 1 from public.consultation_comments where id=new.parent_id and consultation_id=new.consultation_id) then raise exception 'Reply must belong to the same consultation'; end if;
end if;return new;end$$;
create trigger request_validation before insert or update on public.meeting_requests for each row execute function public.validate_community_write();
create trigger reply_validation before insert on public.consultation_comments for each row execute function public.validate_community_write();
revoke execute on function public.set_staff_scope,public.protect_profile_scope,public.validate_community_write from public,anon;
grant execute on function public.set_staff_scope to authenticated;
