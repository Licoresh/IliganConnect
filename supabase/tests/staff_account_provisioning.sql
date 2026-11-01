-- Run after migrations + seed with an administrative database connection.
-- Transaction rolls back all test fixtures.
begin;
insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000011','admin-provision@example.invalid'),
  ('10000000-0000-4000-8000-000000000012','barangay-provision@example.invalid'),
  ('10000000-0000-4000-8000-000000000013','office-provision@example.invalid'),
  ('10000000-0000-4000-8000-000000000014','resident-provision@example.invalid');
insert into public.organizations(id,name,active)
values ('20000000-0000-4000-8000-000000000011','Provisioning test office',true);
update public.profiles set role='admin',account_status='active'
where id='10000000-0000-4000-8000-000000000011';

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',true);
select public.provision_staff_account(
  '10000000-0000-4000-8000-000000000012','barangay',
  (select id from public.barangays order by name limit 1),null
);
select public.provision_staff_account(
  '10000000-0000-4000-8000-000000000013','office',null,
  '20000000-0000-4000-8000-000000000011'
);
do $$begin
  if not exists(select 1 from public.profiles where id='10000000-0000-4000-8000-000000000012' and role='barangay' and account_status='pending' and barangay_id is not null) then raise exception 'TEST FAILED: barangay assignment'; end if;
  if exists(select 1 from public.organization_memberships where user_id='10000000-0000-4000-8000-000000000012') then raise exception 'TEST FAILED: barangay account received office membership'; end if;
  if not exists(select 1 from public.profiles where id='10000000-0000-4000-8000-000000000013' and role='office' and account_status='pending' and barangay_id is null) then raise exception 'TEST FAILED: office account role'; end if;
  if not exists(select 1 from public.organization_memberships where user_id='10000000-0000-4000-8000-000000000013' and organization_id='20000000-0000-4000-8000-000000000011') then raise exception 'TEST FAILED: office membership'; end if;
end$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000014',true);
do $$begin
  begin
    perform public.provision_staff_account('10000000-0000-4000-8000-000000000012','barangay',(select id from public.barangays order by name limit 1),null);
    raise exception 'TEST FAILED: resident provisioned staff';
  exception when raise_exception then
    if sqlerrm <> 'Not authorized' then raise; end if;
  end;
end$$;
rollback;
