create or replace function private.staff_meeting_request_participants(p_request uuid)
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
  if not exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.role in ('admin', 'barangay')
  ) then
    raise exception 'An active barangay or administrator account is required.' using errcode = '42501';
  end if;

  return query
    with ranked as (
      select participant.request_id, participant.resident_id, resident.display_name as resident_name,
        participant.joined_at,
        count(*) over (partition by participant.request_id) as participant_count,
        row_number() over (partition by participant.request_id order by participant.joined_at, participant.resident_id) as participant_order
      from public.meeting_resident_participants participant
      join public.profiles resident on resident.id = participant.resident_id
      join public.meeting_requests request on request.id = participant.request_id
      where participant.request_id = p_request
        and exists (
          select 1 from public.profiles viewer
          where viewer.id = (select auth.uid())
            and viewer.account_status = 'active'
            and (
              viewer.role = 'admin'
              or (viewer.role = 'barangay' and (
                viewer.barangay_id = request.barangay_id
                or exists (
                  select 1 from public.meeting_request_barangays invitation
                  where invitation.request_id = request.id
                    and invitation.barangay_id = viewer.barangay_id
                    and invitation.status = 'accepted'
                )
              ))
            )
        )
    )
    select ranked.request_id, ranked.resident_id, ranked.resident_name, ranked.joined_at, ranked.participant_count
    from ranked
    where ranked.participant_order <= 100
    order by ranked.participant_order;
end
$function$;

create or replace function public.staff_meeting_request_participants(p_request uuid)
returns table (
  request_id uuid,
  resident_id uuid,
  resident_name text,
  joined_at timestamptz,
  participant_count bigint
)
language sql stable security invoker set search_path = ''
as $function$
  select * from private.staff_meeting_request_participants(p_request)
$function$;

revoke all on function private.staff_meeting_request_participants(uuid) from public, anon;
revoke all on function public.staff_meeting_request_participants(uuid) from public, anon;
grant execute on function private.staff_meeting_request_participants(uuid) to authenticated;
grant execute on function public.staff_meeting_request_participants(uuid) to authenticated;

notify pgrst, 'reload schema';
