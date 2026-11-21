-- Run after migrations on an isolated database. All fixtures are rolled back.
begin;
insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000031','account-admin@example.invalid'),
  ('10000000-0000-4000-8000-000000000032','account-barangay@example.invalid'),
  ('10000000-0000-4000-8000-000000000033','account-office@example.invalid'),
  ('10000000-0000-4000-8000-000000000034','account-resident-one@example.invalid'),
  ('10000000-0000-4000-8000-000000000035','account-resident-two@example.invalid');

do $$
declare
  first_barangay uuid;
  second_barangay uuid;
begin
  select id into first_barangay from public.barangays order by name limit 1;
  select id into second_barangay from public.barangays where id<>first_barangay order by name limit 1;
  if first_barangay is null or second_barangay is null then raise exception 'TEST REQUIRES two barangays'; end if;

  insert into public.organizations(id,name,active)
  values ('20000000-0000-4000-8000-000000000031','Account management test office',true);

  update public.profiles set role='admin',account_status='active'
    where id='10000000-0000-4000-8000-000000000031';
  update public.profiles set role='barangay',barangay_id=first_barangay,account_status='active'
    where id='10000000-0000-4000-8000-000000000032';
  update public.profiles set role='office',account_status='pending'
    where id='10000000-0000-4000-8000-000000000033';
  update public.profiles set role='resident',barangay_id=first_barangay,account_status='active'
    where id='10000000-0000-4000-8000-000000000034';
  update public.profiles set role='resident',barangay_id=second_barangay,account_status='active'
    where id='10000000-0000-4000-8000-000000000035';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000031',true);
select public.admin_update_stakeholder_account(
  '10000000-0000-4000-8000-000000000033','office',null,'active',
  array['20000000-0000-4000-8000-000000000031']::uuid[]
);

do $$begin
  if not exists(select 1 from public.profiles where id='10000000-0000-4000-8000-000000000033' and role='office' and account_status='active' and barangay_id is null) then raise exception 'TEST FAILED: office role, status and jurisdiction saved together'; end if;
  if not exists(select 1 from public.organization_memberships where user_id='10000000-0000-4000-8000-000000000033' and organization_id='20000000-0000-4000-8000-000000000031') then raise exception 'TEST FAILED: office membership saved with account'; end if;
  begin
    perform public.admin_update_stakeholder_account('10000000-0000-4000-8000-000000000031','office',null,'active',array[]::uuid[]);
    raise exception 'TEST FAILED: administrator account appeared as editable staff';
  exception when raise_exception then
    if sqlerrm<>'Only barangay and office staff accounts can be managed here' then raise; end if;
  end;
  begin
    perform public.admin_update_stakeholder_account('10000000-0000-4000-8000-000000000034','office',null,'pending',array[]::uuid[]);
    raise exception 'TEST FAILED: resident account appeared as editable staff';
  exception when raise_exception then
    if sqlerrm<>'Only barangay and office staff accounts can be managed here' then raise; end if;
  end;
end$$;

select public.admin_update_stakeholder_account(
  '10000000-0000-4000-8000-000000000033','barangay',
  (select id from public.barangays order by name limit 1),'active',array[]::uuid[]
);
do $$begin
  if not exists(select 1 from public.profiles where id='10000000-0000-4000-8000-000000000033' and role='barangay' and account_status='pending' and barangay_id is not null) then raise exception 'TEST FAILED: role changes return to pending approval with the new jurisdiction'; end if;
  if exists(select 1 from public.organization_memberships where user_id='10000000-0000-4000-8000-000000000033') then raise exception 'TEST FAILED: changing to barangay removes office memberships'; end if;
end$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000032',true);
do $$
declare result jsonb;
begin
  result := public.barangay_residents('account-resident-one@example.invalid', 'name', 0);
  if (result->>'total')::int<>1 or jsonb_array_length(result->'items')<>1 then
    raise exception 'TEST FAILED: barangay directory contains only residents in the assigned barangay';
  end if;
  if result->'items'->0->>'id'<>'10000000-0000-4000-8000-000000000034' then
    raise exception 'TEST FAILED: another barangay resident was returned';
  end if;
  result := public.barangay_residents('account-resident-two@example.invalid', 'name', 0);
  if (result->>'total')::int<>0 or jsonb_array_length(result->'items')<>0 then
    raise exception 'TEST FAILED: resident from another barangay was returned';
  end if;
end$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000034',true);
do $$begin
  begin
    perform public.barangay_residents('', 'name', 0);
    raise exception 'TEST FAILED: resident read barangay directory';
  exception when insufficient_privilege then
    null;
  end;
end$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000033',true);
do $$begin
  begin
    perform public.barangay_residents('', 'name', 0);
    raise exception 'TEST FAILED: office staff read barangay directory';
  exception when insufficient_privilege then
    null;
  end;
end$$;
rollback;
