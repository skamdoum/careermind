-- Fail-closed operational rollback. Separate approval required on shared DBs.
-- Retain tables, usage receipts, uncertain reservations and recovery data.
-- Never restore an unguarded application while external AI access is enabled.
begin;
update public.ai_usage_settings set enabled=false where id=true;
revoke execute on function public.ai_usage_step(uuid,uuid,text,text,jsonb), public.ai_usage_persist(uuid,uuid,text,jsonb) from service_role;
-- Claim may still replay completed results; new claims fail while disabled.
-- Re-enable only after reconciliation and explicit approval; restore these exact
-- service-role grants from the migration before setting enabled=true.
commit;
