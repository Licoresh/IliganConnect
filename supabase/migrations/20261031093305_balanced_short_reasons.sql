set local lock_timeout='5s';

alter table public.consultation_comments
  drop constraint moderation_reason_input_limits,
  add constraint moderation_reason_input_limits check(private.valid_input_text(moderation_reason,5,500));
alter table public.comment_flags
  drop constraint flag_reason_input_limits,
  add constraint flag_reason_input_limits check(private.valid_input_text(reason,5,500));
alter table public.meeting_requests
  drop constraint decision_reason_input_limits,
  add constraint decision_reason_input_limits check(private.valid_input_text(decision_reason,0,500));
