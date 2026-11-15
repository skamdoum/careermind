-- Phase 1 model support only. CREATE OR REPLACE preserves existing grants.
-- Sources: https://developers.openai.com/api/docs/models/gpt-6-luna
-- https://developers.openai.com/api/docs/models/gpt-6-sol
begin;
create or replace function public.ai_usage_step(p_id uuid,p_owner uuid,p_action text,p_key text,p_value jsonb default 'null')
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
      or coalesce(p_value->>'model','') not in ('gpt-4.1','gpt-4.1-2025-04-14','gpt-6-luna','gpt-6-sol') then raise exception 'Unreliable usage receipt'; end if;
    -- Standard short-context USD per 1M tokens, verified 2026-11-15:
    -- Luna 0.10/0.50; Sol 2/10. Round up to integer micro-USD.
    -- Keep existing conservative uncached accounting and policy ceilings.
    cost := ceil(case p_value->>'model'
      when 'gpt-6-luna' then (p_value->'usage'->>'input_tokens')::numeric*0.1+(p_value->'usage'->>'output_tokens')::numeric*0.5
      when 'gpt-6-sol' then (p_value->'usage'->>'input_tokens')::numeric*2+(p_value->'usage'->>'output_tokens')::numeric*10
      else (p_value->'usage'->>'input_tokens')::bigint*2+(p_value->'usage'->>'output_tokens')::bigint*8
    end)::bigint;
    if cost<0 or cost>o.ceiling then raise exception 'Usage exceeds policy ceiling'; end if;
    update public.ai_usage_buckets set spent=spent+cost,reserved=reserved-o.ceiling where day=o.day and subject='app' and category='budget';
    update public.ai_usage_operations set call_pending=false,remaining=remaining-o.ceiling where id=p_id;
  elsif p_action <> 'save' then raise exception 'Invalid operation step'; end if;
  update public.ai_usage_operations set steps=steps||jsonb_build_object(p_key,p_value),updated_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes' where id=p_id;
  return p_value;
end $$;

commit;
