# Phase 2a correctness remediation

## Production design

CareerMind has three durable operation kinds: analysis, investigation kickoff,
and investigation answer. No workers, queues, generic workflow definitions,
notifications, or analytics were added. Existing success payloads are preserved.

- Compare resolves an owned resume record in the active career profile, then
  downloads using the user's Supabase client. Legacy `latestResume.file_path`
  requests require a matching owned row. File metadata is server-resolved.
- Analysis freezes its inputs, checkpoints AI output, then saves the analysis,
  signals, gaps, plan, tasks, response references, and quota completion in one
  PostgreSQL transaction. Completed replay precedes new-work validation and the
  free-analysis check. Old Phase 2a keys without a verifiable operation/input
  fingerprint return a controlled conflict; users must inspect saved results
  before deliberately starting a new request. Missing saved artifacts return a conflict without AI work.
- An investigation answer is claimed under a short per-user database lock.
  Exactly one pending exchange can exist for an investigation; user answers are
  saved once and turn positions are unique. Finalization saves the assistant,
  evidence, conclusion/count, and quota completion together. Evidence remains
  pending until user confirmation. Existing stopping/coherence rules are kept.
- Kickoff claims before upload/generation and creates its investigation only
  when the complete output can be saved. A persistence retry uses frozen inputs.
- Five-minute leases and attempt tokens reject obsolete workers. SDK automatic
  retries are disabled for durable flows; each explicit provider attempt has
  its own quota reservation. Provider calls time out after 60 seconds. Slow
  operations that exceed the lease must retry; no lock spans an AI call.
- Browser retry keys survive same-tab reloads through session storage; only
  digests/UUIDs are stored. If storage is unavailable, keys survive in memory
  until reload. Investigation requests also send the question identity.

### Quota rules

| Situation | AI call | Quota |
|---|---|---|
| Completed replay | None | None added |
| Saved-output/persistence retry | None | Original event retained |
| Still-running duplicate | None; HTTP 409 | None added |
| Provider timeout/connection/5xx/429 | Failed attempt | Refunded; next AI attempt needs a fresh slot |
| Permanent generation failure | Failed attempt | Consumed; next AI attempt needs a fresh slot |
| Expired attempt without checkpoint | May have finished remotely | Old event remains consumed; next attempt needs a fresh slot |
| Quota denial | None; HTTP 429 | Answer remains pending; no new event |
| Operation RPC unavailable | None; HTTP 503 | Fails closed; no untracked generation |

A checkpoint retry can succeed even when the current hourly quota is full.
Once saved, it never regenerates merely to finish persistence. A checkpoint
write failure after provider completion can still cause another paid call on
retry. Attempt fencing guarantees one committed result, not exactly one paid
provider call across all crashes. Recovery is triggered by a user retry.

The older compare/narrative quota wrappers retain their existing configurable
fail-open behavior. Compare still costs one slot for up to five JD calls; a late
transient batch failure can refund a slot after earlier paid calls. Narrative
cache-miss deduplication and batch pricing are outside this focused remediation.

## Network-free tests (no secrets or .env.local)

Requires Node 20.11+ with the installed tsx dependency; validated on Node 24.

