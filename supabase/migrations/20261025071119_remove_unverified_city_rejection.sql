-- Indicative barangay polygons are incomplete; do not reject reports using them alone.
drop trigger if exists report_city_boundary on public.reports;
drop function if exists private.check_report_city();
