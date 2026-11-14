set local lock_timeout = '5s';

-- Read only: caller RLS applies to the source, every candidate, and child links.
create function public.report_duplicate_candidates(p_id uuid)
returns table(id uuid,title text,description text,landmark text,status public.report_status,
  created_at timestamptz,distance_m double precision,days_apart double precision,
  same_problem boolean,text_similarity double precision,match_strength text,
  problem_label text,barangay_name text)
language plpgsql stable security invoker set search_path='' as $$
begin
  if not private.active_staff() then
    raise exception 'Staff access required' using errcode='42501';
  end if;
  return query
  with source as materialized (
    select a.* from public.reports a where a.id=p_id
      and a.status not in ('rejected','duplicate')
      and not exists(select 1 from public.report_duplicate_links l where l.canonical_id=a.id)
  ), nearest as materialized (
    select b.*,extensions.st_distance(a.location,b.location) as meters,
      abs(extract(epoch from a.created_at-b.created_at))::double precision/86400 as days,
      coalesce(a.problem_type is not null and a.problem_type<>'other' and a.problem_type=b.problem_type,false) as matching_problem
    from source a join public.reports b on b.category_id=a.category_id and b.id<>a.id and b.is_demo=a.is_demo
    where b.status not in ('rejected','duplicate')
      and b.created_at between a.created_at-interval '30 days' and a.created_at+interval '30 days'
      and extensions.st_dwithin(b.location,a.location,150)
      and (a.problem_type is null or b.problem_type is null or a.problem_type='other' or b.problem_type='other' or a.problem_type=b.problem_type)
      and not exists(select 1 from public.report_duplicate_links l where l.report_id=b.id)
    order by meters,b.created_at,b.id limit 100
  ), source_words as materialized (
    select array(select w from unnest(pg_catalog.tsvector_to_array(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
      a.title||' '||coalesce(a.problem_other,'')))) w
      where length(w)>=3 and w<>all(array['the','and','near','along','report','issue','please','this','that','with','from','for','nga','ang','mga'])) as words
    from source a
  ), words as (
    select n.*,s.words as source_tokens,
      array(select w from unnest(pg_catalog.tsvector_to_array(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
        n.title||' '||coalesce(n.problem_other,'')))) w
        where length(w)>=3 and w<>all(array['the','and','near','along','report','issue','please','this','that','with','from','for','nga','ang','mga'])) as candidate_tokens
    from nearest n cross join source_words s
  ), word_matches as (
    select w.*,(select count(*)::integer from unnest(w.source_tokens) t where t=any(w.candidate_tokens)) as shared_words
    from words w
  ), scored as (
    select o.*,case when shared_words>=2 or (cardinality(source_tokens)=1 and length(source_tokens[1])>=8 and shared_words=1)
      then shared_words::double precision/nullif(cardinality(source_tokens)+cardinality(candidate_tokens)-shared_words,0)
      else 0::double precision end as similarity
    from word_matches o
  )
  select c.id,c.title,c.description,c.landmark,c.status,c.created_at,c.meters,c.days,coalesce(c.matching_problem,false),c.similarity,
    case when c.days<=7 and ((c.matching_problem and c.meters<=25) or (c.similarity>=0.65 and c.meters<=50)) then 'strong' else 'possible' end,
    p.label,b.name
  from scored c join public.barangays b on b.id=c.barangay_id
  left join public.report_problem_types p on p.category_id=c.category_id and p.code=c.problem_type
  where (c.matching_problem and c.meters<=50) or c.similarity>=0.35
  order by (c.days<=7 and ((c.matching_problem and c.meters<=25) or (c.similarity>=0.65 and c.meters<=50))) desc,
    c.similarity desc,c.meters,c.created_at,c.id
  limit 8;
end;
$$;
revoke all on function public.report_duplicate_candidates(uuid) from public,anon;
grant execute on function public.report_duplicate_candidates(uuid) to authenticated;
comment on function public.report_duplicate_candidates(uuid) is 'Staff-only possible duplicates: same category/cohort, 150 m and 30 days; bounded nearest 100, top 8. Read-only; human confirmation required.';

-- One bounded request supplies indicators for the current queue page.
create function public.report_duplicate_summary(p_ids uuid[])
returns table(report_id uuid,possible_count integer)
language plpgsql stable security invoker set search_path='' as $$
begin
  if not private.active_staff() then raise exception 'Staff access required' using errcode='42501'; end if;
  if coalesce(cardinality(p_ids),0)>20 then raise exception 'Check no more than 20 reports at a time' using errcode='22023'; end if;
  return query select r.id,(select count(*)::integer from public.report_duplicate_candidates(r.id))
    from public.reports r where r.id=any(p_ids) order by r.id;
