-- Application activation is separate from deployment. Never apply without approval.
begin;
do $$
begin
  if not exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls) then raise exception 'Trusted server role prerequisite missing'; end if;
  if exists(select 1 from unnest(array['profiles','career_profiles','analyses','plans','plan_tasks','signal_assessments','gaps','gap_investigations','gap_investigation_turns','gap_investigation_evidence']) t where to_regclass('public.'||t) is null) then raise exception 'Existing CareerMind schema required'; end if;
  if exists(select 1 from unnest(array['analyses','plans','plan_tasks','signal_assessments','gaps','gap_investigations','gap_investigation_turns','gap_investigation_evidence']) t cross join unnest(array['SELECT','INSERT']) p where not has_table_privilege('service_role','public.'||t,p)) or not has_table_privilege('service_role','public.gap_investigations','UPDATE') then raise exception 'Trusted server base-table permissions missing'; end if;

end $$;
create table public.ai_usage_settings (
  id boolean primary key default true check(id), enabled boolean not null default true,
  daily_budget_microusd bigint not null default 10000000 check(daily_budget_microusd >= 0)
);
insert into public.ai_usage_settings(id) values(true);
create table public.ai_usage_buckets (
  day date not null, subject text not null, category text not null,
  used integer not null default 0 check(used >= 0),
  spent bigint not null default 0 check(spent >= 0),
  reserved bigint not null default 0 check(reserved >= 0),
  primary key(day,subject,category)
);
create table public.ai_usage_operations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  request_key text not null, request_aliases text[] not null default '{}', fingerprint text not null,
  route text not null check(route in ('analysis','compare','kickoff','turn','recommendation','insights','strategy')),
  category text not null, units integer not null check(units between 1 and 3),
  day date not null, state text not null default 'reserved'
    check(state in ('reserved','running','retryable','uncertain','complete','failed')),
  owner uuid not null, lease_until timestamptz not null,
  call_pending boolean not null default false, calls integer not null default 0,
  ceiling bigint not null, remaining bigint not null check(remaining >= 0),
  steps jsonb not null default '{}', result jsonb,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(user_id,request_key)
);
create index ai_usage_operations_user_state on public.ai_usage_operations(user_id,state);
create index ai_usage_operations_fingerprint on public.ai_usage_operations(user_id,route,fingerprint,created_at desc);
-- No authenticated/browser access, including anonymous Auth accounts.
alter table public.ai_usage_settings enable row level security;
alter table public.ai_usage_buckets enable row level security;
alter table public.ai_usage_operations enable row level security;
revoke all on public.ai_usage_settings,public.ai_usage_buckets,public.ai_usage_operations from public,anon,authenticated;
grant select,insert,update,delete on public.ai_usage_settings,public.ai_usage_buckets,public.ai_usage_operations to service_role;

