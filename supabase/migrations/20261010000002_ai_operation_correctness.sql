-- CareerMind beta: three concrete operations, no background workflow engine.
-- Must follow the Phase 2a rate-limit migration. See scripts/tests/README.md.
begin;
set local lock_timeout = '5s';

-- Stop without changing legacy conversations if the old race has already occurred.
do $$ begin
  if exists (select 1 from public.gap_investigation_turns group by investigation_id, turn_index having count(*) > 1) then
    raise exception 'Duplicate investigation turn indexes exist. Review affected conversations before applying this migration.';
  end if;
end $$;
create unique index if not exists gap_turn_position_unique
  on public.gap_investigation_turns(investigation_id, turn_index);

create table if not exists public.career_ai_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('analyze','gap_kickoff','gap_turn')),
  request_key text not null check (length(request_key) between 1 and 200),
  input_hash text not null,
  context jsonb not null default '{}'::jsonb,
  investigation_id uuid references public.gap_investigations(id) on delete cascade,
  question_id uuid references public.gap_investigation_turns(id) on delete restrict,
  user_turn_id uuid references public.gap_investigation_turns(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','running','completed')),
  attempt_token uuid,
  lease_until timestamptz,
  checkpoint jsonb,
  result jsonb,
  event_id uuid references public.rate_limit_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,kind,request_key)
);
create unique index if not exists gap_operation_question_unique
  on public.career_ai_operations(investigation_id,question_id) where kind = 'gap_turn';
create unique index if not exists gap_operation_pending_unique
  on public.career_ai_operations(investigation_id) where kind = 'gap_turn' and status <> 'completed';
alter table public.career_ai_operations enable row level security;
-- Appending/renumbering transcript turns must go through the claim/finalize
-- functions; otherwise direct API writes could bypass the concurrency lock.
revoke insert,update,delete on public.gap_investigation_turns from authenticated,anon;
-- Operation context/checkpoints contain sensitive career data: RPC access only.
revoke all on public.career_ai_operations from public, anon, authenticated;

-- Replace the original function as well, for installations where Phase 2a
-- was already applied. Reservation cleanup must not delete referenced events.
create or replace function public.try_consume_rate_limit(
  p_user_id          uuid,
  p_bucket           text,
  p_limit            int,
  p_idempotency_key  text default null
) returns table (
  outcome              text,
  event_id             uuid,
  result_ref           text,
  used                 int,
  quota_limit          int,
  retry_after_seconds  int
) language plpgsql security definer set search_path = public as $$
declare
  v_lock_key   bigint;
  v_existing   public.rate_limit_events%rowtype;
  v_used       int;
  v_oldest     timestamptz;
  v_new_id     uuid;
begin
  v_lock_key := ('x' || substr(md5(p_user_id::text || ':' || p_bucket), 1, 15))::bit(60)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- Idempotency check inside the lock. If the same (user, bucket, key)
  -- exists, surface its current state. Callers decide what to do by
  -- the outcome value.
  if p_idempotency_key is not null then
    select * into v_existing
      from rate_limit_events
     where user_id = p_user_id
       and bucket = p_bucket
       and idempotency_key = p_idempotency_key
     limit 1;

    if found then
      select count(*) into v_used
        from rate_limit_events
       where user_id = p_user_id
         and bucket = p_bucket
         and created_at > now() - interval '60 minutes'
         and status <> 'refunded';
      case v_existing.status
        when 'in_progress' then
          return query select 'duplicate_in_progress'::text, v_existing.id, null::text,
                              v_used, p_limit, 0;
        when 'completed' then
          return query select 'duplicate_completed'::text, v_existing.id, v_existing.result_ref,
                              v_used, p_limit, 0;
        when 'failed' then
          return query select 'duplicate_failed'::text, v_existing.id, null::text,
                              v_used, p_limit, 0;
        when 'refunded' then
          return query select 'duplicate_refunded'::text, v_existing.id, null::text,
                              v_used, p_limit, 0;
      end case;
      return;
    end if;
  end if;

  -- Normal reservation path: count the window (excluding refunded rows),
  -- then insert if under limit.
  select count(*), min(created_at)
    into v_used, v_oldest
    from rate_limit_events
   where user_id = p_user_id
     and bucket = p_bucket
     and created_at > now() - interval '60 minutes'
     and status <> 'refunded';

  if v_used >= p_limit then
    return query select 'rate_limited'::text, null::uuid, null::text,
                        v_used, p_limit,
                        greatest(1, extract(epoch from (v_oldest + interval '60 minutes' - now()))::int);
    return;
  end if;

  insert into rate_limit_events(user_id, bucket, idempotency_key)
    values (p_user_id, p_bucket, p_idempotency_key)
    returning id into v_new_id;

  -- Retention is explicit: durable operations can reference these events.
  -- Do not probabilistically delete reservations during a user request.

  return query select 'reserved'::text, v_new_id, null::text, v_used + 1, p_limit, 0;