end;
$$;
revoke all on function public.report_duplicate_summary(uuid[]) from public,anon;
grant execute on function public.report_duplicate_summary(uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION public.change_report(p_id uuid, p_status public.report_status, p_note text, p_organization uuid DEFAULT NULL::uuid, p_severity integer DEFAULT NULL::integer, p_duplicate uuid DEFAULT NULL::uuid, p_public_summary text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.reports; allowed boolean; begin
-- Serialize duplicate-link changes before row locks, then recheck both records.
if p_status='duplicate' then
  if not private.report_action(p_id,'review') or not exists(
    select 1 from public.reports s join public.reports c on c.id=p_duplicate and c.is_demo=s.is_demo
    where s.id=p_id and (not s.is_demo or private.sample_data_enabled()) and private.report_action(c.id)
  ) then raise exception 'Not authorized'; end if;
  perform pg_catalog.pg_advisory_xact_lock(731104,1);
  perform 1 from public.reports where id in (p_id,p_duplicate) order by id for update;
end if;
select * into r from public.reports where id=p_id for update;
if r.id is null or not private.report_action(p_id,case when p_status='assigned' then 'refer' when p_status in ('in_progress','resolved') then 'update' else 'review' end) then raise exception 'Not authorized'; end if;
if r.is_demo and not private.sample_data_enabled() then raise exception 'Not authorized'; end if;
if length(trim(coalesce(p_note,''))) not between 5 and 4000 then raise exception 'Provide an action reason'; end if;
allowed := case r.status when 'submitted' then p_status in ('under_review','rejected','duplicate') when 'under_review' then p_status in ('verified','rejected','duplicate') when 'verified' then p_status in ('assigned','duplicate') when 'assigned' then p_status in ('in_progress','duplicate') when 'in_progress' then p_status in ('resolved','assigned') else p_status='under_review' end;
if not allowed then raise exception 'Invalid status transition'; end if;
if p_status='assigned' and p_organization is null then raise exception 'Choose an organization'; end if;
if p_organization is not null and p_status<>'assigned' then raise exception 'Assignment requires referral permission';end if;
if p_status='assigned' and not exists(select 1 from public.organizations o join public.organization_access_rules a on a.organization_id=o.id and a.enabled where o.id=p_organization and o.active and a.category_id=r.category_id and (a.barangay_id is null or a.barangay_id=r.barangay_id)) then raise exception 'Office has no approved responsibility for this category and jurisdiction';end if;
if p_status='verified' and p_severity is null then raise exception 'Record assessed severity'; end if;
if p_status='duplicate' then
if not exists(select 1 from public.reports x where x.id=p_duplicate and x.id<>p_id and x.status not in ('duplicate','rejected') and private.report_action(x.id) and x.is_demo=r.is_demo and (not x.is_demo or private.sample_data_enabled()) and not exists(select 1 from public.report_duplicate_links l where l.report_id=x.id)) or exists(select 1 from public.report_duplicate_links where canonical_id=p_id) then raise exception 'Choose an authorized canonical report without duplicate chains'; end if;
insert into public.report_duplicate_links values(p_id,p_duplicate,p_note) on conflict(report_id) do update set canonical_id=excluded.canonical_id,reason=excluded.reason;
else delete from public.report_duplicate_links where report_id=p_id; end if;
update public.reports set status=p_status,organization_id=coalesce(p_organization,organization_id),severity=case when p_status='verified' then p_severity else severity end,verified_at=case when p_status='verified' then now() when p_status='under_review' then null else verified_at end,public_summary=case when p_status='verified' then coalesce(nullif(trim(p_public_summary),''),public_summary) else public_summary end,public_visible=case when p_status in ('rejected','duplicate','under_review') then false when p_status='verified' and nullif(trim(p_public_summary),'') is not null then true else public_visible end where id=p_id;
insert into public.report_status_history(report_id,actor_id,old_status,new_status,public_note) values(p_id,auth.uid(),r.status,p_status,p_note);
if p_organization is not null then insert into public.report_assignments(report_id,organization_id,actor_id,reason) values(p_id,p_organization,auth.uid(),p_note); end if;
insert into public.notifications(user_id,title,report_id) select p.id,'A followed report has an update',p_id from public.profiles p where p.notifications_enabled and (p.id=r.resident_id or exists(select 1 from public.report_followers f where f.report_id=p_id and f.user_id=p.id));
end$function$;