```sh
npm run test:operations
npm run eval:test:rl
npm run eval:test
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

`routes.test.ts` imports actual API handlers, ownership checks, normalization,
and operation orchestration. It intercepts only the Supabase session/admin
network clients and OpenAI SDK boundary. The rate-limit suite imports the
production orchestrator, classifier, and RPC wrappers; it contains no copy of
production business logic. Expected error logs appear in failure-path tests.

## Disposable PostgreSQL integration tests

`operations-db.test.ts` always connects to `127.0.0.1:55439` (override only the
port with `CAREERMIND_TEST_PGPORT`). It never reads project credentials or a DB
URL. It creates and drops only a uniquely named `careermind_remediation_test_*`
database. Use a disposable local cluster, not a local instance containing real
project data. The test fixture creates Supabase-style roles in that cluster.

Example with Homebrew PostgreSQL binaries (adjust version/path locally):

```sh
initdb -D /private/tmp/careermind-remediation-pg -A trust --no-locale -E UTF8
pg_ctl -D /private/tmp/careermind-remediation-pg -l /private/tmp/careermind-remediation-pg.log -o '-k /private/tmp -p 55439 -h 127.0.0.1' start
npm run test:operations:db
pg_ctl -D /private/tmp/careermind-remediation-pg stop
```

Tests apply the real migrations and use separate connections for concurrency.
They check atomic rollback, quota edge serialization, operation claims, refunds,
lease expiry/fencing, checkpoint reuse, concluded replay, legacy pending-answer
adoption, permissions, unique positions, JSONB/text-array evidence compatibility,
rolling-window expiry, quota-denied recovery, migration reapplication, and down
migration guards/data preservation.

**Limit:** `20260324002003_init_careermind_schema.sql` is empty in this repository.
`base-schema.fixture.sql` supplies a minimal, explicitly synthetic baseline.
Local verification uses PostgreSQL 16; the project config targets PostgreSQL 17.
This proves the new SQL's behavior on that fixture, not the exact deployed
schema, PostgREST/session integration, or Supabase storage policy behavior.
Those checks require an authorized staging copy of the deployed schema and a
local/staging Supabase instance. No production migration or provider call is
part of these tests.

## Migration and rollout safety

Prepared migrations, in order: `20261010000001_rate_limits.sql`,
`20261010000002_ai_operation_correctness.sql`, then
`20261010000003_trusted_ai_rpcs.sql`. The third is mandatory: it removes the
client-callable operation signatures, adds an explicit server-supplied user ID,
and restricts the entire ten-function surface to service-role execution. It
redefines existing functions without rewriting product data. Do not enable
affected writes between these migrations or roll back the third independently
to the unsafe client grants. The second also replaces quota
reservation logic so an already-installed Phase 2a function no longer performs
probabilistic deletion of reservations referenced by durable operations.

Before any production approval:

1. Recover the actual base schema in a disposable/staging environment. Run the
   read-only `supabase/validation/phase2a-preflight.sql`; inspect columns, types,
   enum/check constraints, policies, grants, and duplicate turn positions. Save
   the existing transcript ACLs for a precise rollback. Resolve legacy duplicate
   indexes explicitly; the migration will never delete or renumber them.
2. Validate all three migrations and the integration suite on PostgreSQL 17 with
   that schema. Test browser authentication, owned/foreign resume storage
   access, explicit and legacy requests, session-reload retries, and lease
   recovery through the real Supabase API.
3. Take a backup; pause affected AI writes during migration/code cutover.
   Migrations are transactional and use a five-second lock timeout. If an error
   occurs, stop and diagnose; do not continue with half-installed assumptions.
4. Apply database changes before enabling the new handlers. Operation flows
   fail closed when RPCs are unavailable. Never overlap old and new transcript
   writers: direct authenticated transcript DML is revoked so writes must use
   the ownership-checked RPCs. Keep user-scoped SELECT access for reads.

Only trusted service-role requests can execute operation or quota RPCs. Routes
authenticate with the session client, then the server-only operation helper
passes that verified user ID to the privileged client. All ten functions check
the active SQL role, explicit identity/ownership, and use a fixed search path.
The service client never adopts a browser session; it disables session persistence
and refresh. Browser roles cannot access operation context, tokens, checkpoints,
finalization or refunds, including through historical overloads.
Operation tables have RLS and no direct anon/authenticated access. Raw quota
functions remain service-role-only. Caller-provided resume paths are replaced
with the authorized database row inside the claim function as well.

### Rollback

Keep affected writes paused. Prefer restoring compatible application code while
leaving additive tables intact. Do not redeploy vulnerable compare behavior.
The guarded manual script is
`supabase/rollback/20261010000002_ai_operation_correctness.sql`.

It refuses to run with pending/running operations, including saved checkpoints.
Recover or explicitly resolve those operations first; do not discard answers.
After operations are drained and a backup is taken, it removes only operation
functions/history and restores authenticated transcript DML. It preserves
analysis/investigation data, the transcript uniqueness index, and the safer
quota reservation function. Verify restored ACLs against the saved preflight
snapshot; the provided grant assumes the repository's earlier own-row policies.
Rollback removes replay history, so restoring new handlers later requires the
migration again and fresh keys. Resume writes only with approved compatible
code. Neither migration nor rollback is run automatically against production.

### Retention and remaining verification

Completed operations clear frozen inputs/checkpoints, retaining the response
needed for replay (which still includes sensitive career output). Access is
restricted to the owning session through RPCs. Pending output is retained for
recovery. No background retention service was introduced. During beta, review
storage growth and explicitly clear only obsolete, unreferenced quota events;
never delete live operation history/checkpoints opportunistically in a request.
Establish a retention policy before wider rollout.

## Security boundary regression checks

The database suite now exercises service-role calls for legitimate operations,
with an unrelated JWT subject to prove ownership uses the explicit server identity.
It tests denied SQL execution for anonymous/authenticated clients across all ten
RPCs, ACL/search-path/SECURITY DEFINER metadata, accidental grants, unexpected
overloads, direct ledger mutations, missing identity and wrong-owner tokens.
Handler tests make session-client RPC execution throw: successful production
flows must use the mocked privileged network boundary and verified session ID.
No provider output or refund classification is accepted from a request body.

SECURITY DEFINER bypasses table-owner RLS, so explicit owner predicates remain
essential even though execution is service-only. Operation-table browser access
is revoked; quota-ledger browser writes are revoked while owner-only SELECT RLS
remains. The manual rollback script handles both operation signature sets and
preserves the service-only quota functions. Capture actual ACLs before rollout.

PostgreSQL 17, exact deployed schema/role memberships, Supabase JWT-to-SQL-role
integration and browser/storage checks remain staging gates. Local PostgreSQL
16 security tests do not establish those properties in production.

Latest security follow-up results (2026-10-10): 22 handler/client tests, 20 quota
tests, 15 evaluation assertions, and 41 disposable PostgreSQL 16 checks passed.
Production build, separate TypeScript, scoped lint for security-touched code and
`git diff --check` passed. Repository-wide lint remains a known legacy failure
(26 errors / 2 warnings at the prior release review); no unrelated lint cleanup
was included. No production migration was applied.
