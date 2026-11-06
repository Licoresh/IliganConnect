-- Apply the same account/data guard to every legacy public-report projection.
do $$
declare endpoint record; definition text; updated integer:=0;
begin
  for endpoint in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('public_reports','public_report_page','public_report_filter_counts')
  loop
    definition:=pg_get_functiondef(endpoint.oid);
    if position('where r.public_visible' in definition)=0 then
      raise exception 'Public-report definition changed; inspect before adding the account guard';
    end if;
    execute replace(definition,'where r.public_visible',
      'where (private.active_resident() or private.active_staff()) and not r.is_demo and r.public_visible');
    updated:=updated+1;
  end loop;
  if updated<>4 then raise exception 'Expected four public-report projections, found %',updated; end if;
end $$;