end;
$$;

-- SECURITY DEFINER endpoints derive identity from the session, never a supplied user id.
create or replace function public.lookup_career_operation(p_kind text, p_key text, p_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.career_ai_operations%rowtype;
begin
  if auth.uid() is null then raise exception 'Unauthorized' using errcode = '42501'; end if;
  select * into o from public.career_ai_operations where user_id = auth.uid() and kind = p_kind and request_key = p_key;
  if not found then
    -- Legacy reservations lack an input fingerprint and may have marked
    -- incomplete data as completed. Do not silently regenerate or trust them.
    if exists(select 1 from public.rate_limit_events where user_id=auth.uid() and idempotency_key=p_key and bucket=case when p_kind='analyze' then 'analyze' else 'gap_turn' end) then
      return jsonb_build_object('outcome','legacy_key');
    end if;
    return null;
  end if;
  if o.input_hash <> p_hash then return jsonb_build_object('outcome','conflict'); end if;
  if o.status='completed' and o.kind='analyze' and (not exists(select 1 from public.analyses where id=(o.result->>'analysisId')::uuid and user_id=auth.uid()) or not exists(select 1 from public.plans where id=(o.result->>'planId')::uuid and analysis_id=(o.result->>'analysisId')::uuid and user_id=auth.uid())) then return jsonb_build_object('outcome','unavailable'); end if;
  if o.status = 'completed' then return jsonb_build_object('outcome','completed','result',o.result); end if;
  return jsonb_build_object('outcome','pending','context',o.context,'checkpoint',o.checkpoint);
end $$;

create or replace function public.claim_career_operation(
  p_kind text, p_key text, p_hash text, p_context jsonb,
  p_investigation_id uuid default null, p_content text default null, p_question_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := auth.uid(); o public.career_ai_operations%rowtype;
  inv public.gap_investigations%rowtype; last_turn public.gap_investigation_turns%rowtype;
  q uuid; k text; token uuid := gen_random_uuid(); r record; idx int; newly_created boolean := false;
begin
  if u is null then raise exception 'Unauthorized' using errcode = '42501'; end if;
  if p_kind not in ('analyze','gap_kickoff','gap_turn') or p_hash is null then raise exception 'Invalid operation'; end if;
  if p_key is not null and (length(p_key) < 1 or length(p_key) > 200) then raise exception 'Invalid idempotency key'; end if;
  -- Short per-user transaction lock. No lock spans an OpenAI call.
  perform pg_advisory_xact_lock(hashtextextended(u::text,47));
  if p_key is not null then
    select * into o from public.career_ai_operations where user_id=u and kind=p_kind and request_key=p_key for update;
    if found and (o.input_hash <> p_hash or (o.investigation_id is distinct from p_investigation_id or (p_question_id is not null and o.question_id is distinct from p_question_id)) and p_kind='gap_turn') then
      return jsonb_build_object('outcome','conflict');
    end if;
    if found and o.status='completed' then return public.lookup_career_operation(p_kind,p_key,p_hash); end if;
    if o.id is null and exists(select 1 from public.rate_limit_events where user_id=u and idempotency_key=p_key and bucket=case when p_kind='analyze' then 'analyze' else 'gap_turn' end) then
      return jsonb_build_object('outcome','legacy_key');
    end if;
  end if;

  if p_kind='gap_turn' then
    select * into inv from public.gap_investigations where id=p_investigation_id and user_id=u for update;
    if not found then return jsonb_build_object('outcome','not_found'); end if;
    if o.id is null then
      -- A pending operation wins even when a retry uses a different key.
      select * into o from public.career_ai_operations where investigation_id=inv.id and kind='gap_turn' and status<>'completed' for update;
      if found and (o.input_hash <> p_hash or (p_question_id is not null and o.question_id <> p_question_id)) then
        return jsonb_build_object('outcome','conflict');
      end if;
    end if;
    if o.id is null then
      select * into last_turn from public.gap_investigation_turns where investigation_id=inv.id order by turn_index desc limit 1;
      if last_turn.id is null then return jsonb_build_object('outcome','conflict'); end if;
      if last_turn.role='user' then
        if last_turn.content <> p_content then return jsonb_build_object('outcome','conflict'); end if;
        -- Adopt a pre-migration pending answer without inserting it again.
        select id into q from public.gap_investigation_turns where investigation_id=inv.id and role='assistant' and turn_index<last_turn.turn_index order by turn_index desc limit 1;
      else q := last_turn.id;
      end if;
      if p_question_id is not null then
        -- An older question can replay its completed exchange; it cannot start new work.
        select * into o from public.career_ai_operations where investigation_id=inv.id and question_id=p_question_id and kind='gap_turn';
        if found then
          if o.input_hash <> p_hash then return jsonb_build_object('outcome','conflict'); end if;
          if o.status='completed' then return jsonb_build_object('outcome','completed','result',o.result); end if;
        elsif q is distinct from p_question_id then return jsonb_build_object('outcome','conflict'); end if;
      end if;
      if q is null then return jsonb_build_object('outcome','conflict'); end if;
      if inv.status <> 'active' then return jsonb_build_object('outcome','inactive'); end if;
      if p_content is null or length(btrim(p_content))=0 then raise exception 'Answer required'; end if;
      k := coalesce(p_key,'legacy:'||q::text);
      insert into public.career_ai_operations(user_id,kind,request_key,input_hash,context,investigation_id,question_id,user_turn_id)
      values(u,p_kind,k,p_hash,'{}',inv.id,q,case when last_turn.role='user' then last_turn.id else null end) returning * into o;
      if o.user_turn_id is null then
        select coalesce(max(turn_index),-1)+1 into idx from public.gap_investigation_turns where investigation_id=inv.id;
        insert into public.gap_investigation_turns(investigation_id,user_id,role,content,turn_index)
          values(inv.id,u,'user',p_content,idx) returning id into o.user_turn_id;
        update public.career_ai_operations set user_turn_id=o.user_turn_id where id=o.id;
      end if;
    end if;
    if inv.status <> 'active' then return jsonb_build_object('outcome','inactive'); end if;
  elsif o.id is null then
    -- Validate frozen references even though the route already authorizes them.
    if not exists(select 1 from public.career_profiles where id=(p_context->>'career_profile_id')::uuid and user_id=u) then
      raise exception 'Profile not owned' using errcode='42501';
    end if;
    if p_context->'resume' is not null and p_context->'resume' <> 'null'::jsonb and not exists(
      select 1 from public.resumes where id=(p_context->'resume'->>'id')::uuid and user_id=u and career_profile_id=(p_context->>'career_profile_id')::uuid
    ) then raise exception 'Resume not owned' using errcode='42501'; end if;
    if p_kind='analyze' and ((p_context->>'career_goal_id' is null) <> (p_context->>'job_description_id' is null)) then raise exception 'Goal and job required together'; end if;
    if p_kind='analyze' and p_context->>'career_goal_id' is not null and not exists(
      select 1 from public.career_goals g join public.job_descriptions j on j.career_goal_id=g.id
      where g.id=(p_context->>'career_goal_id')::uuid and j.id=(p_context->>'job_description_id')::uuid
        and g.user_id=u and j.user_id=u and g.career_profile_id=(p_context->>'career_profile_id')::uuid and j.career_profile_id=g.career_profile_id
    ) then raise exception 'Target job not owned' using errcode='42501'; end if;
    if p_context->'resume' is not null and p_context->'resume' <> 'null'::jsonb then
      p_context := jsonb_set(p_context,'{resume}',(select to_jsonb(owned_resume) from public.resumes owned_resume where owned_resume.id=(p_context->'resume'->>'id')::uuid and owned_resume.user_id=u));
    end if;
    if p_kind='gap_kickoff' and not exists(select 1 from public.gaps g join public.analyses a on a.id=g.analysis_id where g.id=(p_context->>'seed_gap_id')::uuid and a.id=(p_context->>'seed_analysis_id')::uuid and g.user_id=u and a.user_id=u and a.career_profile_id=(p_context->>'career_profile_id')::uuid) then
      raise exception 'Gap not owned' using errcode='42501';
    end if;
    insert into public.career_ai_operations(user_id,kind,request_key,input_hash,context)
      values(u,p_kind,coalesce(p_key,gen_random_uuid()::text),p_hash,p_context) returning * into o;
    newly_created := true;
  end if;
  if o.status='running' and o.lease_until > clock_timestamp() then return jsonb_build_object('outcome','in_progress'); end if;
  -- Saved output = persistence-only retry. Reuse the original reservation.
  -- No saved output = new provider attempt, including after an expired lease.
  if o.checkpoint is null and p_kind='analyze' and (select count(*) from public.analyses where user_id=u)>=100 then
    if newly_created then delete from public.career_ai_operations where id=o.id; end if;
    return jsonb_build_object('outcome','free_limited');
  end if;
  if o.checkpoint is null then
    if o.event_id is not null then perform public.fail_rate_limit(o.event_id,u); end if;
    select * into r from public.try_consume_rate_limit(u,case when p_kind='analyze' then 'analyze' else 'gap_turn' end,case when p_kind='analyze' then 5 else 10 end,o.id::text||':'||token::text);
    if r.outcome='rate_limited' then
      -- No answer to preserve for an unstarted analysis/kickoff. Avoid
      -- retaining arbitrary payloads from repeated quota-denied requests.
      if newly_created then delete from public.career_ai_operations where id=o.id;
      else
      update public.career_ai_operations set status='pending',attempt_token=null,lease_until=null,event_id=null,updated_at=now() where id=o.id;
      end if;
      return jsonb_build_object('outcome','rate_limited','quota',to_jsonb(r));
    end if;
    o.event_id := r.event_id;
  end if;
  update public.career_ai_operations set status='running',attempt_token=token,lease_until=clock_timestamp()+interval '5 minutes',event_id=o.event_id,updated_at=now() where id=o.id;
  return jsonb_build_object('outcome','claimed','id',o.id,'token',token,'context',o.context,'checkpoint',o.checkpoint,'investigation_id',o.investigation_id,'user_turn_id',o.user_turn_id,'quota',jsonb_build_object('quota_limit',case when p_kind='analyze' then 5 else 10 end,'used',(select count(*) from public.rate_limit_events where user_id=u and bucket=case when p_kind='analyze' then 'analyze' else 'gap_turn' end and created_at>now()-interval '60 minutes' and status<>'refunded'),'retry_after_seconds',0));
end $$;

create or replace function public.checkpoint_career_operation(p_id uuid,p_token uuid,p_output jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
  update public.career_ai_operations set checkpoint=p_output,lease_until=clock_timestamp()+interval '5 minutes',updated_at=now()
    where id=p_id and user_id=auth.uid() and status='running' and attempt_token=p_token and lease_until>clock_timestamp();
  if not found then raise exception 'Operation lease lost' using errcode='40001'; end if;
end $$;

create or replace function public.release_career_operation(p_id uuid,p_token uuid,p_transient boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.career_ai_operations%rowtype;
begin
  if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,47));
  select * into o from public.career_ai_operations where id=p_id and user_id=auth.uid() and status='running' and attempt_token=p_token for update;
  if not found then return; end if; -- A stale worker must not refund a newer attempt.
  if o.checkpoint is null then
    if p_transient then perform public.refund_rate_limit(o.event_id,o.user_id);
    else perform public.fail_rate_limit(o.event_id,o.user_id); end if;
  end if;
  update public.career_ai_operations set status='pending',attempt_token=null,lease_until=null,event_id=case when checkpoint is null then null else event_id end,updated_at=now() where id=o.id;
end $$;

create or replace function public.finalize_career_analysis(p_id uuid,p_token uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.career_ai_operations%rowtype; a uuid; plan uuid; item jsonb; answer jsonb; u uuid:=auth.uid();
begin
  if u is null then raise exception 'Unauthorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,47));
  select * into o from public.career_ai_operations where id=p_id and user_id=u for update;
  if not found or o.kind<>'analyze' then raise exception 'Operation not found'; end if;
  if o.status='completed' then return o.result; end if;
  if o.attempt_token is distinct from p_token or o.status<>'running' or o.lease_until<=clock_timestamp() or o.checkpoint is null then raise exception 'Operation lease lost' using errcode='40001'; end if;
  if (select count(*) from public.analyses where user_id=u)>=100 then raise exception 'Free limit reached'; end if;
  if not exists(select 1 from public.career_profiles where id=(o.context->>'career_profile_id')::uuid and user_id=u) then raise exception 'Profile not owned' using errcode='42501'; end if;
  insert into public.analyses(user_id,analysis_type,model_name,raw_json,summary,status,career_profile_id,career_goal_id,job_description_id,resume_id)
    values(u,'initial_onboarding','gpt-4.1',o.checkpoint,o.checkpoint->>'positioning_summary','completed',(o.context->>'career_profile_id')::uuid,(o.context->>'career_goal_id')::uuid,(o.context->>'job_description_id')::uuid,(o.context->'resume'->>'id')::uuid) returning id into a;
  for item in select value from jsonb_array_elements(p_rows->'signals') loop
    insert into public.signal_assessments(analysis_id,user_id,signal_code,signal_name,score,rationale,evidence,risk_level)
      select a,u,r.signal_code,r.signal_name,r.score,r.rationale,r.evidence,r.risk_level from jsonb_populate_record(null::public.signal_assessments,item) r;
  end loop;
  for item in select value from jsonb_array_elements(p_rows->'gaps') loop
    insert into public.gaps(analysis_id,user_id,gap_code,gap_title,gap_description,priority,recommended_fix)
      values(a,u,item->>'gap_code',item->>'gap_title',item->>'gap_description',(item->>'priority')::int,item->>'recommended_fix');
  end loop;
  insert into public.plans(user_id,analysis_id,plan_type,next_best_action) values(u,a,'initial',o.checkpoint->'plan'->>'next_best_action') returning id into plan;
  for item in select value from jsonb_array_elements(p_rows->'tasks') loop
    insert into public.plan_tasks(plan_id,user_id,title,description,priority,task_type,status)
      values(plan,u,item->>'title',item->>'description',(item->>'priority')::int,item->>'task_type','not_started');
  end loop;
  answer:=jsonb_build_object('analysisId',a,'planId',plan,'result',o.checkpoint);
  update public.career_ai_operations set status='completed',result=answer,checkpoint=null,context='{}',attempt_token=null,lease_until=null,updated_at=now() where id=o.id;
  if not public.complete_rate_limit(o.event_id,u,a::text) then raise exception 'Quota reservation state changed'; end if;
  return answer;
end $$;

create or replace function public.finalize_career_gap(p_id uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.career_ai_operations%rowtype; inv public.gap_investigations%rowtype;
  output jsonb; ev jsonb; origin uuid; transcript_ids uuid[]; transcript_roles text[]; n int; idx int; assistant uuid; answer jsonb; u uuid:=auth.uid();
begin
  if u is null then raise exception 'Unauthorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,47));
  select * into o from public.career_ai_operations where id=p_id and user_id=u for update;
  if not found or o.kind not in ('gap_kickoff','gap_turn') then raise exception 'Operation not found'; end if;
  if o.status='completed' then return o.result; end if;
  if o.attempt_token is distinct from p_token or o.status<>'running' or o.lease_until<=clock_timestamp() or o.checkpoint is null then raise exception 'Operation lease lost' using errcode='40001'; end if;
  output:=o.checkpoint->'agent';
  if o.kind='gap_kickoff' then
    insert into public.gap_investigations(user_id,career_profile_id,seed_gap_id,seed_analysis_id,gap_code,context_snapshot,status,model_name,openai_resume_file_id,turn_count)
      values(u,(o.context->>'career_profile_id')::uuid,(o.context->>'seed_gap_id')::uuid,(o.context->>'seed_analysis_id')::uuid,o.context->>'gap_code',o.context->'snapshot','active','gpt-4.1',o.checkpoint->>'file_id',0) returning * into inv;
    transcript_ids:='{}'; transcript_roles:='{}'; idx:=0;
  else
    select * into inv from public.gap_investigations where id=o.investigation_id and user_id=u for update;
    if not found or inv.status<>'active' then raise exception 'Investigation is no longer active'; end if;
    select array_agg(id order by turn_index),array_agg(role order by turn_index),coalesce(max(turn_index),-1)+1
      into transcript_ids,transcript_roles,idx from public.gap_investigation_turns where investigation_id=inv.id;
    if transcript_ids[array_length(transcript_ids,1)] is distinct from o.user_turn_id then raise exception 'Transcript changed'; end if;
  end if;
  insert into public.gap_investigation_turns(investigation_id,user_id,role,content,structured,turn_index)
    values(inv.id,u,'assistant',case when output->>'action'='ask_question' then output->>'next_question' else coalesce(nullif(output->'conclusion'->>'summary',''),'(investigation concluded)') end,output,idx) returning id into assistant;
  for ev in select value from jsonb_array_elements(coalesce(output->'candidate_evidence','[]')) loop
    if length(btrim(coalesce(ev->>'claim','')))=0 then continue; end if;
    n:=(ev->>'origin_user_turn_index')::int+1; origin:=null;
    if ev->>'source_type' in ('user','inference') and n between 1 and coalesce(array_length(transcript_ids,1),0) and transcript_roles[n]='user' then origin:=transcript_ids[n]; end if;
    insert into public.gap_investigation_evidence(investigation_id,user_id,origin_turn_id,source_type,claim,resume_excerpt,dimensions,evidence_level,user_status)
      values(inv.id,u,origin,ev->>'source_type',btrim(ev->>'claim'),nullif(btrim(ev->>'resume_excerpt'),''),ev->'dimensions',ev->>'evidence_level','pending');
  end loop;
  select count(*) into n from public.gap_investigation_turns where investigation_id=inv.id and role='user';
  update public.gap_investigations set turn_count=n,updated_at=now(),
    status=case when output->>'action'='stop_and_conclude' then 'concluded' else status end,
    conclusion=case when output->>'action'='stop_and_conclude' then output->'conclusion'->>'classification' else conclusion end,
    conclusion_summary=case when output->>'action'='stop_and_conclude' then output->'conclusion'->>'summary' else conclusion_summary end,
    remaining_uncertainty=case when output->>'action'='stop_and_conclude' then output->'conclusion'->>'remaining_uncertainty' else remaining_uncertainty end,
    underlying_capability=case when output->>'action'='stop_and_conclude' then output->'conclusion'->>'underlying_capability' else underlying_capability end,
    resume_evidence=case when output->>'action'='stop_and_conclude' then output->'conclusion'->>'resume_evidence' else resume_evidence end,
    target_role_fit=case when output->>'action'='stop_and_conclude' then output->'conclusion'->>'target_role_fit' else target_role_fit end,
    residual_gap=case when output->>'action'='stop_and_conclude' then output->'conclusion'->>'residual_gap' else residual_gap end where id=inv.id;
  answer:=jsonb_build_object('investigation_id',inv.id);
  update public.career_ai_operations set investigation_id=inv.id,status='completed',result=answer,checkpoint=null,context='{}',attempt_token=null,lease_until=null,updated_at=now() where id=o.id;
  if not public.complete_rate_limit(o.event_id,u,inv.id::text) then raise exception 'Quota reservation state changed'; end if;
  return answer;
end $$;

revoke all on function public.lookup_career_operation(text,text,text) from public,anon;
revoke all on function public.claim_career_operation(text,text,text,jsonb,uuid,text,uuid) from public,anon;
revoke all on function public.checkpoint_career_operation(uuid,uuid,jsonb) from public,anon;
revoke all on function public.release_career_operation(uuid,uuid,boolean) from public,anon;
revoke all on function public.finalize_career_analysis(uuid,uuid,jsonb) from public,anon;
revoke all on function public.finalize_career_gap(uuid,uuid) from public,anon;
grant execute on function public.lookup_career_operation(text,text,text) to authenticated;
grant execute on function public.claim_career_operation(text,text,text,jsonb,uuid,text,uuid) to authenticated;
grant execute on function public.checkpoint_career_operation(uuid,uuid,jsonb) to authenticated;
grant execute on function public.release_career_operation(uuid,uuid,boolean) to authenticated;
grant execute on function public.finalize_career_analysis(uuid,uuid,jsonb) to authenticated;
grant execute on function public.finalize_career_gap(uuid,uuid) to authenticated;
commit;
