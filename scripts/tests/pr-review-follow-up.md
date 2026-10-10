# PR #1 independent review follow-up — 2026-10-10

Reviewed https://github.com/skamdoum/careermind/pull/1#pullrequestreview-5481134336
against commit c984f70. The review presents verification requests, not confirmed
new vulnerabilities. Investigation found one migration-boundary defect; recovery
checks did not establish an additional defect.

## 1. Migration/security boundary

**Confirmed:** migration 2 granted authenticated execution of transitional
operation functions until migration 3 removed those signatures. Pausing application
writes does not itself stop direct Supabase calls. The minimal fix removes those
six grants and explicitly revokes PUBLIC/anon/authenticated/service_role execution
in migration 2. Only the trusted signatures introduced in migration 3 become
available to the service role. No product data or operation logic changed.

**Verified locally:** all six transitional signatures are inaccessible to API
roles immediately after migration 2, including a real denied authenticated SQL
call before migration 3. All three migrations then apply/reapply. Existing checks
still cover all ten final RPCs, definer/search-path metadata, unexpected overloads,
accidental grants, denied browser mutations, authorized server execution and
wrong-owner tokens.

**Still a release gate:** PostgreSQL 17 plus the exact deployed schema, representative
real role memberships/default privileges, function owners, table ACLs/RLS/storage
policies and real anon/authenticated/service-role PostgREST calls. Only PostgreSQL
16 is installed locally. No schema-clone or dedicated staging credentials are
configured here. The configured Supabase API access does not provide a complete
SQL schema/grants export. A synthetic fixture is not a staging rehearsal.

All three migrations remain required in order. Keep affected writes paused until
migration 3 and compatible handlers are ready; never overlap old/new transcript
writers. The stronger intermediate ACL does not eliminate the cutover requirement.
The existing guarded rollback and secure-code-only rollback guidance remain.

## 2. Investigation recovery

**No confirmed recovery defect.** Added 16 real-SQL combinations covering initial
question identity present/absent, retry question identity present/absent, same/new
key and expired lease with/without checkpoint. Each also checks a running duplicate,
original-question association, obsolete-worker rejection, quota state, unique
positions, one user answer/one assistant response, correct turn count, repeat
finalization, completed replay and explicit wrong-question conflict.

Checkpoint recovery retains the reservation; no-checkpoint recovery counts the
expired attempt and reserves another. Ten concurrent different-key claims for one
question yield one worker, one user answer and one quota event, followed by one
assistant response and completed replay.

Added fresh-module/session-storage retry-key coverage and rendering of the actual
investigation component's saved pending answer. These verify production helper
and component behavior, not real browser hydration/network sessions. Real browser
reload, concurrent tabs and hosted timeout behavior remain staging requirements.

Completed retry identity must retain the original key OR question ID. Changing
both the key and omitting the question after completion cannot be distinguished
from a deliberate answer to the next question; the UI supplies both identities.
No text-only guess or architecture rewrite was introduced.

## 3. Authenticated staging E2E

**Unverified requirements, not demonstrated defects:** owner/non-owner storage
access in compare/analyze, analysis persistence/replay, kickoff/answer/conclusion,
narrative quota/cache, and provider timeout/recovery through actual Supabase
PostgREST. No staging resources were invented, production migrations applied,
user data mutated or paid provider requests run. Existing local handler/SQL results
do not claim these checks passed.

## 4. Rollout and GitHub state

No merge, production migration or configuration change is authorized. The existing
Vercel integration automatically produced a preview on the earlier push. The user
explicitly instructed us to hold the follow-up push until previews are disabled.
Accordingly, the follow-up commit remains local; the PR discussion can document
results, but GitHub code still represents the earlier head until a push is allowed.
No Vercel configuration was changed or deployment explicitly initiated.

## Validation

- `npm run test:operations`: 24 tests passed.
- `npm run test:operations:db`: 59 checks passed, disposable PostgreSQL 16 fixture.
- Separate TypeScript, scoped lint on the changed tests and diff checks passed.
- Prior production build, 20 quota tests and 15 evaluation assertions passed at
  c984f70; application/provider/quota code is unchanged in this follow-up.
- Local cluster stopped after checks. Full-project legacy lint and all staging
  requirements above remain unresolved release gates.
