# Resume provenance for gap investigations

## Correction

New investigations never select a profile's latest resume. They use the exact
versioned source recorded by the originating analysis. A null `resume_id` alone
cannot distinguish pasted text from a historical missing relationship.

Application code stores `_careermind_resume_source` inside `analyses.raw_json`:

- `{version: 1, kind: "stored", resume_id, sha256}`: hash of the actual file bytes
  sent to Analyze, with the exact owned resume ID.
- `{version: 1, kind: "text", text, sha256}`: original nonblank pasted text,
  preserving whitespace, limited to 60,000 characters, with its UTF-8 SHA-256.
- Missing, unknown-version, malformed, conflicting or unavailable sources fail
  closed with HTTP 409 and instructions to create a new analysis. Existing
  ownership failures retain their authorization/not-found status.

The application overwrites this reserved metadata independently of model output
and ignores caller-supplied source metadata. This is not cryptographic attestation
against an owner who can directly insert their own analysis through existing
database permissions; it never authorizes another account's file. The public analysis result and Action
Plan generation remain unchanged. No migration, new table, RPC, environment
variable or usage-guard policy change is required.

## Stored file identity and admission

Before kickoff admission, resolve the exact record with authenticated user and
active-profile filters, validate its owner namespace, download its bytes, check
its 5 MiB limit and compare SHA-256 with the analysis source. Upload those same
verified in-memory bytes, not a second download. Same-path overwrites are detected;
identical bytes at a changed path are still the same content. No Storage policy
or mutation behavior is changed.

This deliberately permits an authorized Storage read during stored-source
preflight even if a subsequent quota/disabled check denies generation. Invalid
provenance never admits quota, uploads a provider file or dispatches generation;
foreign ownership/namespace failures never download a file. No paid work follows
an admission rejection. Text preflight performs no Storage access. There is no
new exactly-once creation guarantee beyond the existing usage guard.

Analyze retains its guard-first download behavior. The original stored-source
hash is checkpointed through the existing guard so persistence recovery cannot
silently associate a returned analysis with changed file bytes. Hash mismatch on
recovery fails closed instead of attaching new content to old model output.

An unfinished operation created before this source checkpoint existed can already
contain `file:0`, `response:0` or `persist:analysis`. Analyze must not create a new
source hash from today's bytes for that operation: the existing upload/response
may refer to older bytes. Recovery now rejects such source-less stored operations
with 409 before another upload/generation or source checkpoint write. This also
blocks upload-only recovery even before a response exists. Completed response
replay still returns before the work callback, unchanged. New operations save
source identity before file upload; unchanged-source persistence recovery reuses
the existing output and quota, while changed bytes fail closed. Pasted-text
recovery uses the identical request text bound by the guard fingerprint and has
no stored-file substitution.

## Frozen context and privacy

New investigations freeze source identity in `context_snapshot.resume.source`.
Original pasted text is supplied as explicitly untrusted candidate evidence on
kickoff and every follow-up. It is not an instruction channel or a confirmed
capability claim. Existing evidence confirmation/edit rules remain unchanged.
Stored investigations continue using the provider file uploaded from verified
bytes; later profile or source-record changes do not replace that evidence.

The reserved source is stripped from public analysis results and target-job
analysis lists, investigation GET/turn responses and Server Component props sent
to the investigation client. Narrative and recommendation inputs use their
existing field allowlists, not the private source object. Errors do not log source
text. The pure Node.js contract is shared with the standalone evaluator; HTTP
readers import it through a server-only boundary, with no new privileged client. Original text can still legitimately appear in user-facing evidence excerpts
or model output; stripping private metadata is not a content-redaction system.

The original text is now retained as personal data in analysis and investigation
JSONB under existing owner RLS. It is not a separate server-secret vault: authorized
owners with direct database API read access can read their own records. It follows
those records' existing retention/deletion behavior; an investigation snapshot can
outlive its seed analysis. No automatic cleanup or existing-record rewrite is
introduced. Review this retention implication before rollout. No export endpoint
was found that exports these private objects; future readers/exports must use the
same explicit projections/sanitizers.

## Historical compatibility

Saved investigations retain their existing transcripts, evidence, context and
provider file IDs. Reopening uses the saved session without new provider work.
Legacy sessions without new metadata continue working; they are not retroactively
certified as correctly sourced. Existing potentially mismatched sessions require
separate review, not silent rewriting.

A new kickoff from any historical analysis without trustworthy source metadata
is blocked, including an older stored-resume analysis without a byte hash. Users
must create a new analysis from the intended source. Reattaching today's file or
pasted text to an old gap is not proof that it was the original evidence.

The prior synthetic Production canary predates source persistence and therefore
cannot safely start a new investigation under this fix. Do not modify it to invent
provenance. After separate merge/deployment and paid-call approval, create a fresh
synthetic analysis, verify accounting and the source record, then investigate its
own gap and test exact request replay. Keep the campaign's existing paid-attempt
and spending limits unless separately changed by the owner. This PR performs no
Production writes, paid calls or rollout.

## Verification

