-- Read-only. Run against an authorized staging copy before migration approval.
-- Do not infer deployed schema compatibility from the test fixture.
begin transaction read only;
select current_setting('server_version') as postgres_version;
select table_name,column_name,data_type,udt_name,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in (
  'analyses','signal_assessments','gaps','plans','plan_tasks','resumes',
  'career_goals','job_descriptions','gap_investigations','gap_investigation_turns'
) order by table_name,ordinal_position;
select conrelid::regclass as table_name,conname,pg_get_constraintdef(oid) as definition
from pg_constraint where connamespace='public'::regnamespace order by conrelid::regclass::text,conname;
-- Must be empty. The migration aborts atomically if duplicates exist.
select investigation_id,turn_index,count(*) from public.gap_investigation_turns
 group by investigation_id,turn_index having count(*)>1;
-- If Phase 2a is already installed, inspect its ledger separately:
-- select bucket,status,count(*) from public.rate_limit_events group by bucket,status;
-- Report unfinished legacy conversations for staging recovery tests.
select distinct on (investigation_id) investigation_id,role,turn_index
from public.gap_investigation_turns order by investigation_id,turn_index desc;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname in ('public','storage') order by schemaname,tablename,policyname;
select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema in ('public','storage') and grantee in ('anon','authenticated','service_role')
order by table_schema,table_name,grantee,privilege_type;
-- Privileged surface: inspect every overload, not just expected signatures.
select p.oid::regprocedure as signature,r.rolname as owner,p.prosecdef,p.proconfig,
  has_function_privilege('anon',p.oid,'execute') as anon_execute,
  has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p join pg_roles r on r.oid=p.proowner
where p.pronamespace='public'::regnamespace and p.proname in (
  'lookup_career_operation','claim_career_operation','checkpoint_career_operation',
  'release_career_operation','finalize_career_analysis','finalize_career_gap',
  'try_consume_rate_limit','complete_rate_limit','fail_rate_limit','refund_rate_limit'
) order by p.oid::regprocedure::text;
select granted.rolname as granted_role,member.rolname as member_role
from pg_auth_members m join pg_roles granted on granted.oid=m.roleid
join pg_roles member on member.oid=m.member
where member.rolname in ('anon','authenticated','service_role');
rollback;
