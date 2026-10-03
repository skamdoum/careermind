-- Gap Investigation Agent — V1.0 schema.
-- Additive only, idempotent, safe on populated DBs. No data loss.

begin;

-- 1. gap_investigations
--    One row per investigation. Investigations originate from a specific
--    gap on a specific analysis and preserve that context — the same
--    gap_code across different analyses/target roles is NOT collapsed.
create table if not exists public.gap_investigations (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles(id) on delete cascade,
  career_profile_id      uuid not null references public.career_profiles(id) on delete cascade,
  seed_gap_id            uuid references public.gaps(id) on delete set null,
  seed_analysis_id       uuid references public.analyses(id) on delete set null,
  gap_code               text,
  context_snapshot       jsonb not null default '{}'::jsonb,
  status                 text not null default 'active'
                           check (status in ('active','concluded','abandoned')),
  conclusion             text
                           check (conclusion in ('evidence_gap','partial_evidence','capability_gap')),
  conclusion_summary     text,
  remaining_uncertainty  text,
  model_name             text,
  openai_resume_file_id  text,
  turn_count             int not null default 0
                           check (turn_count >= 0 and turn_count <= 200),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists gap_investigations_user_id_idx
  on public.gap_investigations (user_id);
create index if not exists gap_investigations_career_profile_id_idx
  on public.gap_investigations (career_profile_id);
create index if not exists gap_investigations_seed_gap_id_idx
  on public.gap_investigations (seed_gap_id);
create index if not exists gap_investigations_gap_code_idx
  on public.gap_investigations (gap_code);

alter table public.gap_investigations enable row level security;

drop policy if exists "own_select" on public.gap_investigations;
drop policy if exists "own_insert" on public.gap_investigations;
drop policy if exists "own_update" on public.gap_investigations;
drop policy if exists "own_delete" on public.gap_investigations;

create policy "own_select" on public.gap_investigations
  for select using (auth.uid() = user_id);
create policy "own_insert" on public.gap_investigations
  for insert with check (auth.uid() = user_id);
create policy "own_update" on public.gap_investigations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.gap_investigations
  for delete using (auth.uid() = user_id);

-- 2. gap_investigation_turns
--    Append-only conversation log. `structured` on assistant turns is the
--    full model output JSON — doubles as the trajectory log for later eval.
create table if not exists public.gap_investigation_turns (
  id                uuid primary key default gen_random_uuid(),
  investigation_id  uuid not null references public.gap_investigations(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  role              text not null check (role in ('assistant','user')),
  content           text not null,
  structured        jsonb,
  turn_index        int not null check (turn_index >= 0),
  created_at        timestamptz not null default now()
);

create index if not exists gap_investigation_turns_investigation_idx
  on public.gap_investigation_turns (investigation_id, turn_index);
create index if not exists gap_investigation_turns_user_id_idx
  on public.gap_investigation_turns (user_id);

alter table public.gap_investigation_turns enable row level security;

drop policy if exists "own_select" on public.gap_investigation_turns;
drop policy if exists "own_insert" on public.gap_investigation_turns;
drop policy if exists "own_update" on public.gap_investigation_turns;
drop policy if exists "own_delete" on public.gap_investigation_turns;

create policy "own_select" on public.gap_investigation_turns
  for select using (auth.uid() = user_id);
create policy "own_insert" on public.gap_investigation_turns
  for insert with check (auth.uid() = user_id);
create policy "own_update" on public.gap_investigation_turns
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.gap_investigation_turns
  for delete using (auth.uid() = user_id);

-- 3. gap_investigation_evidence
--    Candidate evidence claims extracted by the agent. Provenance is
--    explicit via source_type. Only user_status in ('confirmed','edited')
--    is treated as validated evidence downstream.
create table if not exists public.gap_investigation_evidence (
  id                uuid primary key default gen_random_uuid(),
  investigation_id  uuid not null references public.gap_investigations(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  origin_turn_id    uuid references public.gap_investigation_turns(id) on delete set null,
  source_type       text not null check (source_type in ('resume','user','inference')),
  claim             text not null,
  resume_excerpt    text,
  dimensions        jsonb,
  evidence_level    text check (evidence_level in ('direct','supporting','adjacent','none')),
  user_status       text not null default 'pending'
                      check (user_status in ('pending','confirmed','edited','rejected')),
  user_edit         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists gap_investigation_evidence_investigation_idx
  on public.gap_investigation_evidence (investigation_id);
create index if not exists gap_investigation_evidence_user_id_idx
  on public.gap_investigation_evidence (user_id);

alter table public.gap_investigation_evidence enable row level security;

drop policy if exists "own_select" on public.gap_investigation_evidence;
drop policy if exists "own_insert" on public.gap_investigation_evidence;
drop policy if exists "own_update" on public.gap_investigation_evidence;
drop policy if exists "own_delete" on public.gap_investigation_evidence;

create policy "own_select" on public.gap_investigation_evidence
  for select using (auth.uid() = user_id);
create policy "own_insert" on public.gap_investigation_evidence
  for insert with check (auth.uid() = user_id);
create policy "own_update" on public.gap_investigation_evidence
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.gap_investigation_evidence
  for delete using (auth.uid() = user_id);

commit;