`npm run test:resume-source` tests the production validator, privacy serializers,
owned analysis-list reader and real agent input builder with a provider double.
`npm run test:resume-access` covers real handlers with Auth/Storage/provider network
doubles. `npm run test:investigation-navigation` verifies saved-session reuse and
public API/SSR serialization. `npm run test:ai-usage` runs real handlers, guard SQL
and persistence/replay against disposable PostgreSQL, including source privacy,
frozen text follow-ups, prompt isolation and quota balances. No mocked output is
presented as real model quality or hosted integration evidence.

## Local results for this change

- Resume-source validator/privacy/real agent-input tests: 14 passed.
- Resume-access handler/security regressions: 74 passed.
- Investigation navigation/reopening/API and SSR privacy: 48 passed.
- Actual usage/persistence/replay SQL on disposable PostgreSQL 17.6: 83 passed.
- Compare: 59; Storage policy SQL on disposable PostgreSQL 17.6: 17;
  Action Plans: 14; analysis metadata: 19; recommendation validation: 49 passed.
- Standalone agent import smoke check and 15 deterministic evaluation-metric
  assertions pass without provider calls.
- Local production build and TypeScript pass. Scoped ESLint passes except Analyze's unchanged baseline
  5 no-explicit-any errors and 1 unused-variable warning; no new lint suppressions were added.
- Hosted Supabase, authenticated browser and paid model behavior for this change
  are not verified. Test doubles do not establish semantic model quality.

Before any separately approved deployment, confirm the reviewed commit and
existing source/record retention expectations. No SQL activation is needed.
Rollback to old application code reintroduces latest-resume substitution; do not
use that as a silent fallback. Any emergency flag pause requires owner approval.
Existing usage receipts, saved investigations and source snapshots must survive
rollback; do not delete or backfill records to make old code work.

## Focused merge-readiness exposure and retention audit (2026-11-07)

| Reader or copy | Exposure and retention |
|---|---|
| Analyze response and completed replay | `result` contains the model analysis without the reserved source envelope. Analyze stores original pasted text in analysis JSONB; stored-file source metadata is also saved in the private `resumeSource` checkpoint for recovery. |
| Target-job analysis API | `getAnalysesForTargetJob` removes the envelope before returning rows. |
| History and analysis detail pages | Server readers may load raw JSON; history passes only ID/summary/date/verdict to its client. Detail rendering uses explicit result fields. |
| Investigation GET, turn response and initial client props | Source stripped from `context_snapshot.resume`; server-side agent/recovery retains it. |
| Insights, Strategy, Progress and Action Plan recommendation | Explicit field projections/assembled payloads; no wholesale source envelope sent to these models or returned. Evidence excerpts may legitimately contain candidate text. |
| Direct owner database reads | Existing SELECT RLS authorizes the record owner, not just the active profile. Owners can read their own complete JSONB via Supabase. Other users cannot. Sanitizers are application output controls, not a server-secret vault or database column ACL. |
| Private usage operations | Kickoff's `persist:investigation` checkpoint holds the inserted context; follow-up `turnContext` holds the frozen source. Browser roles cannot read this ledger. Completed/failed records older than 24 hours are deleted opportunistically on a later claim, not on a timer. Unresolved records are outside terminal pruning; provably undispatched abandoned claims may be released on later claims, but uncertain holds require reconciliation and have no automatic deletion deadline. |
| Existing goal/job deletion | Removes the goal/job; analysis foreign keys become null. Analysis JSONB and investigation source remain. This is not resume erasure. |
| Analysis deletion | No application analysis-delete endpoint was found; the inspected fixture has owner SELECT/INSERT policies but no DELETE policy despite table DELETE grants. A privileged deletion nulls investigation seed IDs and preserves the frozen source. |
| Career-profile deletion | No application profile-delete endpoint was found. Database FK behavior deletes that profile's investigations but sets analysis profile references null, retaining analysis JSONB. |
| Auth-account deletion | No application account-delete endpoint was found. FK cascades remove application analyses/investigations, but usage operations have no user FK and private recovery copies can remain. Do not claim account deletion fully purges source copies. |
| Backups and provider files | Database backups can retain source JSON beyond row deletion. No application provider-file deletion was found; external provider retention was not independently verified. These are not cleared by deleting an analysis. |

The original reviewed commit had a confirmed stored-source recovery defect,
reproduced deterministically for both legacy checkpoint layouts (HTTP 200 rather
than required 409). The Analyze-only correction closes it without altering guard
SQL or accounting policy. No additional ordinary API disclosure was confirmed.
The ownership and retention behavior above is an existing access/lifecycle
limitation made more sensitive by durable full text; it is documented explicitly,
not silently changed into a new privacy or deletion subsystem. Hosted schema drift,
external backups and provider-side retention were not reverified during this
local-only review.

Focused review validation: the two new legacy-checkpoint regressions fail on
`4ca149b` with HTTP 200 instead of 409. After the correction, all 83 disposable
PostgreSQL 17.6 usage/persistence tests pass, including both layouts, changed-byte
recovery rejection, unchanged-byte recovery, completed replay after a file change,
legacy text recovery, and owner/deletion/ledger-retention evidence. The 14 source,
74 resume-access and 48 navigation/privacy tests also pass (219 affected tests).
TypeScript and the local production build pass. Test-file lint passes; Analyze
retains the same baseline five no-explicit-any errors and one unused-variable
warning. No shared-database changes or paid provider calls were made.
