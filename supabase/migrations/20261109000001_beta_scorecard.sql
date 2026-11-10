begin;

-- One row per local week, independent of telemetry retention.
create table public.beta_scorecard_deliveries (
  week_start date primary key check (extract(isodow from week_start) = 1),
  created_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz not null,
  attempt_token uuid not null,
  state text not null check (state in ('sending', 'uncertain', 'accepted')),
  payload jsonb,
  provider_email_id text,
  accepted_at timestamptz,
  check (
    (state = 'accepted' and provider_email_id is not null and accepted_at is not null and payload is null)
    or (state <> 'accepted' and provider_email_id is null and accepted_at is null and payload is not null)
  )
);
alter table public.beta_scorecard_deliveries enable row level security;
revoke all on public.beta_scorecard_deliveries from public, anon, authenticated, service_role;
grant select, insert, update on public.beta_scorecard_deliveries to service_role;

-- SECURITY DEFINER is needed only to aggregate Auth registrations; the caller
-- gets counts, never Auth records. No dynamic SQL or caller-supplied timezone.
create function public.beta_scorecard_report(
  p_week_start date, p_external_ids uuid[], p_internal_ids uuid[]
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_week_start is null or extract(isodow from p_week_start) <> 1
    or p_week_start + 7 > (now() at time zone 'America/New_York')::date
    or p_week_start < (now() at time zone 'America/New_York')::date - 77
    or coalesce(cardinality(p_external_ids), 0) > 1000
    or coalesce(cardinality(p_internal_ids), 0) > 1000 then
    raise exception 'Invalid scorecard report window or cohort' using errcode = '22023';
  end if;

  return (
    with periods as (
      select d as week_start,
        d::timestamp at time zone 'America/New_York' as starts_at,
        (d + 7)::timestamp at time zone 'America/New_York' as ends_at
      from (values (p_week_start - 7), (p_week_start)) weeks(d)
    ), cohorts as (
      select unnest(array['external_beta','internal_test','unclassified']) as cohort
    ), roster as (
      select a.id from auth.users a where not a.is_anonymous
        and a.id = any(coalesce(p_external_ids, '{}'::uuid[]))
        and not exists(select 1 from unnest(p_internal_ids) i(id) where i.id = a.id)
    ), first_assistant as (
      select t.investigation_id, t.user_id, min(t.created_at) as at
      from public.gap_investigation_turns t where t.role = 'assistant' and t.turn_index = 0
      group by t.investigation_id, t.user_id
    ), conclusions as (
      select t.investigation_id, t.user_id, min(t.created_at) as at
      from public.gap_investigation_turns t
      where t.role = 'assistant' and t.structured->>'action' = 'stop_and_conclude'
      group by t.investigation_id, t.user_id
    ), business as (
      select id as user_id, id as entity_id, created_at as at, 'registration' as kind
      from auth.users where not is_anonymous
      union all select user_id,id,created_at,'analysis' from public.analyses where status='completed'
      union all select user_id,id,updated_at,'task' from public.plan_tasks
        where status in ('in_progress','done') and updated_at > created_at
      union all select t.user_id,t.investigation_id,t.created_at,'reply'
        from public.gap_investigation_turns t where t.role='user'
      union all select i.user_id,i.id,t.at,'kickoff' from public.gap_investigations i
        join first_assistant t on t.investigation_id=i.id and t.user_id=i.user_id
      union all select i.user_id,i.id,t.at,'concluded' from public.gap_investigations i
        join conclusions t on t.investigation_id=i.id and t.user_id=i.user_id
        where i.status='concluded'
    ), activity as (
      select user_id,entity_id,at,kind from business
      union all select user_id,id,created_at,'provider' from public.telemetry_events
        where environment='production'
    ), subjects as (
      select user_id,
        case when exists(select 1 from unnest(p_internal_ids) i(id) where i.id = s.user_id) then 'internal_test'
             when exists(select 1 from roster r where r.id = s.user_id) then 'external_beta'
             else 'unclassified' end as cohort
      from (select distinct user_id from activity where at >= (select min(starts_at) from periods)
        and at < (select max(ends_at) from periods)) s
    ), product as (
      select p.week_start, s.cohort,
        count(*) filter(where a.kind='registration') as registrations,
        count(distinct a.user_id) filter(where a.kind in ('analysis','task','reply','provider')) as active_users,
        count(*) filter(where a.kind='analysis') as analyses,
        count(distinct a.user_id) filter(where a.kind='analysis' and exists (
          select 1 from public.analyses earlier where earlier.user_id=a.user_id
            and earlier.status='completed'
            and earlier.created_at < date_trunc('day',a.at at time zone 'America/New_York') at time zone 'America/New_York'
        )) as returning_analysis_users,
        count(*) filter(where a.kind='kickoff') as initialized_investigations,
        count(distinct a.entity_id) filter(where a.kind='reply') as investigations_with_replies,
        count(*) filter(where a.kind='concluded') as concluded_investigations
      from periods p join activity a on a.at >= p.starts_at and a.at < p.ends_at
        join subjects s using(user_id)
      group by p.week_start,s.cohort
    ), calls as (
      select p.week_start,s.cohort,t.user_id,t.outcome,t.latency_ms,t.estimated_cost_nanousd,
        case when t.route in ('kickoff','turn') then 'investigation' else t.route end as workflow,
        case when t.route in ('kickoff','turn') then coalesce(t.investigation_id,t.operation_id)
             when t.route='analysis' then coalesce(t.analysis_id,t.operation_id)
             else t.operation_id end as workflow_id,
        (t.route in ('kickoff','turn') and t.investigation_id is null
         or t.route='analysis' and t.analysis_id is null) as unlinked
      from periods p join public.telemetry_events t on t.created_at >= p.starts_at and t.created_at < p.ends_at
        join subjects s using(user_id)
      where t.environment='production'
    ), reliability as (
      select week_start,cohort,count(*) as calls,
        count(*) filter(where estimated_cost_nanousd is null) as unknown_cost_calls,
        sum(estimated_cost_nanousd) as known_spend_nanousd, round(avg(latency_ms),1) as mean_latency_ms,
        count(*) filter(where outcome='rejected') as rejected,
        count(*) filter(where outcome='incomplete') as incomplete,
        count(*) filter(where outcome='unknown') as unknown_outcome,
        count(*) filter(where unlinked) as unlinked_calls
      from calls group by week_start,cohort
    ), workflows as (
      select week_start,cohort,workflow,user_id,workflow_id,
        case when bool_and(estimated_cost_nanousd is not null and not unlinked)
          then sum(estimated_cost_nanousd) end as fully_priced_cost
      from calls group by week_start,cohort,workflow,user_id,workflow_id
    ), by_workflow as (
      select week_start,cohort,workflow,count(*) as observed,
        count(fully_priced_cost) as priced,round(avg(fully_priced_cost)) as mean_cost_nanousd
      from workflows group by week_start,cohort,workflow
    )
    select jsonb_build_object(
      'verified_beta_accounts',(select count(*) from roster),
      'periods',jsonb_agg(jsonb_build_object(
        'week_start',p.week_start,'starts_at',p.starts_at,'ends_at',p.ends_at,
        'cohorts',(select jsonb_object_agg(c.cohort,
          jsonb_build_object(
            'registrations',coalesce(b.registrations,0),'active_users',coalesce(b.active_users,0),
            'analyses',coalesce(b.analyses,0),'returning_analysis_users',coalesce(b.returning_analysis_users,0),
            'initialized_investigations',coalesce(b.initialized_investigations,0),
            'investigations_with_replies',coalesce(b.investigations_with_replies,0),
            'concluded_investigations',coalesce(b.concluded_investigations,0),
            'calls',coalesce(r.calls,0),'unknown_cost_calls',coalesce(r.unknown_cost_calls,0),
            'known_spend_nanousd',r.known_spend_nanousd,'mean_latency_ms',r.mean_latency_ms,
            'rejected',coalesce(r.rejected,0),'incomplete',coalesce(r.incomplete,0),
            'unknown_outcome',coalesce(r.unknown_outcome,0),'unlinked_calls',coalesce(r.unlinked_calls,0),
            'workflows',coalesce((select jsonb_object_agg(w.workflow,
              jsonb_build_object('observed',w.observed,'priced',w.priced,'mean_cost_nanousd',w.mean_cost_nanousd))
              from by_workflow w where w.week_start=p.week_start and w.cohort=c.cohort),'{}'::jsonb)
          ))
          from cohorts c
          left join product b on b.week_start=p.week_start and b.cohort=c.cohort
          left join reliability r on r.week_start=p.week_start and r.cohort=c.cohort)
      ) order by p.week_start))
    from periods p
  );
end;
$$;

revoke all on function public.beta_scorecard_report(date, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.beta_scorecard_report(date, uuid[], uuid[]) to service_role;
commit;
