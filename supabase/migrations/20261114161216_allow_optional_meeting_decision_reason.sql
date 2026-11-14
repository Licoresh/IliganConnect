create or replace function public.validate_community_write()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name = 'meeting_requests' then
    if length(trim(new.title)) < 8 or length(trim(new.body)) < 20 then
      raise exception 'Provide a descriptive title and purpose';
    end if;
    if tg_op = 'UPDATE' then
      if new.status is distinct from old.status and old.status <> 'pending' then
        raise exception 'Only pending requests can be decided';
      end if;
    end if;
  elsif tg_table_name = 'consultation_comments' then
    if new.parent_id is not null and not exists (
      select 1 from public.consultation_comments where id = new.parent_id and consultation_id = new.consultation_id
    ) then
      raise exception 'Reply must belong to the same consultation';
    end if;
  end if;
  return new;
end;
$$;
