-- Rollback-only coverage for multi-scope consultation inputs and access rules.
begin;
set local statement_timeout='30s';
do $tests$
declare
  v_admin uuid:=gen_random_uuid();
  v_barangay_one_user uuid:=gen_random_uuid();
  v_barangay_two_user uuid:=gen_random_uuid();
  v_barangay_outside_user uuid:=gen_random_uuid();
  v_office_user uuid:=gen_random_uuid();
  v_barangay_one uuid;
  v_barangay_two uuid;
  v_barangay_outside uuid;
  v_organizations uuid[];
  v_invalid_organization uuid:=gen_random_uuid();
  v_primary_only uuid:=gen_random_uuid();
  v_admin_scope uuid:=gen_random_uuid();
  v_office_scope uuid:=gen_random_uuid();
  v_barangay_scope uuid:=gen_random_uuid();
  v_denied boolean;
begin
  select id into strict v_barangay_one from public.barangays where boundary is not null order by name offset 0 limit 1;
  select id into strict v_barangay_two from public.barangays where boundary is not null order by name offset 1 limit 1;
  select id into strict v_barangay_outside from public.barangays where boundary is not null order by name offset 2 limit 1;
  select array_agg(candidate.id order by candidate.name) into v_organizations
    from (
      select o.id,o.name
        from public.organizations o
        join public.organization_access_rules a on a.organization_id=o.id and a.enabled and a.barangay_id is null
       where o.active and o.can_consult
       group by o.id,o.name
       order by o.name
       limit 2
    ) candidate;
  assert cardinality(v_organizations)=2,'Two citywide consultation offices are required for this test';

  insert into auth.users(id,email) values
    (v_admin,v_admin::text||'@example.invalid'),
    (v_barangay_one_user,v_barangay_one_user::text||'@example.invalid'),
    (v_barangay_two_user,v_barangay_two_user::text||'@example.invalid'),
    (v_barangay_outside_user,v_barangay_outside_user::text||'@example.invalid'),
    (v_office_user,v_office_user::text||'@example.invalid');
  update public.profiles set role='admin',account_status='active' where id=v_admin;
  update public.profiles set role='barangay',account_status='active',barangay_id=v_barangay_one where id=v_barangay_one_user;
  update public.profiles set role='barangay',account_status='active',barangay_id=v_barangay_two where id=v_barangay_two_user;
  update public.profiles set role='barangay',account_status='active',barangay_id=v_barangay_outside where id=v_barangay_outside_user;
  update public.profiles set role='office',account_status='active' where id=v_office_user;
  insert into public.organization_memberships(user_id,organization_id)
    select v_office_user,selected from unnest(v_organizations) selected;

  insert into public.organizations(id,name,active,can_consult,can_coordinate,can_publish)
    values(v_invalid_organization,'[ROLLBACK ONLY] Non-consultation organization '||v_invalid_organization,true,false,false,false);

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  set local role authenticated;
  insert into public.consultations(id,title,body,status,barangay_id,organization_id,target_barangay_ids,target_organization_ids,include_barangay_admins)
    values(v_admin_scope,'Rollback multi-scope admin consultation','This temporary consultation verifies that excluded barangay admins have no staff access.','draft',
      v_barangay_one,v_organizations[1],array[v_barangay_one,v_barangay_two],v_organizations,false);
  reset role;

  perform set_config('request.jwt.claim.sub',v_barangay_one_user::text,true);
  set local role authenticated;
  assert not private.consultation_scope_access(v_admin_scope),'Excluded primary barangay administration retained access';
  reset role;
  perform set_config('request.jwt.claim.sub',v_barangay_two_user::text,true);
  set local role authenticated;
  assert not private.consultation_scope_access(v_admin_scope),'Excluded secondary barangay administration retained access';
  reset role;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  set local role authenticated;
  update public.consultations set include_barangay_admins=true where id=v_admin_scope;
  reset role;

  perform set_config('request.jwt.claim.sub',v_barangay_one_user::text,true);
  set local role authenticated;
  assert private.consultation_scope_access(v_admin_scope),'Included primary barangay administration cannot access the consultation';
  reset role;
  perform set_config('request.jwt.claim.sub',v_barangay_two_user::text,true);
  set local role authenticated;
  assert private.consultation_scope_access(v_admin_scope),'Included secondary barangay administration cannot access the consultation';
  reset role;
  perform set_config('request.jwt.claim.sub',v_barangay_outside_user::text,true);
  set local role authenticated;
  assert not private.consultation_scope_access(v_admin_scope),'An unselected barangay gained consultation access';
  reset role;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  set local role authenticated;
  v_denied:=false;
  begin
    insert into public.consultations(title,body,status,barangay_id,organization_id,target_barangay_ids,target_organization_ids,include_barangay_admins)
      values('Rollback invalid office scope','This temporary consultation must reject a non-consultation office.','draft',
        v_barangay_one,v_invalid_organization,array[v_barangay_one],array[v_invalid_organization],true);
  exception when raise_exception then
    v_denied:=sqlerrm='Choose active offices that can participate in consultations';
  end;
  assert v_denied,'Admin-selected office without consultation capability was accepted';

  -- Old callers that provide only the scalar organization_id remain supported.
  insert into public.consultations(id,title,body,status,barangay_id,organization_id)
    values(v_primary_only,'Rollback legacy office scope','This temporary row verifies single-office clients remain compatible.','draft',v_barangay_one,v_organizations[1]);
  assert cardinality((select target_organization_ids from public.consultations where id=v_primary_only))=0,
    'Legacy scalar-only input was unexpectedly rewritten';
  reset role;
  perform set_config('request.jwt.claim.sub',v_office_user::text,true);
  set local role authenticated;
  assert private.consultation_scope_access(v_primary_only),'Office could not access a legacy scalar-only consultation';
  reset role;

  -- Office form sends the primary scalar plus both multi-select arrays.
  perform set_config('request.jwt.claim.sub',v_office_user::text,true);
  set local role authenticated;
  insert into public.consultations(id,title,body,status,barangay_id,organization_id,target_barangay_ids,target_organization_ids,include_barangay_admins)
    values(v_office_scope,'Rollback multi-scope office consultation','This temporary row verifies multiple office and barangay selections.','draft',
      v_barangay_one,v_organizations[1],array[v_barangay_one,v_barangay_two],v_organizations,false);
  assert (select cardinality(target_barangay_ids)=2 and cardinality(target_organization_ids)=2 and include_barangay_admins
    from public.consultations where id=v_office_scope),'Office multi-select input did not persist with required barangay participation';
  assert private.consultation_scope_access(v_office_scope),'Submitting office cannot access its consultation';
  reset role;

  -- Barangay staff may select multiple issuing offices, but their location stays fixed.
  perform set_config('request.jwt.claim.sub',v_barangay_one_user::text,true);
  set local role authenticated;
  insert into public.consultations(id,title,body,status,barangay_id,organization_id,target_barangay_ids,target_organization_ids,include_barangay_admins)
    values(v_barangay_scope,'Rollback barangay multi-office consultation','This temporary row verifies a barangay can select multiple issuing offices.','draft',
      v_barangay_one,v_organizations[1],array[v_barangay_one],v_organizations,false);
  assert (select cardinality(target_organization_ids)=2 and include_barangay_admins
    from public.consultations where id=v_barangay_scope),'Barangay multi-office input did not persist or include its administration';
  reset role;

  raise notice 'PASS: consultation role scopes, multi-select arrays, scalar compatibility, office capability, and barangay inclusion';
end
$tests$;
rollback;
