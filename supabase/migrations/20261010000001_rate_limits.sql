-- Rate-limit infrastructure for OpenAI-backed routes.
-- Three independent per-user hourly buckets with atomic reservation,
-- transaction-scoped idempotency, and explicit status tracking so
-- repeated requests with the same idempotency key cannot trigger a
-- duplicate OpenAI generation.
--
-- Design:
--   * One row per reservation attempt. row_count within the last 60 min
--     per (user_id, bucket) = used quota.
--   * Idempotency: unique index on (user_id, bucket, idempotency_key)
--     plus idempotency check held inside the advisory-lock-serialized
--     reservation body. Reservation and lookup happen in one atomic
--     function call.
--   * status transitions:
--       in_progress  → completed    (route marked success, stores result_ref)
--       in_progress  → failed       (route marked permanent failure; quota consumed)
--       in_progress  → refunded     (route marked transient OpenAI failure; excluded from quota)
--     An idempotency replay returning status='in_progress' tells the
--     caller a prior request is still in flight — return 409 to the
--     client; do NOT invoke OpenAI again.
--
-- Secrets: none. This migration contains no API keys, no cron secrets,
-- no credentials. Scheduling and credential wiring happen outside SQL.

begin;

create table if not exists public.rate_limit_events (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  bucket             text not null
                       check (bucket in ('analyze','gap_turn','narrative_uncached')),
  idempotency_key    text,
  status             text not null default 'in_progress'
                       check (status in ('in_progress','completed','failed','refunded')),
  result_ref         text,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);

-- Count queries: (user_id, bucket, created_at)
create index if not exists rate_limit_events_user_bucket_time
  on public.rate_limit_events (user_id, bucket, created_at desc);

-- Idempotency: only unique when a key is present. Partial unique index
-- so NULL keys don't collide with each other.
create unique index if not exists rate_limit_events_idempotency_unique
  on public.rate_limit_events (user_id, bucket, idempotency_key)
  where idempotency_key is not null;

alter table public.rate_limit_events enable row level security;

-- No user-facing policies. All writes go through service role from the
-- server. RLS enabled so a leaked anon key cannot read other users'
-- usage.
drop policy if exists "own_select" on public.rate_limit_events;
create policy "own_select" on public.rate_limit_events
  for select using (auth.uid() = user_id);

-- -----------------------------------------------------------------
-- Reservation function.
--
-- Returns:
--   outcome              text   -- 'reserved' | 'duplicate_in_progress' | 'duplicate_completed'
--                               -- | 'duplicate_failed' | 'duplicate_refunded' | 'rate_limited'
--   event_id             uuid
--   result_ref           text   -- populated on duplicate_completed; null otherwise
--   used                 int    -- rolling-window used count (post-reservation when reserved)
--   quota_limit          int
--   retry_after_seconds  int    -- non-zero when rate_limited
--
-- Concurrency: pg_advisory_xact_lock serializes concurrent callers on
-- the same (user_id, bucket). Idempotency lookup happens inside the
-- locked section, before the count+insert.
-- -----------------------------------------------------------------

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

-- Idempotent completion. Marks the reservation 'completed' and stores
-- an optional pointer to the resulting artifact (e.g., analyses.id).
create or replace function public.complete_rate_limit(
  p_event_id    uuid,
  p_user_id     uuid,
  p_result_ref  text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_updated int;
begin
  update rate_limit_events
     set status = 'completed',
         result_ref = coalesce(p_result_ref, result_ref),
         completed_at = now()
   where id = p_event_id
     and user_id = p_user_id
     and status = 'in_progress';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Idempotent failure marker. Keeps the reservation counted toward the
-- quota (permanent/app-side failure). Callers must distinguish this
-- from transient OpenAI 5xx (which should call refund instead).
create or replace function public.fail_rate_limit(
  p_event_id  uuid,
  p_user_id   uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_updated int;
begin
  update rate_limit_events
     set status = 'failed',
         completed_at = now()
   where id = p_event_id
     and user_id = p_user_id
     and status = 'in_progress';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Idempotent refund. Reserved only for classified transient OpenAI
-- failures (5xx, timeouts, connection errors, OpenAI's own 429). Marks
-- the row refunded so it stops counting toward the user's quota. Second
-- call for the same event is a no-op.
create or replace function public.refund_rate_limit(
  p_event_id  uuid,
  p_user_id   uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_updated int;
begin
  update rate_limit_events
     set status = 'refunded',
         completed_at = now()
   where id = p_event_id
     and user_id = p_user_id
     and status in ('in_progress','failed');  -- failed→refunded is permitted; completed is not.
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- -----------------------------------------------------------------
-- Function execution privileges.
--
-- These functions run with SECURITY DEFINER (as the function owner).
-- By default Postgres grants EXECUTE to PUBLIC, which would let the
-- anon and authenticated roles call them with any user_id. That is
-- unacceptable: anon could insert quota rows against arbitrary users
-- or drain another user's quota.
--
-- Lock EXECUTE to service_role only. The server routes call these via
-- supabaseAdmin (service_role). The client/anon roles cannot invoke
-- them. SELECT on rate_limit_events via the own_select policy remains
-- available so a future "my usage" UI can read a user's own quota.
-- -----------------------------------------------------------------
revoke all on function public.try_consume_rate_limit(uuid, text, int, text) from public;
revoke all on function public.complete_rate_limit(uuid, uuid, text)         from public;
revoke all on function public.fail_rate_limit(uuid, uuid)                   from public;
revoke all on function public.refund_rate_limit(uuid, uuid)                 from public;

grant execute on function public.try_consume_rate_limit(uuid, text, int, text) to service_role;
grant execute on function public.complete_rate_limit(uuid, uuid, text)         to service_role;
grant execute on function public.fail_rate_limit(uuid, uuid)                   to service_role;
grant execute on function public.refund_rate_limit(uuid, uuid)                 to service_role;

commit;