create function public.ai_usage_claim(p_user uuid,p_key text,p_hash text,p_route text,p_units integer default 1)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.ai_usage_operations; active public.ai_usage_operations; s public.ai_usage_settings;
  d date := (clock_timestamp() at time zone 'UTC')::date; cat text; lim integer; cap bigint; n integer; stale public.ai_usage_operations; owner_id uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(8913,1);
  if p_user is null or p_key !~ '^[a-f0-9]{64}$' or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid operation identity'; end if;
  cat := case when p_route='analysis' then 'analysis' when p_route in ('kickoff','turn') then 'gap' else 'other' end;
  lim := case cat when 'analysis' then 5 when 'gap' then 20 else 10 end;
  cap := case p_route when 'analysis' then 2170000 when 'kickoff' then 2130000 when 'turn' then 2130000 when 'compare' then 2110000 else 2120000 end;
  if p_route not in ('analysis','compare','kickoff','turn','recommendation','insights','strategy') or p_units not between 1 and 3 or (p_route <> 'compare' and p_units <> 1) then raise exception 'Invalid usage policy'; end if;
  delete from public.ai_usage_operations where state in ('complete','failed') and updated_at<clock_timestamp()-interval '24 hours';
  delete from public.ai_usage_buckets where day<d-30 and reserved=0;
  select * into o from public.ai_usage_operations where user_id=p_user and (request_key=p_key or p_key=any(request_aliases));
  if found and o.fingerprint <> p_hash then return jsonb_build_object('code','AI_KEY_CONFLICT','status',409); end if;
  if not found then
    select * into o from public.ai_usage_operations where user_id=p_user and route=p_route and fingerprint=p_hash
      and (created_at > clock_timestamp()-interval '24 hours' or state not in ('complete','failed')) order by created_at desc limit 1;
  end if;
  if o.id is not null and o.request_key<>p_key and not p_key=any(o.request_aliases) then
    if cardinality(o.request_aliases)>=64 then return jsonb_build_object('code','AI_DUPLICATE_LIMIT','status',429,'retry_after',86400); end if;
    update public.ai_usage_operations set request_aliases=array_append(request_aliases,p_key) where id=o.id returning * into o;
  end if;
  if o.id is not null then
    if o.state in ('complete','failed') then return jsonb_build_object('replay',o.result); end if;
    if o.state='uncertain' or (o.call_pending and o.lease_until <= clock_timestamp()) then
      update public.ai_usage_operations set state='uncertain' where id=o.id;
      return jsonb_build_object('code','AI_OUTCOME_UNCERTAIN','status',503,'retry_after',300);
    end if;
    if o.lease_until > clock_timestamp() then return jsonb_build_object('code','AI_IN_PROGRESS','status',429,'retry_after',5); end if;
    if not (o.steps ? 'response:0') and not coalesce((select enabled from public.ai_usage_settings where id=true),false) then return jsonb_build_object('code','AI_DISABLED','status',503,'retry_after',300); end if;
    -- Resume the same reservation and saved provider output, never recharge it.
    update public.ai_usage_operations set owner=owner_id,lease_until=clock_timestamp()+interval '5 minutes',state='reserved' where id=o.id returning * into o;
    return jsonb_build_object('operation',to_jsonb(o));
  end if;
  for stale in select * from public.ai_usage_operations where state in ('reserved','retryable') and calls=0 and not call_pending and not (steps ? 'persist:user_turn') and not (steps ? 'persist:investigation') and lease_until<=clock_timestamp() loop
    update public.ai_usage_buckets set reserved=reserved-stale.remaining where day=stale.day and subject='app' and category='budget';
    update public.ai_usage_buckets set used=used-stale.units where day=stale.day and subject=stale.user_id::text and category=stale.category;
    update public.ai_usage_operations set state='failed',remaining=0,request_key='released:'||id::text,request_aliases='{}',fingerprint='released:'||id::text,updated_at=clock_timestamp(),result=jsonb_build_object('status',503,'body',jsonb_build_object('success',false,'error','AI claim expired')) where id=stale.id;
  end loop;
  select * into s from public.ai_usage_settings where id=true for update;
  if s.id is null or not s.enabled then return jsonb_build_object('code','AI_DISABLED','status',503,'retry_after',300); end if;
  select * into active from public.ai_usage_operations where user_id=p_user and
    (state in ('uncertain','retryable') or (state in ('reserved','running') and (call_pending or lease_until > clock_timestamp() or steps ? 'persist:user_turn' or steps ? 'persist:investigation'))) limit 1;
  if found then
    if active.state='uncertain' or (active.call_pending and active.lease_until<=clock_timestamp()) then
      update public.ai_usage_operations set state='uncertain' where id=active.id;
      return jsonb_build_object('code','AI_OUTCOME_UNCERTAIN','status',503,'retry_after',300);
    end if;
    if active.state='retryable' or (not active.call_pending and active.lease_until<=clock_timestamp()) then return jsonb_build_object('code','AI_RECOVERY_REQUIRED','status',409); end if;
    return jsonb_build_object('code','AI_IN_PROGRESS','status',429,'retry_after',5);
  end if;
  select count(*) into n from public.ai_usage_operations where user_id=p_user and created_at>clock_timestamp()-interval '1 minute';
  if n>=5 then return jsonb_build_object('code','AI_BURST_LIMIT','status',429,'retry_after',60); end if;
  insert into public.ai_usage_buckets(day,subject,category) values(d,p_user::text,cat),(d,'app','budget') on conflict do nothing;
  select used into n from public.ai_usage_buckets where day=d and subject=p_user::text and category=cat;
  if n+p_units>lim then return jsonb_build_object('code','AI_DAILY_LIMIT','status',429,'retry_after',greatest(1,ceil(extract(epoch from ((d+1)::timestamp at time zone 'UTC')-clock_timestamp()))::int)); end if;
  if (select spent from public.ai_usage_buckets where day=d and subject='app' and category='budget')+
    (select coalesce(sum(reserved),0) from public.ai_usage_buckets where subject='app' and category='budget')+cap*p_units>s.daily_budget_microusd then
    return jsonb_build_object('code','AI_BUDGET_LIMIT','status',429,'retry_after',greatest(1,ceil(extract(epoch from ((d+1)::timestamp at time zone 'UTC')-clock_timestamp()))::int));
  end if;
  update public.ai_usage_buckets set used=used+p_units where day=d and subject=p_user::text and category=cat;
  update public.ai_usage_buckets set reserved=reserved+cap*p_units where day=d and subject='app' and category='budget';
  insert into public.ai_usage_operations(user_id,request_key,fingerprint,route,category,units,day,owner,lease_until,ceiling,remaining)
    values(p_user,p_key,p_hash,p_route,cat,p_units,d,owner_id,clock_timestamp()+interval '5 minutes',cap,cap*p_units) returning * into o;
  return jsonb_build_object('operation',to_jsonb(o));
