-- Posting limits and analytical age must use server timestamps, not client claims.
create function public.normalize_submission() returns trigger language plpgsql set search_path='' as $$begin
if auth.uid() is not null then new.created_at=now(); end if;
if tg_table_name in ('reports','meeting_requests','consultations','announcements') then
new.title=trim(new.title);
if length(new.title) not between 8 and 160 then raise exception 'Title must have 8 to 160 characters'; end if;
end if;
if tg_table_name='reports' then
new.description=trim(new.description);
if not exists(select 1 from public.report_categories where id=new.category_id and active) then raise exception 'Choose an active issue category';end if;
end if;
return new;end$$;
create trigger normalize_submission before insert on public.reports for each row execute function public.normalize_submission();
create trigger normalize_submission before insert on public.meeting_requests for each row execute function public.normalize_submission();
create trigger normalize_submission before insert on public.consultation_comments for each row execute function public.normalize_submission();
create trigger normalize_submission before insert on public.consultations for each row execute function public.normalize_submission();
create trigger normalize_submission before insert on public.announcements for each row execute function public.normalize_submission();
revoke execute on function public.normalize_submission from public,anon;
