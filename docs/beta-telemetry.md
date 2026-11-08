# Lightweight beta telemetry

For the first 5–10 users, business records remain the source for registrations
(`auth.users`, excluding anonymous accounts), completed analyses, repeat usage,
investigation status/conversation and task progress. We do not duplicate them as
events. No client tracking or Action Plan view event is added in this increment.

## What is recorded

`aiResponse()` records one best-effort `ai_call` per newly dispatched Responses
request: operation/call identity, authenticated user ID, optional analysis and
investigation IDs, environment, actual returned model/response ID, token counts,
provider latency, outcome and a controlled provider error category. A failed
request uses the requested model because no returned model is available.

The central wrapper covers Analyze, Compare (up to three distinct call slots),
investigation kickoff/follow-ups (including conclusions), recommendations and
both narratives. Kickoff scope is enriched with the saved investigation ID
before calling the provider. Analyze links its measurement after atomic analysis
persistence; that separate best-effort link may be absent on write failure.
Comparison uses its operation ID; narratives use operation/user IDs.

No resumes, JDs, prompts, outputs, evidence, conversation, raw errors, storage
paths, idempotency keys, credentials or operation snapshots enter telemetry.
The private table has RLS and no browser grants or policies. Only trusted server
code writes it. IDs are still private, correlatable data; account-erasure work
must explicitly remove this table's user/entity references. Soft IDs deliberately
survive usage-operation pruning and business-record deletion.

## Existing behavior and failure handling

The migration creates only the table and its indexes/grants. No triggers,
accounting RPC changes, automated recovery or cleanup jobs are introduced.
Usage guard quotas, settlement, reservation handling, provider retry settings,
input fingerprinting and response contracts are unchanged.

Telemetry transport uses a 1-second abort deadline, awaited and caught. Schema,
import and network errors log only a fixed warning and never change the provider
result or invoke a retry. Successful provider receipt capture runs after
settlement in a `finally` block, so it is also attempted if settlement fails.
Provider latency measures only the SDK request, excluding telemetry/settlement.
An error observation may add up to approximately one second before existing
error handling continues; a successful Analyze can also incur a separate bounded
correlation update.

Uniqueness on event key and `(operation_id,call_index)` prevents repeated writes
from charging twice. Provider response ID is independently unique across
environments; duplicate inserts never overwrite original cost. Completed guard
replays, saved-investigation reuse and narrative cache hits do not dispatch and
therefore do not produce new cost events. Standalone unmetered evaluation calls
remain excluded. No historical workflow cost is recorded as new inference.

**Best effort means incomplete reporting is possible.** Process termination,
transport failure or the unapplied migration can lose a measurement. There is no
backfill or reconciliation framework. Existing operations retain receipts only
until their normal opportunistic 24-hour pruning. Uncertain operations retain
their original accounting holds regardless of telemetry. Telemetry is never an
authority for releasing reservations, refunding quota or declaring a timeout free.

`success` means a provider response was received, not that its JSON was valid or
the application saved successfully. Incomplete provider responses are separate;
network/timeout/5xx outcomes are unknown. Application validation/persistence
failures are not individually instrumented here. Use business records and Vercel
logs to assess application completion; active investigation rows without an
initial assistant turn are incomplete initialization, not completed kickoffs.

## Pricing

Version `gpt41-standard-2026-11-08-v1` uses standard GPT-4.1 text rates:
$2/million ordinary input, $0.50/million cached input, $8/million output.
Source: https://developers.openai.com/api/docs/models/gpt-4.1

Store integer nano-USD (1 USD = 1,000,000,000 nano-USD):

```
(input_tokens - cached_input_tokens) * 2000
+ cached_input_tokens * 500
+ output_tokens * 8000
```

Only GPT-4.1 and its current dated snapshot are priced. Missing/invalid counts,
including missing cached counts, unknown models or unsafe integer totals yield
null cost. Genuine all-zero usage is distinct from missing usage. Updating rates
requires a new pricing version; do not reinterpret previously recorded costs.

Admission reservations and the existing conservative uncached settlement remain
unchanged. Telemetry's receipt-based estimate is neither an invoice nor a hard
spending cap. Failed application outcomes still retain incurred inference cost.
External provider reconciliation and non-inference charges are outside this MVP.

## Reports and environment limits

See `docs/beta-telemetry.sql` for operator-only queries. Estimate workflow cost by
summing distinct call rows, not quota units or workflow aggregates. Analyze uses
analysis ID when linked, Compare uses operation ID, investigations use their ID
with optional recommendation costs separated by route. Narratives are user-level
and should not be charged to every contributing analysis.

`VERCEL_ENV` supplies production/preview/development; absent/unrecognized values
are `unknown`, never guessed Production. No new environment variables are needed.
Reports explicitly filter Production telemetry. Business tables share the same
database and do not encode environment, so adoption reports include Preview/dev
activity unless known test accounts are excluded. Weekly active users measure
persisted activity, not page visits. Current task states are not transition history;
an inactive investigation is not automatically abandoned. Exclude synthetic
canary/test users from external-beta metrics. Application-wide estimates can have
unknown/missing costs; always display coverage counts beside known sums.

## Installation, retention and rollback

Shared database installation requires separate owner approval. Do not run a bulk
historical migration replay. After review, install only
`20261108000001_beta_telemetry.sql` through the approved migration runner, verify
RLS/browser denial and service-role access, then deploy approved code separately.
If code is previewed before installation, telemetry fails softly and measurements
are unavailable; normal generation still follows the existing usage guard.

Retain telemetry for 90 days. No automated cleanup is installed. An authorized
operator can first inspect and then delete old metadata using:

```sql
select count(*) from public.telemetry_events
where created_at < now() - interval '90 days';
-- Separate approval before executing deletion:
delete from public.telemetry_events
where created_at < now() - interval '90 days';
```

This deletes only telemetry, never accounting or business records. It does not
resolve unknown provider outcomes. For rollback, revert application instrumentation
first and preserve the table for review; removing the table later is optional and
requires approval. Never disable or roll back the AI usage guard for telemetry.

## Verification

`npm run test:telemetry` runs provider-boundary tests without paid calls.
`npm run test:telemetry:db` requires initdb/pg_ctl/psql on PATH and uses a disposable
local cluster only. It tests real migrations, grants, independent receipt identity
constraints and survival of the existing guard's pruning. No configured Supabase
URL is used by the database tests. Hosted browser/PostgREST checks remain separate.