end $$;

-- All mutations use the claim's unguessable owner token as a fencing token.
create function public.ai_usage_step(p_id uuid,p_owner uuid,p_action text,p_key text,p_value jsonb default 'null')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.ai_usage_operations; cost bigint; v jsonb;
begin
  perform pg_advisory_xact_lock(8913,1);
  select * into o from public.ai_usage_operations where id=p_id for update;
  if not found or o.owner<>p_owner or o.lease_until<=clock_timestamp() or o.state not in ('reserved','running') then raise exception 'Operation ownership expired'; end if;
  if p_action='read' then return o.steps->p_key; end if;
  if o.steps ? p_key then return o.steps->p_key; end if;
  if p_action='begin' then
    if o.call_pending or o.remaining<o.ceiling then raise exception 'No reserved call available'; end if;
    if not coalesce((select enabled from public.ai_usage_settings where id=true),false) then raise exception 'AI disabled'; end if;
    update public.ai_usage_operations set call_pending=true,state='running',calls=calls+1,lease_until=clock_timestamp()+interval '5 minutes' where id=p_id;
    return 'true'::jsonb;
  elsif p_action='rejected' then
    if not o.call_pending then raise exception 'No pending call'; end if;
    update public.ai_usage_buckets set reserved=reserved-o.ceiling where day=o.day and subject='app' and category='budget';
    update public.ai_usage_operations set call_pending=false,remaining=remaining-o.ceiling where id=p_id;
  elsif p_action='response' then
    if not o.call_pending then raise exception 'No pending call'; end if;
    if coalesce(jsonb_typeof(p_value->'usage'->'input_tokens'),'null') <> 'number' or coalesce(jsonb_typeof(p_value->'usage'->'output_tokens'),'null') <> 'number' or (p_value->'usage'->>'input_tokens')::numeric<0 or (p_value->'usage'->>'output_tokens')::numeric<0
      or coalesce(p_value->>'model','') not in ('gpt-4.1','gpt-4.1-2025-04-14') then raise exception 'Unreliable usage receipt'; end if;
    cost := (p_value->'usage'->>'input_tokens')::bigint*2+(p_value->'usage'->>'output_tokens')::bigint*8;
    if cost<0 or cost>o.ceiling then raise exception 'Usage exceeds policy ceiling'; end if;
    update public.ai_usage_buckets set spent=spent+cost,reserved=reserved-o.ceiling where day=o.day and subject='app' and category='budget';
    update public.ai_usage_operations set call_pending=false,remaining=remaining-o.ceiling where id=p_id;
  elsif p_action <> 'save' then raise exception 'Invalid operation step'; end if;
  update public.ai_usage_operations set steps=steps||jsonb_build_object(p_key,p_value),updated_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes' where id=p_id;
  return p_value;
