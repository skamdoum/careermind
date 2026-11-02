# Resume Storage isolation and deletion verification

Branch baseline: `main` / `6c7a8e65ab0f98c5bbe2e0092149594c7832ec2d`.
PR #10, Phase 2a, application routes, and Storage SDK versions are unchanged.

## Actual policy audit and root cause

On 2026-11-02 the development PostgreSQL 17.6 catalog had RLS enabled on
`storage.objects` and `storage.buckets`, a private `resumes` bucket, no bucket
policies, and these four permissive object policies, all for `authenticated`:

| Existing policy | Command | Predicate |
| --- | --- | --- |
| Authenticated users can view resumes | SELECT | `bucket_id = 'resumes'` |
| Authenticated users can upload resumes | INSERT | `bucket_id = 'resumes'` |
| Users can view files in their own resume folder | SELECT | bucket plus first folder = `auth.uid()::text` |
| Users can upload to their own resume folder | INSERT | bucket plus first folder = `auth.uid()::text` |

Permissive policies combine with OR. The bucket-wide SELECT and INSERT policies
defeated both owner policies. Consequently authenticated users could download/list
foreign resume objects and upload into foreign namespaces. No UPDATE/DELETE
policy existed, so ordinary authenticated updates/deletes were denied by default.
The existing table-level grants are not themselves a bypass when RLS is enabled.
No checked-in migration previously defined these Storage policies.

The audit found 76 resume metadata rows, all using the current
`<user-id>/<timestamp>.<extension>` convention and owned career profiles. Existing
users' file contents were never downloaded. The owner confirmed the linked project
`pajpopmtkslwmfqzifoy` is development and there is no Production deployment.
The second accessible project was not assumed to be Production or changed.

## Replacement and deployment

`20261102000001_resume_storage_isolation.sql` atomically replaces the four
audited policies with `resumes_owner_select`, `resumes_owner_insert`,
`resumes_owner_update`, and `resumes_owner_delete`. Each requires the `resumes`
bucket and the first object-path folder to equal the verified JWT's `auth.uid()`.
UPDATE checks both the existing row and the proposed destination. The policy never
uses request-body user IDs or client-provided object owner metadata.

Preflight requires RLS, the existing private bucket, and the exact audited policy
set (including roles, commands and expressions). Any unknown policy, including a
policy for another bucket, aborts the transaction for manual review. This avoids
silently retaining an OR bypass or dropping unrelated bucket behavior. Other
buckets, object data, table grants, and the service role are unchanged.

The migration passed an actual development PostgreSQL 17 rollback rehearsal.
`supabase db push --linked --dry-run` listed only this migration, then the targeted
development push applied it and recorded migration history. A subsequent read-only
catalog check confirmed exactly the four owner policies, RLS, the private bucket,
and `service_role.rolbypassrls = true`. No further policy change was needed for
the deletion investigation.

For a future approved rollout: identify the target project, inspect every live
Storage policy, verify private-bucket/RLS prerequisites and path compatibility,
inspect pending migrations, and apply only reviewed migrations through the normal
migration runner. If preflight detects drift, stop; do not bypass the guard or add
a fallback grant. Run the two-user smoke test against development first. Applying
these policies to a future Production environment requires separate approval.

## Why immediate deletion verification originally failed

Two newly generated synthetic paths reproduced and diagnosed the failure. Requests
used authenticated `/storage/v1/object/resumes/<path>` URLs, not signed/public URLs
or a service-role download. The DELETE request was
`DELETE /storage/v1/object/resumes` with `{"prefixes":["<exact path>"]}`.

For the first reproduced path:

| Observation | Evidence |
| --- | --- |
| Before deletion | Exactly one `storage.objects` row; object ID `147e05c7-fa28-436a-bf86-5ef272f1aa56` |
| DELETE | HTTP 200; response identified the same object ID, bucket and full path |
| Immediate catalog query | No matching row |
| Immediate standard owner GET | HTTP 200, `CF-Cache-Status: HIT`; exact pre-delete SHA-256 content hash |
| Immediate uncached owner GET | HTTP 400 with body `statusCode: 404`, `code: NoSuchKey`, `message: Object not found`; cache status DYNAMIC |
| Cross-user GET before/after deletion | Denied; no file contents |

The matching delete request ID is `01a19d17-0491-76f8-8af4-2c6ed3d3bfb6`, the
stale GET ID is `01a19d17-069e-7e8f-96c1-75fb0bca73cc`, and the uncached GET ID is
`01a19d17-06e0-73d5-b400-6dd79da806dd`. Captured HTTP responses/headers and actual
database snapshots establish the cause; backend Storage-service logs were not
queried through the CLI/SDK, which do not expose them here.

