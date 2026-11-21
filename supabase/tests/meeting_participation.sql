-- Synthetic meeting fixtures and every assertion roll back at the end.
begin;
set local statement_timeout = '30s';
do $tests$
declare
  organizer uuid := gen_random_uuid();
  local_resident uuid := gen_random_uuid();
  invited_resident uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  meeting_barangay_staff uuid := gen_random_uuid();
  invited_barangay_staff uuid := gen_random_uuid();
  outsider_barangay_staff uuid := gen_random_uuid();
  v_request_id uuid;
  v_closed_request_id uuid;
  meeting_barangay uuid;
  organizer_barangay uuid;
  invited_barangay uuid;
  outsider_barangay uuid;
  category uuid;
  rejected boolean;
  participant_count integer;
begin
  select id into meeting_barangay from public.barangays where name = 'Poblacion';
  select id into organizer_barangay from public.barangays where id <> meeting_barangay order by name limit 1;
  select id into invited_barangay from public.barangays where id not in (meeting_barangay, organizer_barangay) order by name limit 1;
  select id into outsider_barangay from public.barangays where id not in (meeting_barangay, organizer_barangay, invited_barangay) order by name limit 1;
  select id into category from public.report_categories where active order by name limit 1;
  assert meeting_barangay is not null and organizer_barangay is not null and invited_barangay is not null
    and outsider_barangay is not null and category is not null, 'Meeting test reference data unavailable';

  insert into auth.users(id, email)
  select id, id::text || '@example.invalid'
  from unnest(array[organizer, local_resident, invited_resident, outsider,
    meeting_barangay_staff, invited_barangay_staff, outsider_barangay_staff]) as users(id);
  update public.profiles set barangay_id = organizer_barangay, notifications_enabled = true where id = organizer;
  update public.profiles set barangay_id = meeting_barangay, notifications_enabled = true where id = local_resident;
  update public.profiles set barangay_id = invited_barangay, notifications_enabled = true where id = invited_resident;
  update public.profiles set barangay_id = outsider_barangay, notifications_enabled = true where id = outsider;
  update public.profiles set role = 'barangay', barangay_id = meeting_barangay where id = meeting_barangay_staff;
  update public.profiles set role = 'barangay', barangay_id = invited_barangay where id = invited_barangay_staff;
  update public.profiles set role = 'barangay', barangay_id = outsider_barangay where id = outsider_barangay_staff;
  update public.profiles set notifications_enabled = true
    where id in (meeting_barangay_staff, invited_barangay_staff, outsider_barangay_staff);

  perform set_config('request.jwt.claim.sub', organizer::text, true);
  set local role authenticated;
  v_request_id := public.submit_meeting_request(
    'Cross-barangay open meeting',
    'Rollback-only fixture verifying barangay meeting participation rules.',
    meeting_barangay, category, null, '{}'::uuid[], 'open'
  );
  assert exists (select 1 from public.meeting_requests where id = v_request_id and participation_mode = 'open'),
    'Open meeting choice was not saved';
  assert exists (select 1 from public.meeting_requests where id = v_request_id and resident_id = organizer),
    'Organizer cannot see their request sent to another barangay';
  rejected := false;
  begin
    perform public.join_meeting_request(v_request_id);
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'Residents joined an open request before it was approved';
  reset role;

  perform set_config('request.jwt.claim.sub', outsider_barangay_staff::text, true);
  set local role authenticated;
  rejected := false;
  begin
    perform public.invite_meeting_barangay(v_request_id, invited_barangay);
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'A different barangay invited a partner barangay without permission';
  reset role;

  perform set_config('request.jwt.claim.sub', meeting_barangay_staff::text, true);
  set local role authenticated;
  perform public.invite_meeting_barangay(v_request_id, invited_barangay);
  rejected := false;
  begin
    perform public.invite_meeting_barangay(v_request_id, invited_barangay);
  exception when unique_violation then rejected := true;
  end;
  assert rejected, 'Duplicate active barangay invitations were accepted';
  update public.meeting_requests set status = 'approved', decision_reason = 'Rollback-only approval'
    where id = v_request_id;
  reset role;

  perform set_config('request.jwt.claim.sub', invited_resident::text, true);
  set local role authenticated;
  assert not exists (select 1 from public.meeting_requests where id = v_request_id),
    'Invited barangay residents can see a meeting before their barangay accepts';
  rejected := false;
  begin
    perform public.join_meeting_request(v_request_id);
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'Invited residents joined before barangay acceptance';
  reset role;

  perform set_config('request.jwt.claim.sub', invited_barangay_staff::text, true);
  set local role authenticated;
  perform public.respond_meeting_barangay_invitation(v_request_id, invited_barangay, false);
  reset role;

  perform set_config('request.jwt.claim.sub', invited_resident::text, true);
  set local role authenticated;
  assert not exists (select 1 from public.meeting_requests where id = v_request_id),
    'Invited barangay residents can see a declined meeting';
  reset role;

  perform set_config('request.jwt.claim.sub', meeting_barangay_staff::text, true);
  set local role authenticated;
  perform public.invite_meeting_barangay(v_request_id, invited_barangay);
  reset role;

  perform set_config('request.jwt.claim.sub', outsider_barangay_staff::text, true);
  set local role authenticated;
  rejected := false;
  begin
    perform public.respond_meeting_barangay_invitation(v_request_id, invited_barangay, true);
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'A non-invited barangay accepted another barangay invitation';
  reset role;

  perform set_config('request.jwt.claim.sub', invited_barangay_staff::text, true);
  set local role authenticated;
  perform public.respond_meeting_barangay_invitation(v_request_id, invited_barangay, true);
  reset role;

  perform set_config('request.jwt.claim.sub', invited_resident::text, true);
  set local role authenticated;
  assert exists (select 1 from public.meeting_requests where id = v_request_id),
    'Accepted invited barangay residents cannot see the open meeting';
  rejected := false;
  begin
    insert into public.meeting_resident_participants(request_id, resident_id) values (v_request_id, outsider);
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'A resident inserted another resident into the participant list directly';
  perform public.join_meeting_request(v_request_id);
  perform public.join_meeting_request(v_request_id);
  assert exists (select 1 from public.meeting_resident_participants participant
    where participant.request_id = v_request_id and participant.resident_id = invited_resident), 'Invited resident was not listed as a participant';
  reset role;

  perform set_config('request.jwt.claim.sub', local_resident::text, true);
  set local role authenticated;
  assert exists (select 1 from public.meeting_requests where id = v_request_id),
    'Residents of the meeting barangay cannot see its meeting';
  perform public.join_meeting_request(v_request_id);
  reset role;

  perform set_config('request.jwt.claim.sub', organizer::text, true);
  set local role authenticated;
  perform public.join_meeting_request(v_request_id);
  reset role;

  perform set_config('request.jwt.claim.sub', invited_resident::text, true);
  set local role authenticated;
  select count(*) into participant_count from public.meeting_resident_participants participant where participant.request_id = v_request_id;
  assert participant_count = 3, 'Repeated joins duplicated a resident or a valid participant was omitted';
  assert exists (
    select 1 from public.meeting_request_participants(array[v_request_id]) p
    where p.request_id = v_request_id and p.resident_id = invited_resident and p.resident_name is not null
  ), 'Participant roster did not return the invited resident';
  reset role;
  perform set_config('request.jwt.claim.sub', meeting_barangay_staff::text, true);
  set local role authenticated;
  update public.meeting_requests set decision_reason = 'Rollback-only participant update'
    where id = v_request_id;
  reset role;
  perform set_config('request.jwt.claim.sub', invited_resident::text, true);
  set local role authenticated;
  perform public.leave_meeting_request(v_request_id);
  assert not exists (select 1 from public.meeting_resident_participants participant
    where participant.request_id = v_request_id and participant.resident_id = invited_resident), 'Resident could not leave their meeting';
  assert exists (select 1 from public.notifications
    where user_id = invited_resident and meeting_request_id = v_request_id and title = 'You joined an open community meeting'),
    'Joining resident did not receive a meeting notification';
  reset role;

  perform set_config('request.jwt.claim.sub', outsider::text, true);
  set local role authenticated;
  assert not exists (select 1 from public.meeting_requests where id = v_request_id),
    'A non-invited resident can see the cross-barangay meeting';
  assert not exists (select 1 from public.meeting_request_participants(array[v_request_id])),
    'A non-invited resident can read the meeting participant roster';
  rejected := false;
  begin
    perform public.join_meeting_request(v_request_id);
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'A non-invited resident joined a cross-barangay meeting';
  reset role;

  perform set_config('request.jwt.claim.sub', local_resident::text, true);
  set local role authenticated;
  v_closed_request_id := public.submit_meeting_request(
    'Closed local meeting',
    'Rollback-only closed fixture verifying residents cannot join.',
    meeting_barangay, category, null, '{}'::uuid[]
  );
  assert exists (select 1 from public.meeting_requests request
    where request.id = v_closed_request_id and request.participation_mode = 'closed'),
    'Existing six-argument submissions did not default to closed';
  reset role;
  perform set_config('request.jwt.claim.sub', meeting_barangay_staff::text, true);
  set local role authenticated;
  update public.meeting_requests set status = 'approved', decision_reason = 'Rollback-only approval'
    where id = v_closed_request_id;
  rejected := false;
  begin
    perform public.join_meeting_request(v_closed_request_id);
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'Resident joined a closed meeting';
  perform public.invite_meeting_barangay(v_closed_request_id, invited_barangay);
  assert exists (select 1 from public.meeting_request_barangays
    where request_id = v_closed_request_id and barangay_id = invited_barangay and status = 'pending'),
    'Closed meeting invitation was not created';
  reset role;

  perform set_config('request.jwt.claim.sub', invited_barangay_staff::text, true);
  set local role authenticated;
  assert exists (select 1 from public.meeting_requests where id = v_closed_request_id),
    'Invited barangay staff cannot view the closed meeting';
  perform public.respond_meeting_barangay_invitation(v_closed_request_id, invited_barangay, true);
  assert exists (select 1 from public.meeting_request_barangays
    where request_id = v_closed_request_id and barangay_id = invited_barangay and status = 'accepted'),
    'Invited barangay staff could not accept a closed meeting';
  reset role;

  perform set_config('request.jwt.claim.sub', invited_resident::text, true);
  set local role authenticated;
  assert not exists (select 1 from public.meeting_requests where id = v_closed_request_id),
    'Invited barangay residents can see a closed meeting';
  rejected := false;
  begin
    perform public.join_meeting_request(v_closed_request_id);
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'An invited resident joined a closed meeting';
  reset role;

  assert exists (select 1 from public.notifications
    where user_id = organizer and meeting_request_id = v_request_id
      and title = 'A barangay accepted the invitation to your open meeting'),
    'Organizer did not receive the accepted barangay invitation notification';
  assert exists (select 1 from public.notifications
    where user_id = meeting_barangay_staff and meeting_request_id = v_request_id
      and title = 'A resident joined an open community meeting'),
    'Meeting barangay did not receive the participant notification';
  assert exists (select 1 from public.notifications
    where user_id = invited_barangay_staff and meeting_request_id = v_closed_request_id
      and title = 'Your barangay was invited to a community meeting'),
    'Invited barangay staff did not receive a closed meeting invitation notification';
  assert exists (select 1 from public.notifications
    where user_id = local_resident and meeting_request_id = v_closed_request_id
      and title = 'A barangay accepted the invitation to your meeting'),
    'Organizer did not receive the closed meeting acceptance notification';
  assert exists (select 1 from public.notifications
    where user_id = invited_resident and meeting_request_id = v_request_id
      and title = 'An open community meeting has a new update'),
    'A participant did not receive a meeting update notification';
end
$tests$;
rollback;
