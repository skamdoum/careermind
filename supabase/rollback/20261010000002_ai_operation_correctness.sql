-- MANUAL rollback only, with application traffic stopped and a backup taken.
-- Never run automatically on an error. Restores the old route write grants.
-- Removes durable replay history, but preserves all product data and the
-- transcript uniqueness index. The safer quota function remains installed.
begin;
set local lock_timeout = '5s';
do $$ begin
  if exists(select 1 from public.career_ai_operations where status <> 'completed') then
    raise exception 'Pending operations exist. Recover or explicitly resolve them before rollback; saved answers/checkpoints must not be discarded.';
  end if;
end $$;
drop function if exists public.finalize_career_gap(uuid,uuid);
drop function if exists public.finalize_career_gap(uuid,uuid,uuid);
drop function if exists public.finalize_career_analysis(uuid,uuid,jsonb);
drop function if exists public.finalize_career_analysis(uuid,uuid,uuid,jsonb);
drop function if exists public.release_career_operation(uuid,uuid,boolean);
drop function if exists public.release_career_operation(uuid,uuid,uuid,boolean);
drop function if exists public.checkpoint_career_operation(uuid,uuid,jsonb);
drop function if exists public.checkpoint_career_operation(uuid,uuid,uuid,jsonb);
drop function if exists public.claim_career_operation(text,text,text,jsonb,uuid,text,uuid);
drop function if exists public.claim_career_operation(uuid,text,text,text,jsonb,uuid,text,uuid);
drop function if exists public.lookup_career_operation(text,text,text);
drop function if exists public.lookup_career_operation(uuid,text,text,text);
drop table public.career_ai_operations;
grant insert,update,delete on public.gap_investigation_turns to authenticated;
commit;
