create or replace function private.meeting_request_participants(p_requests uuid[])
returns table (
  request_id uuid,
  resident_id uuid,
  resident_name text,
  joined_at timestamptz,
  participant_count bigint
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not private.active_resident() then
    raise exception 'An active resident account is required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_requests), 0) > 20 then
    raise exception 'Request no more than 20 meeting participant lists at once.' using errcode = '23514';
  end if;
  return query
    with ranked as (
      select participant.request_id, participant.resident_id, profile.display_name as resident_name,
        participant.joined_at,
        count(*) over (partition by participant.request_id) as participant_count,
        row_number() over (partition by participant.request_id order by participant.joined_at, participant.resident_id) as participant_order
      from public.meeting_resident_participants participant
      join public.profiles profile on profile.id = participant.resident_id
      where participant.request_id = any(coalesce(p_requests, '{}'::uuid[]))
        and private.meeting_request_resident_can_view(participant.request_id)
    )
    select ranked.request_id, ranked.resident_id, ranked.resident_name, ranked.joined_at, ranked.participant_count
    from ranked where ranked.participant_order <= 100
    order by ranked.request_id, ranked.participant_order;
end
$function$;

create or replace function public.meeting_request_participants(p_requests uuid[])
returns table (
  request_id uuid,
  resident_id uuid,
  resident_name text,
  joined_at timestamptz,
  participant_count bigint
)
language sql stable security invoker set search_path = ''
as $function$
  select * from private.meeting_request_participants(p_requests)
$function$;

revoke all on function private.meeting_request_participants(uuid[]) from public, anon;
revoke all on function public.meeting_request_participants(uuid[]) from public, anon;
grant execute on function private.meeting_request_participants(uuid[]) to authenticated;
grant execute on function public.meeting_request_participants(uuid[]) to authenticated;
