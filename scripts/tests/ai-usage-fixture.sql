-- Disposable local test fixture, captured from hosted PostgreSQL 17.6 catalogs on 2026-11-03.
-- Reproduces the 13 relevant public tables: physical columns, defaults, NOT NULL,
-- CHECK/FK/PK constraints, indexes, RLS policies, and effective table grants.
-- No user rows. auth.users is an ID-only FK stub; auth.uid() reads a synthetic JWT.
-- Hosted extension/DDL event triggers and the Auth/Storage services are not emulated.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
grant usage on schema public,auth to anon,authenticated,service_role;
grant create on schema public to service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table auth.users(id uuid primary key);
create table public.profiles (
  id uuid not null,
  full_name text,
  email text,
  target_role text,
  target_level text,
  target_timeline text,
  preferred_locations text[],
  target_companies text[],
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  active_career_profile_id uuid
);
create table public.career_profiles (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  description text,
  is_default boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
create table public.resumes (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  file_path text not null,
  file_name text not null,
  mime_type text,
  parsed_text text,
  is_primary boolean not null default true,
  version integer not null default 1,
  created_at timestamp with time zone not null default now(),
  career_profile_id uuid
);
create table public.job_descriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  company_name text,
  role_title text,
  source_url text,
  jd_text text not null,
  status text not null default 'target'::text,
  created_at timestamp with time zone not null default now(),
  career_goal_id uuid,
  career_profile_id uuid
);
create table public.career_goals (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  target_level text,
  target_function text,
  status text not null default 'active'::text,
  primary_resume_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  career_profile_id uuid,
  description text
);
create table public.analyses (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  resume_id uuid,
  job_description_id uuid,
  analysis_type text not null,
  model_name text,
  status text not null default 'completed'::text,
  raw_json jsonb not null,
  summary text,
  created_at timestamp with time zone not null default now(),
  career_goal_id uuid,
  career_profile_id uuid
);
create table public.signal_assessments (
  id uuid not null default gen_random_uuid(),
  analysis_id uuid not null,
  user_id uuid not null,
  signal_name text not null,
  score integer not null,
  rationale text,
  evidence text[],
  risk_level text,
  created_at timestamp with time zone not null default now(),
  signal_code text
);
create table public.gaps (
  id uuid not null default gen_random_uuid(),
  analysis_id uuid not null,
  user_id uuid not null,
  gap_title text not null,
  gap_description text not null,
  priority integer not null,
  recommended_fix text,
  created_at timestamp with time zone not null default now(),
  gap_code text
);
create table public.plans (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  analysis_id uuid,
  plan_type text not null,
  start_date date,
  end_date date,
  next_best_action text not null,
  created_at timestamp with time zone not null default now()
);
create table public.plan_tasks (
  id uuid not null default gen_random_uuid(),
  plan_id uuid not null,
  user_id uuid not null,
  title text not null,
  description text,
  priority integer not null,
  status text not null default 'not_started'::text,
  due_date date,
  task_type text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
create table public.gap_investigations (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  career_profile_id uuid not null,
  seed_gap_id uuid,
  seed_analysis_id uuid,
  gap_code text,
  context_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'active'::text,
  conclusion text,
  conclusion_summary text,
  remaining_uncertainty text,
  model_name text,
  openai_resume_file_id text,
  turn_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  underlying_capability text,
  resume_evidence text,
  target_role_fit text,
  residual_gap text
);
create table public.gap_investigation_turns (
  id uuid not null default gen_random_uuid(),
  investigation_id uuid not null,
  user_id uuid not null,
  role text not null,
  content text not null,
  structured jsonb,
  turn_index integer not null,
  created_at timestamp with time zone not null default now()
);
create table public.gap_investigation_evidence (
  id uuid not null default gen_random_uuid(),
  investigation_id uuid not null,
  user_id uuid not null,
  origin_turn_id uuid,
  source_type text not null,
  claim text not null,
  resume_excerpt text,
  dimensions jsonb,
  evidence_level text,
  user_status text not null default 'pending'::text,
  user_edit text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.analyses add constraint analyses_pkey PRIMARY KEY (id);
alter table public.career_goals add constraint career_goals_pkey PRIMARY KEY (id);
alter table public.career_profiles add constraint career_profiles_pkey PRIMARY KEY (id);
alter table public.gap_investigation_evidence add constraint gap_investigation_evidence_pkey PRIMARY KEY (id);
alter table public.gap_investigation_turns add constraint gap_investigation_turns_pkey PRIMARY KEY (id);
alter table public.gap_investigations add constraint gap_investigations_pkey PRIMARY KEY (id);
alter table public.gaps add constraint gaps_pkey PRIMARY KEY (id);
alter table public.job_descriptions add constraint job_descriptions_pkey PRIMARY KEY (id);
alter table public.plan_tasks add constraint plan_tasks_pkey PRIMARY KEY (id);
alter table public.plans add constraint plans_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.resumes add constraint resumes_pkey PRIMARY KEY (id);
alter table public.signal_assessments add constraint signal_assessments_pkey PRIMARY KEY (id);
alter table public.analyses add constraint analyses_analysis_type_check CHECK ((analysis_type = ANY (ARRAY['initial_onboarding'::text, 'feedback_refresh'::text, 'weekly_refresh'::text, 'resume_optimization'::text, 'company_prep'::text])));
alter table public.analyses add constraint analyses_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'completed'::text, 'failed'::text])));
alter table public.gap_investigation_evidence add constraint gap_investigation_evidence_evidence_level_check CHECK ((evidence_level = ANY (ARRAY['direct'::text, 'supporting'::text, 'adjacent'::text, 'none'::text])));
alter table public.gap_investigation_evidence add constraint gap_investigation_evidence_source_type_check CHECK ((source_type = ANY (ARRAY['resume'::text, 'user'::text, 'inference'::text])));
alter table public.gap_investigation_evidence add constraint gap_investigation_evidence_user_status_check CHECK ((user_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'edited'::text, 'rejected'::text])));
alter table public.gap_investigation_turns add constraint gap_investigation_turns_role_check CHECK ((role = ANY (ARRAY['assistant'::text, 'user'::text])));
alter table public.gap_investigation_turns add constraint gap_investigation_turns_turn_index_check CHECK ((turn_index >= 0));
alter table public.gap_investigations add constraint gap_investigations_conclusion_check CHECK (((conclusion IS NULL) OR (conclusion = ANY (ARRAY['evidence_gap'::text, 'partial_evidence'::text, 'capability_gap'::text, 'scope_mismatch'::text]))));
alter table public.gap_investigations add constraint gap_investigations_resume_evidence_check CHECK (((resume_evidence IS NULL) OR (resume_evidence = ANY (ARRAY['demonstrates'::text, 'partial'::text, 'does_not_demonstrate'::text]))));
alter table public.gap_investigations add constraint gap_investigations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'concluded'::text, 'abandoned'::text])));
alter table public.gap_investigations add constraint gap_investigations_target_role_fit_check CHECK (((target_role_fit IS NULL) OR (target_role_fit = ANY (ARRAY['meets'::text, 'partial'::text, 'does_not_meet'::text]))));
alter table public.gap_investigations add constraint gap_investigations_turn_count_check CHECK (((turn_count >= 0) AND (turn_count <= 200)));
alter table public.gap_investigations add constraint gap_investigations_underlying_capability_check CHECK (((underlying_capability IS NULL) OR (underlying_capability = ANY (ARRAY['demonstrated'::text, 'partial'::text, 'not_demonstrated'::text]))));
alter table public.gaps add constraint gaps_priority_check CHECK (((priority >= 1) AND (priority <= 5)));
alter table public.job_descriptions add constraint job_descriptions_status_check CHECK ((status = ANY (ARRAY['target'::text, 'applied'::text, 'interviewing'::text, 'closed'::text])));
alter table public.plan_tasks add constraint plan_tasks_priority_check CHECK (((priority >= 1) AND (priority <= 5)));
alter table public.plan_tasks add constraint plan_tasks_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'done'::text])));
alter table public.plan_tasks add constraint plan_tasks_task_type_check CHECK ((task_type = ANY (ARRAY['resume'::text, 'story'::text, 'interview_prep'::text, 'application'::text, 'networking'::text, 'strategy'::text])));
alter table public.plans add constraint plans_plan_type_check CHECK ((plan_type = ANY (ARRAY['initial'::text, 'feedback_refresh'::text, 'weekly_refresh'::text])));
alter table public.profiles add constraint profiles_target_role_check CHECK ((target_role = ANY (ARRAY['PM'::text, 'TPM'::text])));
alter table public.signal_assessments add constraint signal_assessments_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])));
alter table public.signal_assessments add constraint signal_assessments_score_check CHECK (((score >= 1) AND (score <= 5)));
alter table public.analyses add constraint analyses_career_goal_id_fkey FOREIGN KEY (career_goal_id) REFERENCES career_goals(id) ON DELETE SET NULL;
alter table public.analyses add constraint analyses_career_profile_id_fkey FOREIGN KEY (career_profile_id) REFERENCES career_profiles(id) ON DELETE SET NULL;
alter table public.analyses add constraint analyses_job_description_id_fkey FOREIGN KEY (job_description_id) REFERENCES job_descriptions(id) ON DELETE SET NULL;
alter table public.analyses add constraint analyses_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE SET NULL;
alter table public.analyses add constraint analyses_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.career_goals add constraint career_goals_career_profile_id_fkey FOREIGN KEY (career_profile_id) REFERENCES career_profiles(id) ON DELETE SET NULL;
alter table public.career_goals add constraint career_goals_primary_resume_id_fkey FOREIGN KEY (primary_resume_id) REFERENCES resumes(id) ON DELETE SET NULL;
alter table public.career_goals add constraint career_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.career_profiles add constraint career_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.gap_investigation_evidence add constraint gap_investigation_evidence_investigation_id_fkey FOREIGN KEY (investigation_id) REFERENCES gap_investigations(id) ON DELETE CASCADE;
alter table public.gap_investigation_evidence add constraint gap_investigation_evidence_origin_turn_id_fkey FOREIGN KEY (origin_turn_id) REFERENCES gap_investigation_turns(id) ON DELETE SET NULL;
alter table public.gap_investigation_evidence add constraint gap_investigation_evidence_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.gap_investigation_turns add constraint gap_investigation_turns_investigation_id_fkey FOREIGN KEY (investigation_id) REFERENCES gap_investigations(id) ON DELETE CASCADE;
alter table public.gap_investigation_turns add constraint gap_investigation_turns_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.gap_investigations add constraint gap_investigations_career_profile_id_fkey FOREIGN KEY (career_profile_id) REFERENCES career_profiles(id) ON DELETE CASCADE;
alter table public.gap_investigations add constraint gap_investigations_seed_analysis_id_fkey FOREIGN KEY (seed_analysis_id) REFERENCES analyses(id) ON DELETE SET NULL;
alter table public.gap_investigations add constraint gap_investigations_seed_gap_id_fkey FOREIGN KEY (seed_gap_id) REFERENCES gaps(id) ON DELETE SET NULL;
alter table public.gap_investigations add constraint gap_investigations_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.gaps add constraint gaps_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE;
alter table public.gaps add constraint gaps_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.job_descriptions add constraint job_descriptions_career_goal_id_fkey FOREIGN KEY (career_goal_id) REFERENCES career_goals(id) ON DELETE SET NULL;
alter table public.job_descriptions add constraint job_descriptions_career_profile_id_fkey FOREIGN KEY (career_profile_id) REFERENCES career_profiles(id) ON DELETE SET NULL;
alter table public.job_descriptions add constraint job_descriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.plan_tasks add constraint plan_tasks_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE;
alter table public.plan_tasks add constraint plan_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.plans add constraint plans_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE SET NULL;
alter table public.plans add constraint plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_active_career_profile_id_fkey FOREIGN KEY (active_career_profile_id) REFERENCES career_profiles(id) ON DELETE SET NULL;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.resumes add constraint resumes_career_profile_id_fkey FOREIGN KEY (career_profile_id) REFERENCES career_profiles(id) ON DELETE SET NULL;
alter table public.resumes add constraint resumes_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.signal_assessments add constraint signal_assessments_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE;
alter table public.signal_assessments add constraint signal_assessments_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
CREATE INDEX analyses_career_profile_id_idx ON public.analyses USING btree (career_profile_id);
CREATE INDEX idx_analyses_career_goal_id ON public.analyses USING btree (career_goal_id);
CREATE INDEX career_goals_career_profile_id_idx ON public.career_goals USING btree (career_profile_id);
CREATE INDEX idx_career_goals_user_id ON public.career_goals USING btree (user_id);
CREATE UNIQUE INDEX career_profiles_one_default_per_user ON public.career_profiles USING btree (user_id) WHERE (is_default = true);
CREATE INDEX career_profiles_user_id_idx ON public.career_profiles USING btree (user_id);
CREATE INDEX gap_investigation_evidence_investigation_idx ON public.gap_investigation_evidence USING btree (investigation_id);
CREATE INDEX gap_investigation_evidence_user_id_idx ON public.gap_investigation_evidence USING btree (user_id);
CREATE INDEX gap_investigation_turns_investigation_idx ON public.gap_investigation_turns USING btree (investigation_id, turn_index);
CREATE INDEX gap_investigation_turns_user_id_idx ON public.gap_investigation_turns USING btree (user_id);
CREATE INDEX gap_investigations_career_profile_id_idx ON public.gap_investigations USING btree (career_profile_id);
CREATE INDEX gap_investigations_gap_code_idx ON public.gap_investigations USING btree (gap_code);
CREATE INDEX gap_investigations_seed_gap_id_idx ON public.gap_investigations USING btree (seed_gap_id);
CREATE INDEX gap_investigations_user_id_idx ON public.gap_investigations USING btree (user_id);
CREATE INDEX gaps_gap_code_idx ON public.gaps USING btree (gap_code);
CREATE INDEX idx_job_descriptions_career_goal_id ON public.job_descriptions USING btree (career_goal_id);
CREATE INDEX job_descriptions_career_profile_id_idx ON public.job_descriptions USING btree (career_profile_id);
CREATE INDEX resumes_career_profile_id_idx ON public.resumes USING btree (career_profile_id);
CREATE INDEX signal_assessments_signal_code_idx ON public.signal_assessments USING btree (signal_code);
alter table public.profiles enable row level security;
alter table public.career_profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.job_descriptions enable row level security;
alter table public.career_goals enable row level security;
alter table public.analyses enable row level security;
alter table public.signal_assessments enable row level security;
alter table public.gaps enable row level security;
alter table public.plans enable row level security;
alter table public.plan_tasks enable row level security;
alter table public.gap_investigations enable row level security;
alter table public.gap_investigation_turns enable row level security;
alter table public.gap_investigation_evidence enable row level security;
create policy analyses_insert_own on public.analyses as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy analyses_select_own on public.analyses as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
create policy career_goals_delete_own on public.career_goals as PERMISSIVE for DELETE to public using ((auth.uid() = user_id));
create policy career_goals_insert_own on public.career_goals as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy career_goals_select_own on public.career_goals as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
create policy career_goals_update_own on public.career_goals as PERMISSIVE for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy own_delete on public.career_profiles as PERMISSIVE for DELETE to public using ((auth.uid() = user_id));
create policy own_insert on public.career_profiles as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy own_select on public.career_profiles as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
create policy own_update on public.career_profiles as PERMISSIVE for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy own_delete on public.gap_investigation_evidence as PERMISSIVE for DELETE to public using ((auth.uid() = user_id));
create policy own_insert on public.gap_investigation_evidence as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy own_select on public.gap_investigation_evidence as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
create policy own_update on public.gap_investigation_evidence as PERMISSIVE for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy own_delete on public.gap_investigation_turns as PERMISSIVE for DELETE to public using ((auth.uid() = user_id));
create policy own_insert on public.gap_investigation_turns as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy own_select on public.gap_investigation_turns as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
create policy own_update on public.gap_investigation_turns as PERMISSIVE for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy own_delete on public.gap_investigations as PERMISSIVE for DELETE to public using ((auth.uid() = user_id));
create policy own_insert on public.gap_investigations as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy own_select on public.gap_investigations as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
create policy own_update on public.gap_investigations as PERMISSIVE for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy gaps_insert_own on public.gaps as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy gaps_select_own on public.gaps as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
create policy job_descriptions_delete_own on public.job_descriptions as PERMISSIVE for DELETE to public using ((auth.uid() = user_id));
create policy job_descriptions_insert_own on public.job_descriptions as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy job_descriptions_select_own on public.job_descriptions as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
create policy job_descriptions_update_own on public.job_descriptions as PERMISSIVE for UPDATE to public using ((auth.uid() = user_id));
create policy plan_tasks_insert_own on public.plan_tasks as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy plan_tasks_select_own on public.plan_tasks as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
create policy plan_tasks_update_own on public.plan_tasks as PERMISSIVE for UPDATE to public using ((auth.uid() = user_id));
create policy plans_insert_own on public.plans as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy plans_select_own on public.plans as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
create policy profiles_insert_own on public.profiles as PERMISSIVE for INSERT to public with check ((auth.uid() = id));
create policy profiles_select_own on public.profiles as PERMISSIVE for SELECT to public using ((auth.uid() = id));
create policy profiles_update_own on public.profiles as PERMISSIVE for UPDATE to public using ((auth.uid() = id));
create policy resumes_insert_own on public.resumes as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy resumes_select_own on public.resumes as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
create policy resumes_update_own on public.resumes as PERMISSIVE for UPDATE to public using ((auth.uid() = user_id));
create policy signal_assessments_insert_own on public.signal_assessments as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));
create policy signal_assessments_select_own on public.signal_assessments as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));
grant select,insert,update,delete,truncate,references,trigger on public.analyses to service_role;
grant select,insert,update,delete on public.analyses to anon;
grant select,insert,update,delete on public.analyses to authenticated;
grant select,insert,update,delete on public.career_goals to anon;
grant select,insert,update,delete on public.career_goals to authenticated;
grant select,insert,update,delete,truncate,references,trigger on public.career_goals to service_role;
grant select,insert,update,delete on public.career_profiles to anon;
grant select,insert,update,delete on public.career_profiles to authenticated;
grant select,insert,update,delete,truncate,references,trigger on public.career_profiles to service_role;
grant select,insert,update,delete on public.gap_investigation_evidence to anon;
grant select,insert,update,delete on public.gap_investigation_evidence to authenticated;
grant select,insert,update,delete,truncate,references,trigger on public.gap_investigation_evidence to service_role;
grant select,insert,update,delete on public.gap_investigation_turns to anon;
grant select,insert,update,delete on public.gap_investigation_turns to authenticated;
grant select,insert,update,delete,truncate,references,trigger on public.gap_investigation_turns to service_role;
grant select,insert,update,delete on public.gap_investigations to anon;
grant select,insert,update,delete on public.gap_investigations to authenticated;
grant select,insert,update,delete,truncate,references,trigger on public.gap_investigations to service_role;
grant select,insert,update,delete,truncate,references,trigger on public.gaps to service_role;
grant select,insert,update,delete on public.gaps to anon;
grant select,insert,update,delete on public.gaps to authenticated;
grant select,insert,update,delete,truncate,references,trigger on public.job_descriptions to service_role;
grant select,insert,update,delete on public.job_descriptions to anon;
grant select,insert,update,delete on public.job_descriptions to authenticated;
grant select,insert,update,delete,truncate,references,trigger on public.plan_tasks to service_role;
grant select,insert,update,delete on public.plan_tasks to anon;
grant select,insert,update,delete on public.plan_tasks to authenticated;
grant select,insert,update,delete,truncate,references,trigger on public.plans to service_role;
grant select,insert,update,delete on public.plans to anon;
grant select,insert,update,delete on public.plans to authenticated;
grant select,insert,update,delete,truncate,references,trigger on public.profiles to service_role;
grant select,insert,update,delete on public.profiles to anon;
grant select,insert,update,delete on public.profiles to authenticated;
grant select,insert,update,delete,truncate,references,trigger on public.resumes to service_role;
grant select,insert,update,delete on public.resumes to anon;
grant select,insert,update,delete on public.resumes to authenticated;
grant select,insert,update,delete,truncate,references,trigger on public.signal_assessments to service_role;
grant select,insert,update,delete on public.signal_assessments to anon;
grant select,insert,update,delete on public.signal_assessments to authenticated;
-- Mirrors postgres public-schema default ACLs; target migration must override them.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to service_role;
alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;
alter default privileges in schema public grant all on tables to service_role;
-- PG17 added MAINTAIN; preserve the inspected service-role ACL there while
-- allowing the same fixture to run on PG16, where that privilege does not exist.
do $$ begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'grant maintain on all tables in schema public to service_role';
  end if;
end $$;
