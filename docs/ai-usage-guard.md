# AI usage guard — beta review and activation runbook

**Status as of 2026-11-03: installed and hosted security verified; AI generation disabled; PR #13 draft and unmerged.** Migration `20261103000001_ai_usage_guard.sql` was installed successfully on shared Supabase project `pajpopmtkslwmfqzifoy` on **2026-11-03 at 18:27:21 UTC**. Hosted PostgreSQL is **17.6**. The reviewed PR head is `85cd9c8720574edc2fafd0208ee57865d9363da9`; Production still runs the previous, unguarded implementation at `a44732ed6e165e8e7a18ffa04d0edf578b6d69db`. The shared setting remains `enabled=false`, with a $10 daily application admission budget. Local/Preview/Production share this project; never treat it as disposable. Installation is completed: **do not reapply the migration**. Merging, Production deployment, activation, and any subsequent shared-project settings changes each require explicit owner authorization.

## Endpoint audit

All production generation uses the OpenAI Responses API and `gpt-4.1`. Registered and anonymous Auth sessions are verified using `auth.getUser`; client-supplied user IDs never identify quota subjects. Compare alone rejects anonymous Auth users. No unauthenticated endpoint generates AI output.

| Method and route | Generation count | Uploaded file | Existing safeguards / new accounting |
|---|---|---|---|
| POST `/api/analyze` | 1 | Optional | Owned exact resume/profile; file canonical over pasted text. Generates analysis and initial Action Plan together. New daily analysis quota replaces neither the existing 100-analysis lifetime check nor ownership checks. |
| POST `/api/compare` | 1–3 | Optional, once/request | Registered user; owned resume and namespace; existing 512 KiB body, 60k resume characters, 30k characters/job, 1–3 jobs. Each job consumes one other unit. |
| POST `/api/gap-investigations` | 0 on saved reuse, otherwise 1 | Optional | Owned exact gap/analysis/profile/resume; no fallback for explicit unavailable resume. Kickoff consumes one gap unit. |
| POST `/api/gap-investigations/[id]/turns` | 1 | Existing provider file reused | Owned active investigation, complete persisted transcript; each follow-up consumes one gap unit. File input is included again on subsequent calls. |
| POST `/api/gap-investigations/[id]/action-plan-recommendation` | 1 | None | Concluded owned investigation, exact live seed analysis, confirmed/edited evidence, scoped plans, structured validation and freshness check. 60k-character evaluator payload, 2400 output tokens. No Action Plan mutations. |
| GET `/api/insights/narrative` | 0 on empty/cache/replay; otherwise 1 | None | Existing deterministic hash/cache preserved before admission. Counts one other unit on generation. |
| GET `/api/strategy/narrative` | 0 on empty/cache/replay; otherwise 1 | None | Same cache-first protection. Counts one other unit on generation. |
| HEAD on both narrative routes | 0 | None | Explicit authenticated handlers replace Next.js's implicit GET delegation. No generation, profile creation or usage reservation. |

Other API routes read/update application data and do not generate AI. Before this change, most clients used SDK defaults allowing two retries, neither narratives nor analysis/agent calls set output limits, narrative cache misses could race, and turns were inserted before provider work without durable request identity. No checked-in usage guard or exposed usage RPC existed. Supabase Auth signup limits are not AI limits; the checked-in anonymous-signin setting does not establish the hosted setting.

## Architecture and quota rules

`lib/ai-usage/guard.ts` performs admission and response replay; `provider.ts` supplies a Node-only execution context and bounded provider adapter; `store.server.ts` is the sole privileged accounting RPC caller. Database transactions use a short transaction-level advisory lock for atomic admission/accounting. No transaction is held while waiting for Storage or OpenAI. This deliberately serializes small accounting writes at beta scale, without Redis, workers or a workflow framework.

Migration `20261103000001_ai_usage_guard.sql` adds only:

- `ai_usage_settings`: singleton enabled flag (initially **false**) and authoritative daily budget in integer micro-USD, initially $10. Both the column default and explicit seed value are false inside the migration transaction; installation never authorizes generation.
- `ai_usage_buckets`: user/category UTC-day quotas and application spent/reserved allowance.
- `ai_usage_operations`: opaque operation and owner/fencing IDs, hashed request/input identities, state, provider receipts/checkpoints, and short-lived private replay/recovery data.