The second new path also disappeared from the database immediately. Its ordinary
GET already returned not-found, showing that edge invalidation timing varies.
Both its immediate uncached GET and one fresh-client observation two seconds later
returned not-found. That bounded observation checked persistence; no sleep or
retry-until-success was used to establish deletion. Storage and SQL used the same
development project; the object ID/name/version created through Storage appeared
in that database before deletion and disappeared afterward.

This is stale CDN content for a previously authorized owner, not a failed SQL
delete or evidence of cross-user authorization bypass. Supabase documents
[cache invalidation propagation and the `cacheNonce` bypass](https://supabase.com/docs/guides/storage/cdn/smart-cdn).
Standard cached URLs are not an immediate-erasure guarantee, and this change does
not attempt to revoke copies already downloaded or immediately purge every edge.

## Corrected regression checks

The live suite now verifies the returned deletion object ID and full path against
the pre-delete listing, absence from the post-delete listing, and not-found with a
new verified authenticated client using a unique SDK `cacheNonce` plus fetch
`cache: 'no-store'`. It asserts the missing-object error rather than allowing an
expired-session error to pass. There are no sleeps or eventual-success retries.
Update/upsert content checks also request origin-fresh bytes. Standard-URL
cross-user download assertions remain, before and after deletion; bypassing cache
must not mask an edge-layer authorization leak.

The local SQL suite executes the actual migration and rollback in a private,
disposable PostgreSQL cluster. Auth and Storage schemas are fixtures; policy logic
is not duplicated. It checks drift, atomicity, owner CRUD, foreign CRUD/upsert,
update destinations, missing identities, anonymous access, unrelated buckets,
service-role bypass, and fail-closed rollback.

```
npm run test:resume-storage
npm run start -- --hostname 127.0.0.1 --port 3107
CAREERMIND_STORAGE_TEST_PROJECT_REF=<confirmed-development-ref> \
CAREERMIND_STORAGE_TEST_BASE_URL=http://127.0.0.1:3107 \
npm run test:resume-storage:live
```

The local suite requires `initdb`, `pg_ctl` and `psql` in PATH. It ignores remote
database settings and binds only a private Unix socket. The live suite explicitly
opts into the matching configured development project and loopback app, creates
two disposable users and synthetic text files, and verifies cleanup even on
failure. It never modifies policies, runs migrations, reads existing users' file
contents, or invokes OpenAI. A fresh default client is unauthenticated; anonymous
Auth accounts still have `authenticated` role and their own UID, so these policies
authorize their own namespace. Registered-account requirements remain an API rule.

## Recorded validation (2026-11-02)

| Check | Result |
| --- | --- |
| Local PostgreSQL 16.15 policy and rollback suite | 17 passed |
| Real development PostgreSQL 17.6 / Storage / local built-app smoke | All 13 checks passed; fixture cleanup verified |
| Existing Action Plan / metadata / investigation navigation / recommendation suites | 14 + 19 + 47 + 49 = 129 passed |
| Separate TypeScript and scoped ESLint | Passed |
| Local production build | Passed; existing middleware-to-proxy deprecation warning |
| Migration history and live policy catalog | Targeted development migration recorded; exactly four owner policies |

The original live failure was diagnosed, not hidden by retries or changed policy
expectations. Local runs execute real PostgreSQL RLS; live runs use real Auth and
Storage requests. The local cluster needs shared-memory permissions unavailable in
the default sandbox; running the unchanged suite outside that sandbox succeeded.
No mocked-model result or browser UI test is claimed.

## Rollback and remaining risks

The separate `supabase/rollback/20261102000001_resume_storage_isolation.sql` is
an emergency fail-closed action, not an automatic down migration. It installs a
restrictive resumes deny policy and removes owner policies, disabling browser
resume access while retaining service-role operations and other-bucket behavior.
Never restore the vulnerable bucket-wide policies. Recovery after this emergency
rollback needs a newly reviewed policy migration; the original migration's drift
guard intentionally prevents blind replay. Application rollback alone does not
undo already-applied database policies.

The policy fix protects direct Storage access only. `app/api/resumes/route.ts`
accepts a client path; analysis and investigation kickoff resolve owned metadata
then use service-role downloads without a namespace guard. These privileged paths
need a separate focused hardening review before beta. PR #10 independently fixes
compare; this branch does not include or modify it. Previously issued signed URLs
and historical access logs were not inventoried. No browser automation, full AI
analysis/investigation smoke test, or Production deployment was performed.
