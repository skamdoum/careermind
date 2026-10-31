# Increment 2A — read-only investigation/Action Plan assessment

Branch baseline: main `c95d5c1` (Increment 1). No dependency on Phase 2a/PR #1.

## Contract and implementation

`POST /api/gap-investigations/[id]/action-plan-recommendation` authenticates with
Supabase's session client. It reads the existing active-profile pointer and verifies
ownership without the mutating profile-creation fallback. It requires a concluded
owned investigation and its exact, live, owned seed analysis in that profile.
Only owned plans attached to that analysis and their owned tasks are candidates.
No same-goal/job substitution, admin client, RPC, database writes, table changes,
migrations, or task creation/confirmation paths are used.

Confirmed evidence uses `claim`; edited evidence uses nonblank `user_edit` only.
Pending/rejected records, old transcript text, old summaries and old candidate
assessments from analysis JSON are excluded. After any edit, old conclusion axes
and residual text are removed from evaluator input. Only target requirement text,
not the old analysis's evidence or assessment, is read from `role_requirements`.
Incomplete requirements, target context or grounding produce explicit errors.
Confirmation is the application's user-validation contract, not independent proof
that a candidate's claims are factually true.

The bounded Responses API call uses gpt-4.1, temperature 0, a 60-second timeout,
no automatic SDK retries and a 2,400 output-token cap. Input over 60,000 characters
is rejected rather than truncated. Existing task statuses are withheld from the
model: a done task cannot act as evidence that a career gap is resolved. Actual
IDs, plan relationships, titles/statuses, availability and SHA-256 fingerprint are
server-controlled. Empty task sets cannot select match outcomes in the provider
schema. A second read rejects source changes during evaluation with HTTP 409.

The four public outcomes are FULL_MATCH, PARTIAL_MATCH, NO_MATCH and
NO_ACTION_NEEDED. Insufficient evidence is an error, never a fifth successful
outcome or a no-action conclusion. Zod validation, allowed references, verbatim
citation checks, field consistency and an exact normalized duplicate check reject
invalid output. Semantic equivalence and factual entailment still require model
quality; valid IDs/quotes are not mathematical proof of a supported rationale.

The concluded-investigation UI exposes **Check existing actions**. It does not
call on page load, save recommendations, or offer Accept/Decline. It reports
existing statuses and proposed work as suggestions only, explicitly saying the
plan has not changed. Changing evidence resets the displayed result. Task changes
in another tab require an explicit recheck; results are labeled snapshots.

## Deterministic tests

```
npm run test:plan-recommendations
npm run test:action-plans
```

49 recommendation contract/reader/handler/rendering tests and 14 Increment 1 tests
passed. Network/session/provider boundaries are mocked; production logic runs
unchanged. These tests are NOT model-accuracy evidence. Tests cover all outcomes,
foreign user/profile/seed/task access, absent profiles without writes, missing and
empty plans, edited/unconfirmed evidence, status isolation, stale sources, bounded
input, pagination, unsupported references, false quotations, contradictions,
provider failures, and read-only/no-automatic-generation UI rendering.

TypeScript, scoped ESLint, the local production build and diff checks passed.
A transient duplicate generated `.next/types` declaration appeared during an
intermediate concurrent check; a completed build regenerated it and the separate
TypeScript check was rerun afterward. No source/config change was needed.

## Semantic golden evaluation — separate from mocked tests

`cases.ts` freezes 16 manually specified synthetic scenarios with expected labels
and review criteria. Authorization and invalid-response checks stay deterministic
and never send foreign data to the model. One golden case has no validated evidence
and is rejected before AI; the other 15 call the actual provider, including an
expected insufficient-evidence abstention. Temperature 0 is not a guarantee of
identical future provider responses.

Run explicitly (paid provider use, no Supabase calls):

```
node --env-file=.env.local --import tsx scripts/eval/plan-recommendations/run.ts --live
```

Reports are synthetic-only and saved under ignored `scripts/eval/reports/`.
The runner records raw model classification separately from validated API results.
It stops on provider availability failures rather than silently substituting mocks.

### Recorded 2026-10-28 results

- Final raw model classification: **14/15 = 93.3%**, including abstention.
- Expected end-to-end results: **14/16 = 87.5%**, including both grounding-error cases.
- Accepted recommendation outcomes: **12**, all with the expected classification.
- Manual review of those 12 accepted results: **0 unsupported recommendations**;
  **0 duplicate proposals** among the **7 proposed tasks**. This is a small synthetic
  audit, not a guarantee on unseen user data.
- Two final cases failed closed:
  - `edited-capability`: model labeled NO_ACTION_NEEDED while its dimensions,
    residual need and proposed task contradicted that label. Validator rejected it.
  - `partial-ownership`: classification was correct, but one citation quoted task
    text as candidate evidence. Validator rejected it.

| Scenario | Expected | Final validated result |
|---|---|---|
| Specific incomplete task | FULL_MATCH | Pass |
| Same task done | FULL_MATCH | Pass; actual done status retained by server |
| Metrics-only task | PARTIAL_MATCH | Pass; complementary ownership documentation |
| Unrelated task | NO_MATCH | Pass |
| No deficiency remains | NO_ACTION_NEEDED | Pass |
| Unconfirmed-only evidence | Grounding error | Pass before provider |
| Edited capability correction | NO_MATCH | Rejected contradictory output |
| Missing plan | NO_MATCH | Pass; no plan created |
| Empty plan | NO_MATCH | Pass |
| Broad competency only | NO_MATCH | Pass |
| Combined existing coverage | FULL_MATCH | Pass |
| Target API scope absent | NO_MATCH | Pass |
| Instructions in task data | NO_MATCH | Pass; injection ignored |
| No deficiency plus done task | NO_ACTION_NEEDED | Pass |
| Ownership-only task | PARTIAL_MATCH | Rejected invalid citation |
| Resume representation unknown | Grounding error | Pass via model abstention |

