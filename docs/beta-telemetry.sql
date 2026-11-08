-- Operator-only read queries. telemetry requires the separately approved migration.
-- Business records share a database across environments; those totals are NOT
-- environment-isolated. Exclude known synthetic/test account IDs when reporting beta.

-- Registrations (registered accounts, not anonymous Auth accounts).
select date_trunc('week',created_at at time zone 'UTC') as week,count(*) as registrations
from auth.users where not is_anonymous group by 1 order by 1;

-- Completed analyses, first completion and repeat usage from business records.
select date_trunc('week',created_at at time zone 'UTC') as week,count(*) as completed_analyses,
  count(distinct user_id) as users
from public.analyses where status='completed' group by 1 order by 1;
select user_id,min(created_at) as first_completed_analysis,count(*) as completed_analyses,
  count(distinct (created_at at time zone 'UTC')::date) as active_analysis_days
from public.analyses where status='completed' group by user_id;

-- Weekly active users = persisted activity, NOT visits, logins or authenticated sessions.
-- Task updated_at may equal creation, so exclude generated/untouched task rows.
with activity as (
  select user_id,created_at as at from public.analyses where status='completed'
  union all select user_id,created_at from public.gap_investigation_turns where role='user'
  union all select user_id,updated_at from public.plan_tasks where status in ('in_progress','done') and updated_at>created_at
  union all select user_id,created_at from public.telemetry_events where environment='production'
)
select date_trunc('week',at at time zone 'UTC') as week,count(distinct user_id) as active_users
from activity group by 1 order by 1;

-- An active row can precede a failed kickoff: count initialized sessions separately.
select i.status,count(*) as records,
  count(*) filter(where exists(select 1 from public.gap_investigation_turns t
    where t.investigation_id=i.id and t.role='assistant' and t.turn_index=0)) as initialized
from public.gap_investigations i group by i.status;
select status,count(*) as tasks from public.plan_tasks group by status;

-- Provider reliability, estimated spend and latency. Null cost is never zero cost.
-- success means a provider response, NOT validated/persisted application success.
select date_trunc('week',created_at at time zone 'UTC') as week,route,
  count(*) as recorded_attempts,
  count(*) filter(where estimated_cost_nanousd is null) as unknown_cost_attempts,
  sum(estimated_cost_nanousd)::numeric/1000000000 as known_estimated_usd,
  avg(latency_ms) as avg_provider_ms,
  count(*) filter(where outcome<>'success') as provider_errors
from public.telemetry_events where environment='production' group by 1,2 order by 1,2;
select route,error_category,count(*) from public.telemetry_events
where environment='production' and error_category is not null group by 1,2;

-- Investigation cost includes kickoff, turns and explicit recommendation checks.
-- Concluding is part of a turn, not an extra receipt. Never add these aggregates
-- back into per-call totals. Costs are incomplete when measurements are missing.
select investigation_id,route,count(*) as recorded_calls,
  sum(estimated_cost_nanousd)::numeric/1000000000 as known_estimated_usd,
  count(*) filter(where estimated_cost_nanousd is null) as unknown_cost_calls
from public.telemetry_events where environment='production' and investigation_id is not null
group by investigation_id,route;