end $$;

create function public.ai_usage_end(p_id uuid,p_owner uuid,p_result jsonb,p_retry boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare o public.ai_usage_operations;
begin
  perform pg_advisory_xact_lock(8913,1);
  select * into o from public.ai_usage_operations where id=p_id for update;
  if not found or o.owner<>p_owner or o.state not in ('reserved','running') then raise exception 'Operation owner mismatch'; end if;
  if o.call_pending then
    update public.ai_usage_operations set state='uncertain',lease_until=clock_timestamp(),updated_at=clock_timestamp() where id=p_id;
    return; -- Keep both cost and concurrency protection; timeouts are not refunds.
  end if;
  if p_retry then
    update public.ai_usage_operations set state='retryable',lease_until=clock_timestamp(),updated_at=clock_timestamp() where id=p_id;
    return;
  end if;
  update public.ai_usage_buckets set reserved=reserved-o.remaining where day=o.day and subject='app' and category='budget';
  if o.calls<o.units then
    update public.ai_usage_buckets set used=used-(o.units-o.calls) where day=o.day and subject=o.user_id::text and category=o.category;
  end if;
  update public.ai_usage_operations set state=case when (p_result->>'status')::int<400 then 'complete' else 'failed' end,
    remaining=0,result=p_result,lease_until=clock_timestamp(),updated_at=clock_timestamp() where id=p_id;
end $$;

-- Fixed CareerMind persistence actions, transactionally checkpointed with their
-- writes. A retry cannot duplicate an answer, assistant reply, or analysis.
create function public.ai_usage_persist(p_id uuid,p_owner uuid,p_kind text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.ai_usage_operations; k text := 'persist:'||p_kind; v jsonb; r jsonb; aid uuid; pid uuid; iid uuid; idx integer;
begin
  perform pg_advisory_xact_lock(8913,1);
  select * into o from public.ai_usage_operations where id=p_id for update;
  if not found or o.owner<>p_owner or o.lease_until<=clock_timestamp() or o.state not in ('reserved','running') then raise exception 'Operation owner expired'; end if;
  if o.steps ? k then return o.steps->k; end if;
  if p_kind='analysis' and o.route='analysis' then
    if not exists(select 1 from public.career_profiles where id=(p_data->'analysis'->>'career_profile_id')::uuid and user_id=o.user_id) then raise exception 'Profile not owned'; end if;
    aid := gen_random_uuid(); pid := gen_random_uuid();
    r := p_data->'analysis'||jsonb_build_object('id',aid,'user_id',o.user_id,'created_at',clock_timestamp(),'updated_at',clock_timestamp());
    insert into public.analyses select (jsonb_populate_record(null::public.analyses,r)).*;
    for r in select value from jsonb_array_elements(p_data->'signals') loop
      insert into public.signal_assessments select (jsonb_populate_record(null::public.signal_assessments,r||jsonb_build_object('id',gen_random_uuid(),'analysis_id',aid,'user_id',o.user_id,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
    end loop;
    for r in select value from jsonb_array_elements(p_data->'gaps') loop
      insert into public.gaps select (jsonb_populate_record(null::public.gaps,r||jsonb_build_object('id',gen_random_uuid(),'analysis_id',aid,'user_id',o.user_id,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
    end loop;
    insert into public.plans select (jsonb_populate_record(null::public.plans,p_data->'plan'||jsonb_build_object('id',pid,'analysis_id',aid,'user_id',o.user_id,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
    for r in select value from jsonb_array_elements(p_data->'tasks') loop
      insert into public.plan_tasks select (jsonb_populate_record(null::public.plan_tasks,r||jsonb_build_object('id',gen_random_uuid(),'plan_id',pid,'user_id',o.user_id,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
    end loop;
    v := jsonb_build_object('analysisId',aid,'planId',pid,'result',p_data->'result');
  elsif p_kind='investigation' and o.route='kickoff' then
    if not exists(select 1 from public.gaps g join public.analyses a on a.id=g.analysis_id where g.id=(p_data->>'seed_gap_id')::uuid and a.id=(p_data->>'seed_analysis_id')::uuid and g.user_id=o.user_id and a.user_id=o.user_id and a.career_profile_id=(p_data->>'career_profile_id')::uuid) then raise exception 'Seed not owned'; end if;
    r := p_data||jsonb_build_object('id',gen_random_uuid(),'user_id',o.user_id,'status','active','turn_count',0,'created_at',clock_timestamp(),'updated_at',clock_timestamp(),'updated_at',clock_timestamp());
    insert into public.gap_investigations select (jsonb_populate_record(null::public.gap_investigations,r)).* returning to_jsonb(gap_investigations.*) into v;
  elsif p_kind in ('user_turn','assistant_turn') and o.route in ('turn','kickoff') then
    iid := (p_data->>'investigation_id')::uuid;
    if not exists(select 1 from public.gap_investigations where id=iid and user_id=o.user_id and status='active') then raise exception 'Investigation unavailable'; end if;
    if p_kind='user_turn' and (select role from public.gap_investigation_turns where investigation_id=iid order by turn_index desc limit 1)='user' then raise exception 'Previous answer requires recovery'; end if;
    select coalesce(max(turn_index)+1,0) into idx from public.gap_investigation_turns where investigation_id=iid;
    if idx<>(p_data->>'turn_index')::int then raise exception 'Conversation changed'; end if;
    r := p_data||jsonb_build_object('id',gen_random_uuid(),'user_id',o.user_id,'role',case p_kind when 'user_turn' then 'user' else 'assistant' end,'created_at',clock_timestamp(),'updated_at',clock_timestamp());
    insert into public.gap_investigation_turns select (jsonb_populate_record(null::public.gap_investigation_turns,r)).* returning to_jsonb(gap_investigation_turns.*) into v;
  elsif p_kind='evidence' and o.route in ('turn','kickoff') then
    for r in select value from jsonb_array_elements(p_data) loop
      if not exists(select 1 from public.gap_investigations where id=(r->>'investigation_id')::uuid and user_id=o.user_id) then raise exception 'Investigation not owned'; end if;
      insert into public.gap_investigation_evidence select (jsonb_populate_record(null::public.gap_investigation_evidence,r||jsonb_build_object('id',gen_random_uuid(),'user_id',o.user_id,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
    end loop; v := 'true'::jsonb;
  elsif p_kind='investigation_update' and o.route in ('turn','kickoff') then
    iid := (p_data->>'id')::uuid;
    select to_jsonb(i) into r from public.gap_investigations i where id=iid and user_id=o.user_id for update;
    if r is null then raise exception 'Investigation not owned'; end if;
    r := r||p_data||jsonb_build_object('user_id',o.user_id,'updated_at',clock_timestamp());
    update public.gap_investigations set
      turn_count=(r->>'turn_count')::int,status=r->>'status',conclusion=r->>'conclusion',conclusion_summary=r->>'conclusion_summary',
      remaining_uncertainty=r->>'remaining_uncertainty',underlying_capability=r->>'underlying_capability',resume_evidence=r->>'resume_evidence',
      target_role_fit=r->>'target_role_fit',residual_gap=r->>'residual_gap',updated_at=clock_timestamp() where id=iid;
    v := 'true'::jsonb;
  else raise exception 'Invalid persistence action'; end if;
  update public.ai_usage_operations set steps=steps||jsonb_build_object(k,v),lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where id=p_id;
  return v;
end $$;

revoke all on function public.ai_usage_claim(uuid,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.ai_usage_step(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.ai_usage_end(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.ai_usage_persist(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ai_usage_claim(uuid,text,text,text,integer),public.ai_usage_step(uuid,uuid,text,text,jsonb),public.ai_usage_end(uuid,uuid,jsonb,boolean),public.ai_usage_persist(uuid,uuid,text,jsonb) to service_role;
commit;