Four fixed RPCs claim, checkpoint/account, finish, and persist the required CareerMind records. They are `SECURITY INVOKER` with fixed search paths, explicit `PUBLIC`/`anon`/`authenticated` revocations, and service-role-only grants. Usage tables have RLS enabled and no browser policies or grants. No client can reserve quota, fabricate provider receipts, finalize operations, refund budget or read replay data directly. Trusted server callers pass IDs only after verified Auth and existing ownership resolution.

Defaults are 5 analysis units, 20 gap-generation units (kickoffs included), and 10 other units per user per UTC day; 5 operation starts per minute; one active AI operation per user across endpoints. Compare reserves 1–3 units upfront, not one batch unit. Ordinary reads, cache hits and saved-session reopening remain free. The same policies apply to anonymous Auth users where those users were already supported. New account creation can evade user quotas; IP tracking, new secrets, and shared-network penalties are intentionally deferred. The global budget is the backstop, not proof of account-abuse prevention.

429 responses retain the `success/error/data` envelope, identify the reason in `data.code`, and include `Retry-After`, `retry_after_seconds`, and `Cache-Control: private, no-store`. The database controls the clock. Store outages/missing migration fail closed with 503 and zero provider calls. An uncertain prior call returns 503; unfinished persistence can require retrying the original operation (409), rather than pretending a short timer will repair it.

## Input, output and provider bounds

Analyze and investigation JSON bodies are limited to 512 KiB actual streamed bytes, not trusted Content-Length. Analyze accepts at most 60k pasted resume characters, 30k JD characters (including persisted JD), and 200-character role/level fields. Follow-up answers are capped at 8000 characters. Oversized stored turn context is rejected before a new answer is written; complete assembled provider text is capped at 512 KiB. Recommendation's existing 60k-character bound remains. Inputs are rejected, never silently truncated or switched to another resume.

Resume files passed to OpenAI are capped at 5 MiB after the authorized download and before upload. This is an AI boundary, not a new Storage upload-size policy. Existing files larger than that need a smaller version for AI generation. Ownership and namespace guards remain mandatory. Compare pre-reads owned metadata for its source fingerprint and revalidates on download. Fingerprints assume the existing immutable `<user-id>/<timestamp>` upload convention. Out-of-band overwrites at the same object path are not detected by file-byte hashing; use a new object/resume reference for changed content.

Output-token caps: analysis 8192; comparison 1536/job; agent kickoff/follow-up 4096; recommendation 2400; Insights 800; Strategy 1600. All application provider uploads/generations have explicit 60-second timeouts and zero SDK retries. These output bounds have deterministic request coverage, not a live model-quality/truncation benchmark.

### Compare deployment-duration gate

`app/api/compare/route.ts` uses the default **Node.js** runtime and has no `runtime` or `maxDuration` export. There is no checked-in `vercel.json`; `next.config.ts` contains no duration override, and no other applicable source override was found. The local Next.js function configuration manifest contains no function entries; local build output is not evidence of hosted limits.

