-- TEST FIXTURE ONLY. The repository's initial schema migration is empty.
-- These minimal base tables model the columns used by the production routes;
-- they are not a recovered dump of the deployed database.
create schema auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,public to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table public.profiles(id uuid primary key references auth.users(id));
create table public.resumes(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id),file_path text,file_name text,mime_type text,created_at timestamptz default now());
create table public.career_goals(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id),target_level text,target_function text);
create table public.job_descriptions(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id),career_goal_id uuid references public.career_goals(id),jd_text text,role_title text);
create table public.analyses(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id),analysis_type text,model_name text,raw_json jsonb,summary text,status text,career_goal_id uuid references public.career_goals(id),job_description_id uuid references public.job_descriptions(id),resume_id uuid references public.resumes(id));
create table public.signal_assessments(id uuid primary key default gen_random_uuid(),analysis_id uuid references public.analyses(id),user_id uuid references public.profiles(id),signal_name text,score int check(score between 1 and 5),rationale text,evidence jsonb,risk_level text);
create table public.gaps(id uuid primary key default gen_random_uuid(),analysis_id uuid references public.analyses(id),user_id uuid references public.profiles(id),gap_title text,gap_description text,priority int check(priority between 1 and 5),recommended_fix text);
create table public.plans(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id),analysis_id uuid references public.analyses(id),plan_type text,next_best_action text);
create table public.plan_tasks(id uuid primary key default gen_random_uuid(),plan_id uuid references public.plans(id),user_id uuid references public.profiles(id),title text,description text,priority int check(priority between 1 and 5),task_type text,status text);
-- Representative RLS on pre-existing tables (new migration policies tested separately).
do $$ declare t text; begin
  foreach t in array array['resumes','career_goals','job_descriptions','analyses','signal_assessments','gaps','plans','plan_tasks'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy own_rows on public.%I for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id)',t);
  end loop;
end $$;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
