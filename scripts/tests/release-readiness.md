# Phase 2a release readiness — 2026-10-10

**Recommendation: still gated on staging verification.** The original review
found a server-trust boundary issue in the prepared operation RPCs. The approved
follow-up now fixes it locally through migration `20261010000003_trusted_ai_rpcs.sql`
and a server-only helper; the historical finding below describes the pre-fix code. No production migrations, Git
commits, pushes, merges, deployments, or paid AI calls were performed.

## Verified

- Full `npm run build` passed, including TypeScript, route compilation and all
  28 static pages. Initial sandbox attempt could not fetch Google Fonts; the
  network-enabled retry passed. Existing middleware deprecation warning remains.
- Operation tests: 19 passed; production quota tests: 20 passed; evaluation
  metric assertions: 15 passed; disposable PostgreSQL 16 checks: 33 passed.
- Separate TypeScript check and `git diff --check` passed.
- Full lint: 26 errors / 2 warnings. A temporary export of committed HEAD had
  33 errors / 3 warnings with the same installed toolchain. Remaining finding
  files/rules also occur at HEAD; full lint is not a clean release gate.
- Local production HTTP smoke: `/login` and `/analyze` returned 200;
  `/dashboard` redirected to login; unauthenticated analyze, compare and
  investigation kickoff POSTs returned 401 before work. Test server stopped.
- Read-only requests to the Supabase project configured in `.env.local`
  succeeded. API schema exposes the required domain columns, including
  `signal_assessments.evidence` as `text[]`, a compatibility case covered locally.
  Neither operation nor quota RPCs appeared in that service-role API schema.
  The `resumes` bucket is private, with no bucket-level size/MIME restrictions.
- Read-only pagination inspected all 37 transcript rows (IDs, indexes, roles
  only): no duplicate positions and no trailing user answers at inspection time.
- UI callers preserve analysis result/IDs, kickoff investigation ID and turn
  bundle contracts. They send retry keys, retain keys after errors, clear after
  success, and show retry messages. Existing navigation remains unchanged.

## Original blocking finding — remediated locally

Authenticated clients have EXECUTE permission on claim, checkpoint, release and
finalization RPCs. Claim returns the attempt token. A user can therefore call
these through Supabase directly, skipping the Next.js server. Ownership checks
protect other users, but do not prove the caller is the trusted AI server.

A separate disposable PostgreSQL probe confirmed an authenticated session can
claim an analysis, checkpoint fabricated AI output, and finalize it with empty
normalized rows and no provider call. It also confirmed callers can self-assert
a transient failure to refund their own claimed attempt. This proves output
integrity and refund decisions are client-controlled; it does not demonstrate
cross-user disclosure or unlimited paid provider calls. The probe database was
dropped and the local cluster stopped.

The follow-up restricts trusted mutations to a privileged server helper that
accepts identity established by the server session and enforces explicit owner
checks. Keep user-scoped reads where appropriate. Do not import the admin client
directly into user-facing routes. Added adversarial tests proving direct
authenticated callers cannot checkpoint, finalize, or approve refunds. This is
a narrow boundary correction, not a workflow-engine expansion.

## Still unverified

- PostgreSQL 17 is not installed locally; only Homebrew PostgreSQL 16 is present.
  The remote API does not establish the actual database server version.
- Exact deployed SQL constraints, triggers, RLS, grants/default privileges,
  function ownership/search paths and migration history. REST schema metadata
  is not a complete schema dump. The repository's initial schema migration is
  empty; the local baseline remains synthetic.
- Storage SELECT/INSERT/DELETE policies and authenticated owner/foreign-file
  access. A private bucket plus service-role metadata access does not prove
  correct user permissions. Storage policies are absent from repo migrations.
- Real Supabase JWT/PostgREST integration for the prepared RPCs, schema-cache
  refresh, lock behavior on a schema clone, and rollback restoring exact ACLs.
- Authenticated browser upload, analysis, goal analysis, investigation answers,
  quota denial/retry, reload recovery, cross-tab concurrency and evidence edits.
  Handler tests and HTTP smoke do not substitute for these end-to-end checks.
- Hosting execution timeout versus the five-minute lease and 60-second provider
  timeout; actual provider behavior and deployment configuration.

The architecture remains proportional: three operation types, short database
locks and atomic finalization, with no queue or background worker. User-triggered
recovery is a beta tradeoff. A crash before checkpoint can still cause another
paid call. Compare/narrative fail-open quota behavior, compare batch pricing and
narrative cache-miss duplication remain documented residual risks.

## Proposed migration and rollback sequence

1. Correct the trust boundary; validate denied client mutations and server flows.
2. Obtain an authorized schema-only export/PG17 staging clone. Run the read-only
   preflight, capture public/storage policies and exact ACLs, migration history,
   bucket metadata and duplicate/pending-turn checks. Rehearse both migrations
   and rollback against that clone; complete authenticated browser checks.
3. After explicit approval, back up and pause affected AI writes. Apply rate
   limits `20261010000001` if not installed, then operation migration
   `20261010000002` and mandatory server-boundary migration `20261010000003`. If Phase 2a is installed, reconcile its deployed definition;
   do not blindly replay a recorded migration. Both changes are transactional.
4. Enable compatible code after database readiness; do not overlap old and new
   transcript writers. Smoke-test and resume writes with a small controlled group.
5. For rollback, pause writes. Prefer compatible secure code with additive tables
   retained. Drain or explicitly recover pending operations before the guarded
   rollback script; never discard saved answers/checkpoints. Back up replay
   history, restore captured ACLs, and verify domain data. The script preserves
   product data, transcript uniqueness and safer quota logic, but deletes durable
   replay history. Never restore the vulnerable compare implementation.

## Proposed GitHub review workflow

The repository has `origin` configured and no `.github` workflow directory.
After approval, create a `codex/` branch and draft PR with remediation, migrations,
tests and this report. Review SQL permissions/rollback separately from route/UI
contracts within the same PR. Require production build, meaningful unit tests,
PG17 integration checks and staging signoff before merge. Resolve or explicitly
baseline legacy lint failures rather than claim lint passes. Remove incidental
CLI cache changes from the intended PR after checking their provenance. GitHub
branch protection and CI configuration were not inspected or changed.

Production migration, merge and deployment remain separate approval steps.

## Security remediation follow-up

The six operation and four quota functions are now service-role-only, have
active-role guards and fixed search paths, and retain ownership/fencing checks.
Historical operation overloads are removed; unexpected same-name overloads lose
client/service execution grants. All three migrations are required before enabling
writes; rollback must not restore the vulnerable function grants. Local authorized
server execution and denied client access are covered by regression tests. The
remaining PostgreSQL 17, actual SQL permissions, storage and authenticated browser
checks above still block a production-readiness claim. No production change was
made by this remediation.

Follow-up validation: 22 handler/client tests, 20 quota tests, 15 evaluation
assertions and 41 PostgreSQL 16 checks passed; production build, separate
TypeScript and scoped lint passed. Full-project legacy lint failures remain.
These results replace the pre-fix counts above for the remediated working tree.