The owner verified **Hobby, 1 vCPU, 2 GB memory, and a project default maximum duration of 300 seconds** in the Vercel dashboard. The owner subsequently confirmed that the Preview Resources page identifies `/api/compare` as **Node.js 24.x with a maximum-duration ceiling of ≤300 seconds**. [Vercel documents a 300-second Hobby maximum with Fluid Compute](https://vercel.com/docs/functions/configuring-functions/duration). This is OWNER MANUALLY VERIFIED deployment evidence; a ceiling does not establish an exact 300-second execution allowance. Scoped API duration inspection remained unavailable (403). No repository/deployment mismatch was established; Production's resulting function configuration must be checked after deployment. The owner explicitly accepted remaining execution margin as a monitoring concern and authorized merge/Production deployment while generation remains disabled.

Up to three generations run sequentially, each with a 60-second timeout and zero SDK retries. Optional file upload has its own 60-second timeout: **180 seconds for text-only generation, or 240 seconds including upload**, plus authentication, body reading/validation, database reads/accounting, Storage download/materialization and response finalization. These other awaited operations have no explicit end-to-end deadline in the application path; 240 seconds is not a total worst-case request bound. A verified 300-second limit would provide nominal 60-second headroom for a file-backed batch, not a completion guarantee. No paid duration/load test was performed.

**Deployment disposition: owner authorized the disabled Production rollout with the duration margin retained as a monitoring concern.** Exact effective duration and real workload headroom are not claimed verified. Inspect the resulting Production configuration and monitor timeouts during separately approved canaries before expanding beta. Hobby cannot simply be increased above its supported maximum. If a shorter effective limit causes failures, first consider a separately approved supported 300-second per-function configuration and verify the resulting deployment. Shorter provider timeouts increase failures and uncertain billable outcomes; splitting the batch changes API aggregation/retry/accounting behavior, while asynchronous jobs add infrastructure. Do not implement any of these without separate approval. Platform termination or an SDK timeout does not establish provider cancellation: pending reservations and concurrency holds require reconciliation, not automatic refunds.

The provider adapter refuses calls without an active guard. Existing standalone evaluation scripts explicitly opt into unmetered evaluation; they are not HTTP endpoints and their spending is outside this ledger. Those scripts still require separate paid-call authorization during agent work. No benchmark or paid provider test was run for this PR.

## Cost policy: conservative admission, not an invoice guarantee

At [published GPT-4.1 prices](https://developers.openai.com/api/docs/models/gpt-4.1), uncached input is $2/million tokens and output $8/million. Receipts use these conservative uncached rates; discounts are not assumed. PDF file processing includes text and page images, so bytes/character heuristics do not establish the input cost. See [file input documentation](https://developers.openai.com/api/docs/guides/file-inputs).

Illustrative costs, **not measured usage**: analysis 12k input/4k output ≈ $0.056; three comparisons at 8k/600 each ≈ $0.062; kickoff 12k/1500 ≈ $0.036; follow-up 18k/1500 ≈ $0.048; recommendation 16k/1200 ≈ $0.042; Insights 2k/500 ≈ $0.008; Strategy 3k/900 ≈ $0.013.

Admission reserves the full model-context ceiling plus the bounded output allowance: $2.17/analysis, $2.13/gap generation, $2.11/comparison job, $2.12/other operation. This includes conservative headroom even for short text-only operations. A three-job Compare needs $6.33 available at admission. After reliable usage is checkpointed, unused allowance is released. Thus reservations are not actual costs, but they can reject legitimate low-cost work early. Raising the authoritative budget needs no code deployment.

The claim transaction enforces `today's settled estimated spend + all outstanding reservations + new reservation <= configured budget`. Outstanding reservations survive UTC resets. Known usage is attributed to the operation's admission day, not asserted to equal OpenAI's invoice/billing-day attribution. Lowering the setting does not retroactively revoke commitments already admitted. The kill switch prevents new dispatch authorization; it cannot cancel work already authorized or in flight.

This is a strict application admission boundary under the documented model/pricing assumptions, **not a guaranteed $10 OpenAI invoice cap**. Other applications/keys/scripts, standalone evaluations, pre-deployment in-flight calls, provider pricing changes, non-inference fees and billing timing are outside that guarantee. No built-in paid tools are enabled by these routes. An unsupported receipt/model fails closed. OpenAI budget alerts [do not themselves stop requests](https://developers.openai.com/api/docs/guides/terraform/rate-limits-and-spend). A dedicated CareerMind OpenAI project/key, provider rate limits, reconciliation and the application kill switch are recommended operational controls; none was changed by this PR.

## Retries, persistence and uncertainty

Canonical fingerprints are versioned; optional `Idempotency-Key` headers are validated and hashed. Keys are scoped to user and route; changed input under a bound key returns 409. Matching canonical input shares the existing operation even under another key; aliases are bound too, with a finite alias limit. Completed response replay is private and free for 24 hours. There is intentionally no force-regenerate endpoint in this increment. Different source/context constitutes new work and consumes new quota.

Follow-up UI requests include their preceding assistant-turn ID. This distinguishes duplicate submission from a legitimate later exchange containing the same words. Legacy callers should supply that field or a stable Idempotency-Key for reliable response-loss recovery. No client UUID is trusted as user identity.

Analysis, signals, gaps, plan and tasks commit in one transaction with an operation checkpoint. Investigation creation, user/assistant turns, validated evidence and conclusion updates use fixed transactional persistence actions. Turn indexes are checked against the current stored transcript. Retries restore the original context and saved provider output; they do not append the answer again or call OpenAI again. A new operation cannot append another user answer while a previous answer requires recovery.

Failure rules:

- Invalid inputs/authorization or size rejection before dispatch do not consume daily quota or budget. Short-window start protection may still count an admitted operation.
- Transient pre-dispatch failures may reuse the original reserved operation; abandoned claims are reclaimed/refunded only when there was no dispatch **and no investigation/user-answer write**.
- A provider request dispatched but conclusively rejected releases cost allowance, while its attempt still counts toward daily quota. Comparison jobs never dispatched are refunded on conclusive completion/failure.
- Successfully returned usage is charged even if model parsing/validation later fails. Repeating a terminal failed operation does not silently regenerate it.
- Recoverable database persistence failures retain operation identity and checkpoints so retry uses the existing quota and output.
- Network errors, timeouts, server errors or lost usage receipts retain their maximum cost reservation and concurrency protection. A timeout is not cancellation proof. Expired owner tokens are fenced before dispatch or persistence; uncertainty is not automatically refunded.

An opaque `X-Client-Request-Id` combines operation ID and call index; returned provider request IDs are checkpointed when available. This supports [provider-side investigation of ambiguous requests](https://developers.openai.com/api/reference/overview#debugging-requests) without identifiers such as emails or resume text. Operators must reconcile before releasing uncertain holds. Follow the [manual operator recovery procedure](ai-usage-recovery.md), including provider-outcome evidence, fencing and atomic accounting; do not clear holds by deleting records. A definitively failed provider response with an already-saved investigation answer can still require support; this PR preserves persisted data and refuses to pile on another answer, rather than inventing a response or regenerating automatically. There is no automatic support/reconciliation dashboard or generic recovery engine.

## Privacy and retention

The operational bucket/identity fields store no raw input, IP address, email, or resume text. Private recovery snapshots/replay data necessarily contain application/AI output and sometimes validated evidence/transcript context. Browser roles cannot read them; never log `steps` or `result`. Completed/terminal operations expire after 24 hours, with opportunistic deletion on claims; inactive systems retain them until the next claim, so this is not a timed deletion SLA. Settled buckets are retained for 30 days and pruned opportunistically. Unresolved reservations and recovery records are not automatically erased. Existing analysis/investigation/provider-file retention is unchanged.

## Verification completed

`npm run test:ai-usage` runs the actual migration and rollback in an isolated temporary local PostgreSQL cluster (verified on **17.6** and **16.15**). It tests independent database connections, all four RPC permission surfaces, quotas/reset, budgets, concurrency, fencing, aliases, receipt settlement, uncertainty, safe expiry, atomic finalization, retry recovery and real route handlers with network/provider doubles. The test fixture reproduces the 13 relevant public tables from the hosted PostgreSQL 17.6 inspection: physical column order/types/defaults/nullability, CHECK/FK/PK constraints, indexes, owner RLS policies and browser/service-role table grants. Auth users are ID-only stubs; Auth/Storage services and hosted extension/DDL event triggers are not emulated. No affected hosted table had user-defined row triggers or table rewrite rules. The suite uses the actual target migration and rollback, not duplicated accounting SQL.

Existing route suites still execute real guards/handlers. Their existing network fixtures now double the accounting RPC boundary separately; they do not claim to prove SQL atomicity. The new suite executes real SQL for that proof. No mocked output is presented as model-accuracy evidence.

During the original disposable pre-activation test run, no configured-project migration, policy or data change, paid OpenAI request, existing resume-content download, or Production deployment was performed. The subsequent separately approved hosted installation is recorded above; that historical test statement does not describe the current installation state. The pre-activation revision passes **339 application/security tests** on PostgreSQL **17.6**: usage guard 70; Compare 59; resume access 64; investigation navigation 47; analysis metadata 19; Action Plans 14; recommendation validation 49; Storage isolation 17. An additional **15 deterministic evaluation-metric assertions** pass; these do not call a model. The identical 70-test guard suite also passes PostgreSQL **16.15**, with no behavior differences observed. The earlier 61-test guard suite gained nine disabled-first/fixture assertions; no prior test was removed.

The exact PostgreSQL 17.6 source archive was downloaded from the official PostgreSQL server and verified against its published SHA-256, then built under disposable `/private/tmp`. No system service was installed. Both test clusters bind only Unix sockets and are stopped/deleted by the suite. The stricter fixture exposed a missing synthetic resume FK target in the successful Analyze test; seeding the corresponding local resume row corrected the fixture without relaxing constraints or changing application code. PG17's MAINTAIN privilege is reproduced for service_role; it is omitted only on PG16, where it does not exist and is not needed by the guard.

TypeScript, scoped ESLint for the changed test, and the local production build pass. The build retains the existing middleware-to-proxy deprecation warning. Previous scoped lint findings in unchanged Analyze/narrative files remain: 10 pre-existing no-explicit-any errors and one unused-variable warning; no suppressions or lint configuration changes were added here. Hosted verification on PostgreSQL 17.6 subsequently confirmed all three usage tables with RLS, all four RPC signatures/function bodies, effective table/function permissions, browser-role denial and the disabled flag/default. The owner successfully accessed the protected Preview with an authorized Vercel session and manually verified normal navigation. This is **OWNER MANUALLY VERIFIED navigation**, not a hosted AI endpoint test. All seven guarded routes returned `503 AI_DISABLED` with zero provider/upload/download calls in the prior 70-test **LOCAL SYNTHETIC VERIFIED** suite; this does not prove authenticated hosted AI rejection envelopes, headers or live provider behavior. **Hosted AI endpoint behavior, effective deployed Compare duration, real provider receipts/output quality, backup restoration and manual operator reconciliation remain unverified.** Documentation of recovery is not evidence that a shared-data repair was executed. No full regression suite was rerun for this documentation-only update.

## Installation completed; Production rollout and activation remain separate

Installation and hosted security verification are **completed**. Migration history records `20261103000001` once; do not reapply it, replay historical migrations, or install old Phase 2a migrations. Installation initialized the flag false atomically and did not authorize generation. The historical initial schema migration is empty; do not assume a full fresh replay represents the hosted database. The disposable PostgreSQL 17.6/16.15 rehearsal remains valid unless migration or prerequisites change; no additional SQL installation is part of deployment. No build/install script applies SQL automatically.

Latest read-only hosted snapshot, **2026-11-03 at 18:47:25 UTC**: `enabled=false`, budget 10,000,000 micro-USD, zero usage operations/buckets, zero uncertain operations and zero outstanding reservations. This is a dated observation, not a claim that future counts cannot change. Owner-confirmed Preview navigation is complete. Hosted AI endpoint verification remains incomplete; the owner has accepted the Compare duration margin as a monitoring concern for the authorized disabled rollout.

### Backup and restoration boundary

The latest inspected successful physical database backup is **2026-11-03 at 09:48:33 UTC**; PITR was disabled. The owner observed scheduled backups and Restore options in the Dashboard. Recheck the latest completed backup, available retention/restore access and acceptable recovery point immediately before release. Restoration has **not been rehearsed**; a backup listing does not prove a successful restore. Physical database recovery can affect Auth and Storage metadata but **does not restore original Storage object bytes**, including resumes. Preserve a separate Storage recovery strategy. Restoring old usage records can also rewind receipts/balances without reversing provider charges; follow the recovery runbook before resuming generation.

### Production rollout checklist — execution requires the recorded approvals

- [x] Record owner-confirmed Preview navigation and Compare Resources evidence (Node.js 24.x, ceiling ≤300 seconds). Owner accepted remaining execution margin as a monitoring concern; exact duration and paid workload testing are not claimed verified.
- [ ] Reconfirm project `pajpopmtkslwmfqzifoy`, `enabled=false`, latest completed database backup/recovery access, current Production SHA and approved PR head. Expected pre-release Production baseline: `a44732ed6e165e8e7a18ffa04d0edf578b6d69db`; stop for unexpected drift.
- [ ] Obtain **explicit owner approval to merge PR #13 and allow the automatic Vercel Production deployment**. Explain the maintenance window: guarded code while disabled returns **HTTP 503 for new uncached AI generation**; saved results/cache hits remain available. Invalid/unauthorized requests still fail their existing validation, and completed operation replay remains available.
- [ ] Only after approval, merge reviewed code into `main` and wait for the automatic deployment to become Ready. Do not rerun migrations or change settings. Record the actual resulting merge SHA; it can differ from the feature-branch head.
- [ ] Verify deployed Production commit, runtime/duration, ordinary navigation and safely constructed disabled-generation responses/envelopes/headers. Avoid requests that could create records or contact OpenAI; use synthetic evidence and explicitly mark any unsafe hosted case unverified.
- [ ] Assess/drain old unguarded in-flight work and access to older immutable/Preview deployments. The flag cannot constrain old unguarded code or cancel provider calls. Obtain separate approval for any access/configuration correction; do not silently restore unguarded code.
- [ ] Obtain **separate explicit owner approval to activate generation**, only after guarded Production verification. Local/Preview/Production share **one feature flag, quota ledger and application budget**; enabling the row enables every guarded deployment using this database, not Production alone.
- [ ] Only under that approval, enable generation. Controlled synthetic live provider canaries require **separately approved paid-call authorization**; do not treat merge/deployment or activation approval as paid-test approval.
- [ ] Check quotas, HTTP errors, timeouts, spent/reserved balances, uncertain operations and OpenAI spending after every canary. Expand beta only after reviewing results and remaining risks.
- [ ] If unhealthy, obtain approval to pause new generation with `enabled=false`, preserving accounting/receipt writes. Follow [manual recovery](ai-usage-recovery.md); use full permission-revoking rollback only with separate approval and an incident-specific reason. Never delete holds or automatically return to unguarded code.

### Manual beta monitoring ownership

The solo founder owns release/activation decisions, incident triage and approved reconciliation. Use existing Vercel logs, restricted aggregate SQL and OpenAI project usage; no new service, dashboard or scheduled job is required. Suggested manual cadence: after each controlled canary, every 10–15 minutes during the first rollout hour, then daily during beta and whenever an incident occurs.

- Check the flag and application budget, daily estimated `spent`, all outstanding `reserved`, operation states, `call_pending` and expired leases without exposing private output. Inspect older operation days too: reservations survive UTC reset.
- Inspect HTTP logs and response reason codes for 429 quota/burst/budget denials and persistent 503s. Denied admissions are not usage-operation records, so ledger aggregates alone cannot count denials. Expected `AI_DISABLED` during maintenance differs from unexpected `AI_USAGE_UNAVAILABLE`, `AI_OUTCOME_UNCERTAIN` or recurring `AI_IN_PROGRESS` holds.
- Compare application estimates with usage for the dedicated OpenAI project over the corresponding period; investigate differences as described in the recovery runbook. The **$10 daily admission budget is not a guaranteed OpenAI billing cap**.
- Any unexplained uncertain operation, expired pending call, balance discrepancy or persistent unexpected 503 warrants owner review and, if authorized, pausing generation. Elapsed time alone never justifies releasing a hold. Keep a restricted incident record without candidate content.

Authorized operator SQL examples (documentation only; **not executed on shared Supabase**):

```sql
-- Change allowance without a code deployment; amounts are integer micro-USD.
update public.ai_usage_settings set daily_budget_microusd = 20000000 where id=true;
-- Pause further generation; do not erase reservations.
update public.ai_usage_settings set enabled=false where id=true;
-- Read-only flag/budget and aggregate checks; never dump private snapshots/results.
select enabled, daily_budget_microusd from public.ai_usage_settings where id=true;
select day, spent / 1000000.0 as estimated_usd, reserved / 1000000.0 as reserved_usd
from public.ai_usage_buckets where subject='app' and category='budget' order by day desc;
select route,state,count(*) from public.ai_usage_operations group by route,state;
```

If installation fails before COMMIT, its DDL and seed roll back together; inspect both objects and migration history before retrying. Never run the operational rollback against absent tables or blindly repair migration history.

Fail-closed rollback: after explicit authorization, use `supabase/rollback/20261103000001_ai_usage_guard.sql`. It pauses generation and revokes dispatch/persistence RPC execution, preserving accounting/recovery data and all browser restrictions. It does not drop tables or refund unknown costs. It cannot cancel already dispatched provider calls; revoking checkpoint writes can leave additional uncertain holds. Keep original receipts and follow the [operator recovery procedure](ai-usage-recovery.md). Re-enabling requires reconciliation and restoring only the exact reviewed server-role grants before enabling. Do not roll back to unguarded application code while AI endpoints remain externally accessible.

**Pre-merge decision as of 2026-11-03: owner explicitly authorized merge and Production deployment while generation remains disabled, accepting the remaining Compare execution margin as a monitoring concern. This document records the pre-merge state, not a completed deployment. Reconfirm checks, Preview readiness and the disabled flag before merging; verify the resulting Production deployment afterward. Activation and paid canaries require subsequent separate approvals.**
