-- Separate installation approval required. No accounting RPCs or business tables change.
begin;
create table public.telemetry_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check(event_type = 'ai_call'),
  created_at timestamptz not null default clock_timestamp(),
  user_id uuid not null,
  operation_id uuid not null,
  call_index integer not null check(call_index >= 0),
  analysis_id uuid,
  investigation_id uuid,
  environment text not null check(environment in ('production','preview','development','unknown')),
  route text not null check(route in ('analysis','compare','kickoff','turn','recommendation','insights','strategy')),
  provider_response_id text unique,
  model text not null,
  input_tokens bigint check(input_tokens >= 0),
  cached_input_tokens bigint check(cached_input_tokens >= 0),
  output_tokens bigint check(output_tokens >= 0),
  pricing_version text,
  estimated_cost_nanousd bigint check(estimated_cost_nanousd >= 0),
  latency_ms bigint not null check(latency_ms >= 0),
  outcome text not null check(outcome in ('success','incomplete','rejected','unknown')),
  error_category text check(error_category in ('provider_rejected','provider_incomplete','provider_unknown')),
  unique(operation_id,call_index),
  check(cached_input_tokens is null or (input_tokens is not null and cached_input_tokens <= input_tokens)),
  check(estimated_cost_nanousd is null or (pricing_version is not null and input_tokens is not null and cached_input_tokens is not null and output_tokens is not null))
);
-- Soft IDs intentionally survive existing operation pruning and business deletion.
create index telemetry_environment_time on public.telemetry_events(environment,created_at);
create index telemetry_investigation on public.telemetry_events(investigation_id) where investigation_id is not null;
create index telemetry_analysis on public.telemetry_events(analysis_id) where analysis_id is not null;
alter table public.telemetry_events enable row level security;
revoke all on public.telemetry_events from public,anon,authenticated;
grant select,insert,update,delete on public.telemetry_events to service_role;
commit;
