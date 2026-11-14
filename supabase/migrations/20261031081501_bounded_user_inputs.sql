set local lock_timeout = '5s';

-- Shared by CHECK constraints; reads no tables and does not bypass row security.
create function private.valid_input_text(value text, minimum integer, maximum integer)
returns boolean language sql immutable strict parallel safe set search_path='' as $$
  select length(value)<=maximum
    and length(btrim(value,E' \t\n\r'))>=minimum
    and translate(value,E'\t\n\r','') !~ '[[:cntrl:]]'
    and ((minimum=0 and btrim(value,E' \t\n\r')='')
      or regexp_replace(value,U&'[\00AD\061C\180E\200B-\200F\202A-\202E\2060-\206F\FEFF[:space:]]','','g')<>'')
$$;
revoke all on function private.valid_input_text(text,integer,integer) from public,anon;
grant execute on function private.valid_input_text(text,integer,integer) to authenticated;

alter table public.profiles add constraint profiles_name_input_limits check(private.valid_input_text(display_name,0,100));
alter table public.organizations add constraint organizations_name_input_limits check(private.valid_input_text(name,2,160));
alter table public.reports
  add constraint reports_title_input_limits check(private.valid_input_text(title,8,160)),
  add constraint reports_description_input_limits check(private.valid_input_text(description,20,4000)),
  add constraint reports_landmark_input_limits check(private.valid_input_text(landmark,0,240)),
  add constraint reports_summary_input_limits check(private.valid_input_text(public_summary,0,160));
alter table public.report_status_history add constraint history_note_input_limits check(private.valid_input_text(public_note,1,4000));
alter table public.report_assignments add constraint assignment_reason_input_limits check(private.valid_input_text(reason,5,4000));
alter table public.report_duplicate_links add constraint duplicate_reason_input_limits check(private.valid_input_text(reason,5,4000));
alter table public.routing_rules add constraint routing_notes_input_limits check(private.valid_input_text(notes,0,2000));
alter table public.organization_access_rules add constraint office_notes_input_limits check(private.valid_input_text(notes,0,2000));
alter table public.report_internal_notes add constraint private_note_input_limits check(private.valid_input_text(body,5,4000));
alter table public.issue_assessments add constraint assessment_input_limits check(private.valid_input_text(assessment,5,4000));
alter table public.consultations
  add constraint consultation_title_input_limits check(private.valid_input_text(title,8,160)),
  add constraint consultation_body_input_limits check(private.valid_input_text(body,20,10000)),
  add constraint consultation_outcome_input_limits check(private.valid_input_text(outcome,0,2000)),
  add constraint consultation_date_input_limits check(opens_at between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999999+00' and closes_at between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999999+00');
alter table public.consultation_comments
  add constraint comment_body_input_limits check(private.valid_input_text(body,2,2000)),
  add constraint moderation_reason_input_limits check(private.valid_input_text(moderation_reason,5,1000));
alter table public.comment_flags add constraint flag_reason_input_limits check(private.valid_input_text(reason,5,1000));
alter table public.meeting_requests
  add constraint request_title_input_limits check(private.valid_input_text(title,8,160)),
  add constraint request_body_input_limits check(private.valid_input_text(body,20,4000)),
  add constraint decision_reason_input_limits check(private.valid_input_text(decision_reason,0,1000));
alter table public.meetings
  add constraint meeting_venue_input_limits check(private.valid_input_text(venue,3,240)),
  add constraint meeting_outcome_input_limits check(private.valid_input_text(outcome,0,2000)),
  add constraint meeting_date_input_limits check(starts_at between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999999+00');
alter table public.meeting_action_items
  add constraint action_description_input_limits check(private.valid_input_text(description,5,4000)),
  add constraint action_date_input_limits check(due_at between date '0001-01-01' and date '9999-12-31');
alter table public.announcements
  add constraint announcement_title_input_limits check(private.valid_input_text(title,8,160)),
  add constraint announcement_body_input_limits check(private.valid_input_text(body,20,10000)),
  add constraint announcement_kind_input_limits check(private.valid_input_text(kind,1,80)),
  add constraint announcement_date_input_limits check(publish_at between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999999+00');
alter table public.analytics_settings add constraint analytics_weight_input_limits
  check(count_weight between 0 and 1000 and severity_weight between 0 and 1000 and age_weight between 0 and 1000);
