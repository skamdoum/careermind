# AI usage regression tests

See the [architecture and activation runbook](../../docs/ai-usage-guard.md) and
[manual uncertain-operation recovery procedure](../../docs/ai-usage-recovery.md).

Run `npm run test:ai-usage` with one PostgreSQL installation's `initdb`, `pg_ctl`
and `psql` on PATH. For example:

```sh
PATH=/path/to/postgresql-17.6/bin:$PATH npm run test:ai-usage
```

The suite prints the actual server version, creates a temporary local cluster
bound only to a Unix socket, applies the actual target migration and rollback,
then stops/removes the cluster. It does not load `.env.local`, contact Supabase,
call OpenAI, or deploy. Verified: **70/70 on PostgreSQL 17.6 and 16.15**. There were
no behavioral differences between versions. PG17.6 was built from the official,
checksum-verified source archive under disposable `/private/tmp`; no service was
installed. On sandboxed macOS, shared-memory restrictions may require permission
to run the disposable local cluster outside the sandbox.

The first test checks the actual committed migration before the test reset helper
explicitly enables the local setting. Both the column default and seed row are
false. Seven real AI handlers reject disabled generation with zero provider,
upload or privileged download calls. Other tests explicitly enable only this
isolated database to exercise admission, receipts, quotas, concurrency, retry
recovery and rollback. Missing-settings fixtures now restore `enabled=true`
explicitly rather than accidentally relying on the migration default.

`ai-usage-fixture.sql` captures the inspected hosted PostgreSQL 17.6 schema as of
2026-11-03: 13 relevant public tables, physical columns/defaults/nullability,
CHECK/FK/PK constraints, indexes, owner RLS policies and table grants. It includes
synthetic Auth user IDs, a named career profile and a resume metadata row matching
the network double. The stricter foreign key caught the formerly missing resume
row; the fixture was fixed without weakening the constraint. PG17's service-role
MAINTAIN grant is conditional so the same fixture works on PG16.

The initial repository migration is empty; this fixture is not a replacement
application migration. Auth users are ID-only FK stubs, `auth.uid()` reads a fake
JWT, and Auth/Storage services and hosted extension/DDL event triggers are not
emulated. No user-defined row triggers or rewrite rules were found on the
inspected affected tables. Full hosted activation/permissions/browser checks
remain a separately approved gate. Manual recovery is documented, not executed
against shared data. Rollback tests retain uncertain reservations and receipts.

Existing Compare, resume-access, investigation-navigation and recommendation
suites double `store.server.ts` as an external RPC boundary while executing real
handlers/guards. `usage-store-double.ts` is not evidence of database atomicity;
this SQL suite proves that through independent connections. Provider outputs are
synthetic, not model-accuracy measurements.

All `scripts/tests/*.test.ts` suites pass **339/339** on PostgreSQL 17.6. The
separate deterministic metrics script passes **15 assertions** and can run without
the tsx CLI IPC wrapper using:

```sh
node --import tsx scripts/eval/tests/metrics.test.ts
```

Do not run paid live benchmarks or configured-project migrations as part of these
commands. Production configuration and database activation are unchanged.
