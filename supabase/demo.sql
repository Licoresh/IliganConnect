-- Explicit opt-in synthetic dataset. First create at least one resident via mobile registration.
-- Execute with a database administrator connection, never a public client.
do $$declare resident uuid; c uuid; b uuid; lat double precision; lon double precision; n integer; begin
select p.id into resident from public.profiles p join auth.users u on u.id=p.id where p.role='resident' and u.raw_user_meta_data->>'is_demo'='true' limit 1;
if resident is null then raise exception 'Create a demo resident through Auth first'; end if;
for n in 1..24 loop
select id into c from public.report_categories order by name offset ((n-1)%6) limit 1;
select id into b from public.barangays order by name offset ((n-1)%6) limit 1;
select extensions.st_y(extensions.st_pointonsurface(boundary)),extensions.st_x(extensions.st_pointonsurface(boundary)) into lat,lon from public.barangays where id=b and boundary is not null;
if lat is null or lon is null then raise exception 'Barangay boundary is required before creating mapped demo reports'; end if;
if not exists(select 1 from public.reports where is_demo and title='[DEMO] Synthetic community issue '||n) then
insert into public.reports(resident_id,category_id,problem_type,barangay_id,title,description,latitude,longitude,status,severity,verified_at,public_summary,public_visible,is_demo,created_at)
values(resident,c,(select code from public.report_problem_types where category_id=c order by sort_order limit 1),b,'[DEMO] Synthetic community issue '||n,'Synthetic university demonstration record. This does not describe an actual complaint or verified local condition.',lat,lon,case when n%4=0 then 'submitted'::public.report_status else 'verified'::public.report_status end,case when n%4<>0 then 2 end,case when n%4<>0 then now() end,'[DEMO] Synthetic community issue '||n,n%4<>0,true,now()-n*interval '1 day');
end if;
end loop;end$$;

update public.reports r set is_demo=true where title like '[DEMO]%' and exists(select 1 from auth.users u where u.id=r.resident_id and u.raw_user_meta_data->>'is_demo'='true');
