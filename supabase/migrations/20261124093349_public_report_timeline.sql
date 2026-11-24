create or replace function public.public_report_action_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_public_report(p_id) or not private.sample_report_visible(p_id) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',h.id,
      'old_status',h.old_status,
      'new_status',h.new_status,
      'public_note',h.public_note,
      'created_at',h.created_at,
      'action_kind',h.action_kind
    ) order by h.created_at,h.id)
    from public.report_status_history h
    where h.report_id=p_id
  ),'[]'::jsonb);
end $$;

revoke all on function public.public_report_action_history(uuid) from public,anon;
grant execute on function public.public_report_action_history(uuid) to authenticated;
notify pgrst,'reload schema';