Earlier runs are not hidden: the initial accepted-correct pipeline result was
11/16; raw classifications were not captured, so no raw-accuracy claim is made for
that run. A diagnostic run had raw accuracy 12/15 and pipeline 8/16. General prompt
corrections for contiguous quotes, user-confirmation semantics and no-action
precedence produced raw 12/15, pipeline 12/16. Task-status isolation and empty-task
schema restrictions then produced the final result above. The fixtures were not
changed between runs. 60 paid provider calls total across four runs; no real user
career data was used. Those two failures were review findings at the original PR head; see the follow-up below.

## Live checks and release limits

Supabase health and API schema read-only requests returned 200; required existing
columns are present. No production records were read for evaluation or modified.
A dedicated authenticated development/test-user session was not available, so real
browser login/evaluation, deployed user-level RLS and cross-user PostgREST checks
were not performed. UI tests are React rendering tests, not browser hydration E2E.

Independent review and authenticated staging verification remain required before
release. Model reliability beyond the synthetic suite still needs assessment.
There is deliberately no persistent recommendation cache, durable deduplication,
or new quota ledger. Explicit clicks can cost another AI request; per-component
busy protection is not cross-tab abuse prevention. Phase 2a integration, stronger
cost controls, confirmation and writes remain outside this increment. Fingerprints
are snapshots, not future write authorizations. No deployment is requested.

## PR #3 semantic review follow-up (2026-10-28 America/New_York)

The original raw outputs identified two generation failures, rather than reader or
authorization defects. `edited-capability` correctly described the capability
deficit but selected a contradictory no-action label. `partial-ownership` mixed
task-coverage justification into the candidate citation list. Both were rejected
by the existing validator.

The schema previously requested the outcome first and grounding last. Structured
Outputs emits fields in schema order ([official documentation](https://developers.openai.com/api/docs/guides/structured-outputs)).
Grounding now precedes dimension assessment and task matching; the outcome comes
last. Descriptions and general prompt instructions separate candidate citations
from task coverage, require positive coverage in `matches`, distinguish accurate
resume representation from target sufficiency, and make unknown evidence an
abstention. Documentation suggestions must use confirmed details without invented
illustrative achievements. This is a generation aid, not a guarantee of reasoning.
No validator conditions, schema field limits, golden fixtures, model, authorization,
API contracts, retry policy or database behavior changed. There is no automatic
relabeling, citation removal, model retry or case-specific exception.

Three new deterministic tests preserve the generation field order and replay the
two invalid response patterns: contradictory no-action still fails, and task text
still cannot be cited as candidate evidence. Mocked tests prove those boundaries,
not model quality.

Follow-up runs used the entire unchanged 16-case suite each time:

- First rerun: raw 13/15; validated 14/16. The original label/citation symptoms
  disappeared, but irrelevant tasks entered `matches`; one output failed closed
  and `role-scope` was accepted with an incorrect partial-match label.
- Second rerun: raw 14/15; validated 16/16. `unknown-resume` wrongly selected
  NO_MATCH with an unknown dimension; the validator correctly returned the expected
  grounding error. Manual review also flagged an unconfirmed illustrative metric
  in a proposed documentation task. The final clarification addresses both patterns.

- Final rerun (2026-10-29 01:22:46 UTC / 2026-10-28 local): raw **14/15
  (93.3%)**; validated **16/16 (100%)**, including the two expected grounding
  errors. Both requested cases classify correctly and pass unchanged grounding.
  All 14 accepted recommendations have the expected outcome. Manual review found
  **0 unsupported recommendations** and **0 duplicate proposals** among the
  **9 accepted proposed tasks**.
- Remaining raw failure: `unknown-resume` still emits NO_MATCH rather than
  INSUFFICIENT_EVIDENCE despite marking resume evidence unknown. Its raw proposal
  also duplicates an existing task and contains an unconfirmed tradeoff detail.
  This is **one unsupported/duplicate raw proposal**, rejected by the unchanged
  unknown-dimension guard. It is never returned to the client. Thus API-level
  evaluation passes; raw model classification is not perfect. No semantic
  guarantee or 100% raw-accuracy claim is made.

These three follow-up runs made 45 paid synthetic-only provider calls; the single
no-evidence case in each run stops before AI. No golden inputs/expectations changed.
The final report remains local under the ignored reports directory, with the
runner and cases committed for reproducibility. Scores reflect one final run,
not a repeated-run stability estimate. Accepted-output manual audit is separate
from label/schema scoring and cannot prove safety on unseen user data.

Final quality gates: 49 recommendation tests + 14 Action Plan tests passed;
scoped ESLint, production build, separate TypeScript and diff checks passed.
Only the existing middleware-to-proxy deprecation warning remains in the build.
No live authenticated Supabase/RLS or browser check was added in this follow-up;
previous live-verification limits still apply. Authorization and UI are unchanged.
