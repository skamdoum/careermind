-- Day 8.5: Multiple Career Profiles per authenticated user.
-- Additive, idempotent, and safe on populated DBs. No data loss.

begin;

-- 1. career_profiles table.
create table if not exists public.career_profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  name             text not null,
  description      text,
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- At most one default profile per user.
create unique index if not exists career_profiles_one_default_per_user
  on public.career_profiles (user_id) where is_default = true;

create index if not exists career_profiles_user_id_idx
  on public.career_profiles (user_id);

-- 2. RLS + owner policies for career_profiles.
alter table public.career_profiles enable row level security;

drop policy if exists "own_select" on public.career_profiles;
drop policy if exists "own_insert" on public.career_profiles;
drop policy if exists "own_update" on public.career_profiles;
drop policy if exists "own_delete" on public.career_profiles;

create policy "own_select" on public.career_profiles
  for select using (auth.uid() = user_id);

create policy "own_insert" on public.career_profiles
  for insert with check (auth.uid() = user_id);

create policy "own_update" on public.career_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own_delete" on public.career_profiles
  for delete using (auth.uid() = user_id);

-- 3. Add nullable career_profile_id to the four entry tables.
alter table public.resumes
  add column if not exists career_profile_id uuid
  references public.career_profiles(id) on delete set null;

alter table public.career_goals
  add column if not exists career_profile_id uuid
  references public.career_profiles(id) on delete set null;

alter table public.job_descriptions
  add column if not exists career_profile_id uuid
  references public.career_profiles(id) on delete set null;

alter table public.analyses
  add column if not exists career_profile_id uuid
  references public.career_profiles(id) on delete set null;

create index if not exists resumes_career_profile_id_idx
  on public.resumes (career_profile_id);
create index if not exists career_goals_career_profile_id_idx
  on public.career_goals (career_profile_id);
create index if not exists job_descriptions_career_profile_id_idx
  on public.job_descriptions (career_profile_id);
create index if not exists analyses_career_profile_id_idx
  on public.analyses (career_profile_id);

-- 4. Active-profile pointer on profiles.
alter table public.profiles
  add column if not exists active_career_profile_id uuid
  references public.career_profiles(id) on delete set null;

-- 5. Create one default career_profile per existing user (idempotent).
insert into public.career_profiles (user_id, name, is_default)
select p.id, 'My career direction', true
from public.profiles p
where not exists (
  select 1 from public.career_profiles cp where cp.user_id = p.id
);

-- 6. Point existing entry rows at each user's default profile.
update public.resumes r
   set career_profile_id = cp.id
  from public.career_profiles cp
 where cp.user_id = r.user_id
   and cp.is_default
   and r.career_profile_id is null;

update public.career_goals g
   set career_profile_id = cp.id
  from public.career_profiles cp
 where cp.user_id = g.user_id
   and cp.is_default
   and g.career_profile_id is null;

update public.job_descriptions j
   set career_profile_id = cp.id
  from public.career_profiles cp
 where cp.user_id = j.user_id
   and cp.is_default
   and j.career_profile_id is null;

update public.analyses a
   set career_profile_id = cp.id
  from public.career_profiles cp
 where cp.user_id = a.user_id
   and cp.is_default
   and a.career_profile_id is null;

-- 7. Set every user's active pointer to their default profile.
update public.profiles p
   set active_career_profile_id = cp.id
  from public.career_profiles cp
 where cp.user_id = p.id
   and cp.is_default
   and p.active_career_profile_id is null;

commit;
