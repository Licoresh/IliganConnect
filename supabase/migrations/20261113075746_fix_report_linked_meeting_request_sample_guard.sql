-- Keep resident meeting requests linked to a report compatible with the reports demo flag.
create or replace function private.submit_meeting_request(
  p_title text,
  p_body text,
  p_barangay uuid,
  p_category uuid,
  p_report uuid,
  p_organizations uuid[]
)
returns uuid
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_barangay uuid := p_barangay;
  v_category uuid := p_category;
  v_report_barangay uuid;
  v_report_category uuid;
  v_organizations uuid[] := coalesce(p_organizations, '{}'::uuid[]);
  v_request uuid;
  v_valid bigint;
begin
  if not private.active_resident() then
    raise exception 'An active resident account is required to request a meeting.' using errcode = '42501';
  end if;
  if not private.valid_input_text(p_title, 8, 160) then
    raise exception 'Meeting topic must be 8–160 meaningful characters.' using errcode = '23514';
  end if;
  if not private.valid_input_text(p_body, 20, 4000) then
    raise exception 'Meeting purpose must be 20–4,000 meaningful characters.' using errcode = '23514';
  end if;
  if cardinality(v_organizations) > 10 then
    raise exception 'Invite no more than 10 offices to a meeting.' using errcode = '23514';
  end if;
  if cardinality(v_organizations) <> (select count(distinct o) from unnest(v_organizations) as u(o)) then
    raise exception 'Each office can only be invited once.' using errcode = '23514';
  end if;
  select count(*) into v_valid from public.organizations o
  where o.id = any(v_organizations) and o.active and (o.can_consult or o.can_coordinate);
  if v_valid <> cardinality(v_organizations) then
    raise exception 'Choose only active offices that can participate in community meetings.' using errcode = '23514';
  end if;
  if p_report is not null then
    select r.barangay_id, r.category_id into v_report_barangay, v_report_category
    from public.reports r
    where r.id = p_report and r.resident_id = v_user
      and (not r.is_demo or private.sample_data_enabled());
    if not found then
      raise exception 'Choose a report that belongs to your account.' using errcode = '42501';
    end if;
    v_barangay := v_report_barangay;
    v_category := coalesce(v_category, v_report_category);
  end if;
  if v_barangay is null or not exists (select 1 from public.barangays b where b.id = v_barangay) then
    raise exception 'Choose a barangay for this meeting request.' using errcode = '23514';
  end if;

  insert into public.meeting_requests(resident_id, barangay_id, title, body, category_id, report_id)
  values (v_user, v_barangay, btrim(p_title), btrim(p_body), v_category, p_report)
  returning id into v_request;

  insert into public.meeting_request_offices(request_id, organization_id, invited_by)
  select v_request, chosen, v_user from unnest(v_organizations) as u(chosen);
  return v_request;
end
$function$;
