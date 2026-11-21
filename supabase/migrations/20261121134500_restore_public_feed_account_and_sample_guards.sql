-- Recent search filters replaced the legacy projections and dropped their active-account/sample gates.
do $$
declare
  endpoint record;
  definition text;
  updated integer := 0;
begin
  for endpoint in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('public_report_page','public_report_filter_counts')
  loop
    definition := pg_get_functiondef(endpoint.oid);
    if position('where r.public_visible' in definition)=0 then
      raise exception 'Public-report definition changed; inspect before restoring account/sample guards';
    end if;
    if position('private.active_resident() or private.active_staff()' in definition)>0
      and position('private.sample_data_enabled()' in definition)>0 then
      continue;
    end if;
    execute replace(
      definition,
      'where r.public_visible',
      'where (private.active_resident() or private.active_staff()) and (not r.is_demo or private.sample_data_enabled()) and r.public_visible'
    );
    updated := updated+1;
  end loop;
  if updated<>3 then raise exception 'Expected three public-report functions to be guarded, updated %',updated; end if;
end $$;

notify pgrst, 'reload schema';
