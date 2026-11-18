alter table private.walk_in_reporter_details
  add column reporter_email text,
  add column reporter_phone text,
  add constraint walk_in_reporter_email_format check (
    reporter_email is null or (
      private.valid_input_text(reporter_email,5,254)
      and reporter_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  add constraint walk_in_reporter_phone_format check (
    reporter_phone is null or reporter_phone ~ '^\+639[0-9]{9}$'
  );

comment on column private.walk_in_reporter_details.reporter_email is 'Optional walk-in reporter email, visible only through scoped staff report access.';
comment on column private.walk_in_reporter_details.reporter_phone is 'Optional normalized Philippine mobile number for a walk-in reporter.';

create function private.submit_walk_in_report_with_contacts(
  p_id uuid,p_category uuid,p_barangay uuid,p_reporter_name text,p_reporter_email text,p_reporter_phone text,
  p_title text,p_description text,p_latitude double precision,p_longitude double precision,
  p_landmark text,p_problem_type text,p_problem_other text,p_purok text,p_zone text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_reporter_email text := nullif(lower(btrim(p_reporter_email)), '');
  v_reporter_phone text := nullif(regexp_replace(btrim(coalesce(p_reporter_phone,'')), '[[:space:]().-]', '', 'g'), '');
  v_report_id uuid;
begin
  if v_reporter_email is not null and not (
    coalesce(private.valid_input_text(v_reporter_email,5,254),false)
    and v_reporter_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'Enter a valid reporter email address.' using errcode='23514';
  end if;
  if v_reporter_phone is not null then
    if v_reporter_phone !~ '^(\+639[0-9]{9}|09[0-9]{9})$' then
      raise exception 'Enter a valid Philippine mobile number.' using errcode='23514';
    end if;
    if v_reporter_phone like '09%' then v_reporter_phone := '+63'||substr(v_reporter_phone,2); end if;
  end if;

  v_report_id := private.submit_walk_in_report(
    p_id,p_category,p_barangay,p_reporter_name,null,p_title,p_description,p_latitude,p_longitude,
    p_landmark,p_problem_type,p_problem_other,p_purok,p_zone
  );
  update private.walk_in_reporter_details
    set reporter_email=v_reporter_email, reporter_phone=v_reporter_phone
    where report_id=v_report_id and created_by=auth.uid();
  if not found then raise exception 'Walk-in reporter details could not be saved.' using errcode='23503'; end if;
  return v_report_id;
end $$;
revoke all on function private.submit_walk_in_report_with_contacts(uuid,uuid,uuid,text,text,text,text,text,double precision,double precision,text,text,text,text,text) from public,anon;
grant execute on function private.submit_walk_in_report_with_contacts(uuid,uuid,uuid,text,text,text,text,text,double precision,double precision,text,text,text,text,text) to authenticated;

create function public.submit_walk_in_report_with_contacts(
  p_id uuid,p_category uuid,p_barangay uuid,p_reporter_name text,p_reporter_email text,p_reporter_phone text,
  p_title text,p_description text,p_latitude double precision,p_longitude double precision,
  p_landmark text,p_problem_type text,p_problem_other text,p_purok text,p_zone text
) returns uuid language sql security invoker set search_path='' as $$
  select private.submit_walk_in_report_with_contacts(
    p_id,p_category,p_barangay,p_reporter_name,p_reporter_email,p_reporter_phone,
    p_title,p_description,p_latitude,p_longitude,p_landmark,p_problem_type,p_problem_other,p_purok,p_zone
  )
$$;
revoke all on function public.submit_walk_in_report_with_contacts(uuid,uuid,uuid,text,text,text,text,text,double precision,double precision,text,text,text,text,text) from public,anon;
grant execute on function public.submit_walk_in_report_with_contacts(uuid,uuid,uuid,text,text,text,text,text,double precision,double precision,text,text,text,text,text) to authenticated;

create or replace function private.report_residents(p_ids uuid[],p_contact boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(cardinality(p_ids),0)>20 then raise exception 'Request up to 20 reports'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'report_id',r.id,
    'resident_name',case when private.report_identity_access(r.id)
      then coalesce(walkin.reporter_name,resident.display_name)
      when r.submission_source='walk_in' then 'Walk-in report' else 'Resident' end,
    'submission_source',r.submission_source,
    'created_by_name',case when private.report_identity_access(r.id) then coalesce(walkin_creator.display_name,creator.display_name) else null end,
    'registered_barangay_id',case when private.report_identity_access(r.id) then resident.barangay_id else null end,
    'submission_barangay_id',case when private.report_identity_access(r.id) then r.resident_barangay_id else null end,
    'assigned_to_name',case when private.report_identity_access(r.id) then handler.display_name else null end,
    'email',case when p_contact and r.submission_source='resident' and private.report_identity_access(r.id)
      then u.email else null end,
    'reporter_contact',case when p_contact and r.submission_source='walk_in' and private.report_identity_access(r.id)
      then walkin.reporter_contact else null end,
    'reporter_email',case when p_contact and r.submission_source='walk_in' and private.report_identity_access(r.id)
      then walkin.reporter_email else null end,
    'reporter_phone',case when p_contact and r.submission_source='walk_in' and private.report_identity_access(r.id)
      then walkin.reporter_phone else null end))
    from public.reports r left join public.profiles resident on resident.id=r.resident_id
    left join auth.users u on u.id=resident.id
    left join public.profiles creator on creator.id=r.created_by
    left join private.walk_in_reporter_details walkin on walkin.report_id=r.id
    left join public.profiles walkin_creator on walkin_creator.id=walkin.created_by
    left join public.profiles handler on handler.id=r.assigned_to
    where r.id=any(p_ids) and private.report_action(r.id) and private.sample_report_visible(r.id)),'[]'::jsonb);
end $$;

notify pgrst, 'reload schema';
