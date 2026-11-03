# Operator recovery of uncertain AI operations

This is a manual incident procedure, not an automated recovery service. Every
shared-project write requires separate owner approval and a reviewed,
operation-specific transaction. No recovery was executed against shared data.

## Inspect without exposing candidate data

Confirm the project reference and approved operation UUID. Use an authorized
operator connection; browser roles cannot inspect or reconcile this ledger.
These queries are read-only. With psql, bind `operation_id` to the incident UUID:

```sql
select id, route, state, day, units, calls, call_pending, ceiling, remaining,
       lease_until, created_at, updated_at,
       array(select jsonb_object_keys(steps)) as checkpoint_names
from public.ai_usage_operations where id = :'operation_id'::uuid;

select o.id, s.key as checkpoint, s.value->>'request_id' as provider_request_id,
       s.value->>'id' as provider_response_id
from public.ai_usage_operations o
cross join lateral jsonb_each(o.steps) s
where o.id = :'operation_id'::uuid and s.key like 'response:%';

-- Outstanding reservations must equal operation balances for every day.
with balances as (
  select day, sum(remaining) as operation_reserved
  from public.ai_usage_operations group by day
), buckets as (
  select day, reserved as bucket_reserved
  from public.ai_usage_buckets where subject='app' and category='budget'
)
select coalesce(b.day,o.day) as day,
       coalesce(bucket_reserved,0) as bucket_reserved,
       coalesce(operation_reserved,0) as operation_reserved
from buckets b full join balances o using(day)
where coalesce(bucket_reserved,0) <> coalesce(operation_reserved,0);
```

Inspect private checkpoints only in a restricted operator session when required
for recovery. Never copy `steps`, `result`, resume text, answers, or evidence into
logs, PRs, tickets, or dashboards. Do not recompute historical settled spend from
retained operations: completed replay records expire before daily buckets do.

## Establish the provider outcome

1. Pause new generation with the approved `enabled=false` operation. This blocks
   new dispatch authorization, not previously authorized/in-flight calls or
   persistence. The full rollback additionally revokes checkpoint/persistence
   RPCs; restore only their reviewed grants before attempting RPC-based recovery,
   keeping generation disabled throughout.
2. Correlate provider request IDs, or the opaque client trace
   `<operation UUID>-response:<call index>`, with trusted provider logs/support.
   Inspect every dispatched call, including earlier jobs in a Compare batch.
   A missing response checkpoint does not prove no request was sent or charged.
3. Require authoritative terminal-outcome evidence. Expired leases, elapsed time,
   a network timeout, or failure to find a log entry are not cancellation proof.
   If evidence remains inconclusive, retain the reservation and concurrency hold.
4. Verify model identity, token usage and original response payload where available.
   Do not invent an output, substitute a new generation, or treat an upload/file
   ID as proof that an inference completed. Recovery itself makes no paid call.

## Prepare and review one atomic repair

There is deliberately no general-purpose recovery RPC. The existing claim/step/
end RPCs reject uncertain operations and expired owners; do not bypass that by
blindly extending leases. Prepare a case-specific transaction and rehearse it
against disposable PostgreSQL before asking the owner to approve it.

Acquire `pg_advisory_xact_lock(8913,1)` first, then lock the operation and affected
bucket rows `FOR UPDATE`. Re-read state and all accounting under those locks.
Check that the operation, pending-call identity, day, checkpoint keys and balances
still match the reviewed incident. Abort on missing rows, negative balances,
already-applied repair, or conflicting evidence. Rotate the owner UUID and expire
its lease to fence old application executions. Do not reuse the old owner token.
All balance, checkpoint and state changes must commit together.

Choose exactly one supported disposition:

| Evidence | Accounting and state changes |
|---|---|
| Original successful response and reliable usage recovered | For the one pending call, verify the response checkpoint is absent and charge `input_tokens*2 + output_tokens*8` micro-USD using the reviewed GPT-4.1 policy. Require `0 <= cost <= ceiling`, `remaining >= ceiling`, and sufficient bucket reservation. Add cost to that operation day's budget bucket `spent`; subtract one ceiling from both bucket `reserved` and operation `remaining`; restore the authentic response checkpoint in its existing `response:N` shape. Clear `call_pending`, set state `retryable`, and retain all other checkpoints. Never settle the same call twice. |
| Definitive provider rejection with no billable inference | For the pending call only, subtract one ceiling from bucket reservation and operation remaining; record a rejected checkpoint, retain dispatched-attempt quota, and clear `call_pending`. Finish as a terminal failure as described below. |
| Provider confirms terminal execution but usable output/usage cannot be recovered | Conservatively charge the operation's **entire remaining reservation** to its original day: add `remaining` to bucket `spent`, subtract the same amount from bucket `reserved`, then set `remaining=0`. This may overcount undispatched Compare jobs. Do not refund user quota. Finish as a terminal failure. |
| Outcome unknown | Make no settlement or concurrency-release changes. Keep the hold and escalate to provider support. |

For successful-response recovery, the original application request may resume
persistence with the same operation/quota and restored output. Review the route
and saved context first. A partial Compare batch may still need a new paid call
for an undispatched job; leave generation paused and obtain explicit approval
before allowing it. Restoring a receipt alone does not complete application
persistence or justify marking the operation `complete`.

For terminal failure after a definitive rejection, release any *proven*
undispatched remainder consistently from operation and budget bucket; never
release an ambiguous earlier charge. For either terminal disposition, preserve
all checkpoints, keep consumed quota (conservative retention is acceptable), set
`call_pending=false`, state `failed`, and a truthful private replay envelope such
as `{ "status": 503, "body": { "success": false, "error": "AI operation could not be recovered. Contact support." } }`.
Set `updated_at` and expire the lease. Preserve request keys/fingerprints so a
retry replays the failure rather than regenerating. Do not delete the record to
unlock the user. An incomplete persisted investigation/answer may still require
separately approved application-data repair; releasing the ledger hold alone
does not repair a conversation. Preserve its history and validated evidence.

## Verify before resuming

Within the repair transaction, require zero discrepancies from the reservation
query above and verify that no negative balances or double settlement occurred.
Keep an external restricted incident record of operation ID, provider evidence,
reviewed disposition, before/after balances and approver; exclude private content.
After commit, confirm old owner tokens fail, consumed quota is unchanged, the
original retry replays/resumes correctly, and other work can claim a concurrency
slot only when appropriate. Test dispatch rejection while disabled. Obtain
separate approval before enabling generation again.

If any invariant fails, roll back the entire repair and keep generation paused.
Do not zero buckets, delete uncertain operations, assume the daily reset clears a
hold, or restore unguarded application code as a recovery shortcut.
