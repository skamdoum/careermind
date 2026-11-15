# Gap Investigation Agent — Eval Harness (Stage 1)

Deterministic multi-turn eval against the real production agent.

## Usage

```bash
npm run eval -- --model gpt-6-luna --reasoning-effort none --runs 3
npm run eval -- --scenario GI-03                # one scenario
OPENAI_JUDGE_MODEL=gpt-4.1-mini npm run eval -- --model gpt-4.1 # historical comparison
npm run eval -- --skip-judges                   # deterministic metrics only
```

Reports land under `scripts/eval/reports/<timestamp>-<model>/`:

- `summary.md` — aggregate + per-scenario table
- `raw.json` — full result set
- `trajectories/<scenario>.md` — turn-by-turn trace

The report directory is gitignored. Baselines are **not** auto-accepted.

## Determinism

The simulated user is rule-based (no LLM). Judges are LLM-driven but
scored over a trajectory already fixed by the deterministic user. If
the agent model is unchanged, the trajectory shape is reproducible.

## Scenarios

Each `scenarios/*.json` file is one scenario. Resumes live in
`resumes/*.txt` and are uploaded to OpenAI once (SHA-256 cached in
`.openai-file-ids.json`, also gitignored).

Stage 1 ships 5 scenarios. 7 more scheduled for Stage 2 pending the
seed-gap-validity taxonomy discussion.

## Phase 1 model configuration

All six production generation paths default to `gpt-6-luna`; judges independently
use the same default. `lib/openai/models.ts` reads `OPENAI_GENERATION_MODEL` and
`OPENAI_JUDGE_MODEL` on module load. Set overrides before starting the process;
restart/rebuild after changing them. No model picker or automatic fallback is added.
For rollback before retirement, set generation to `gpt-4.1` and judges to
`gpt-4.1-mini`. Historical model availability ends January 14, 2027.

Luna and Sol explicitly send `reasoning: { effort: "none" }` by default. The agent
CLI accepts `none`, `low`, `medium`, and `high`; an explicit override changes only
the agent under evaluation. Judges remain at `none`. Legacy GPT-4.1 requests omit
reasoning; historical o-series effort overrides remain supported. Plan assessment
omits temperature for GPT-6 and retains temperature zero for GPT-4.1 comparisons.
Prompts, schemas, rubrics, deterministic aggregation, narrative hashes/caches,
provider output caps, and request timeouts are unchanged.

Offline checks (no provider calls):

```sh
npm run test:openai-models
node --import tsx scripts/eval/tests/metrics.test.ts
npm run test:plan-recommendations
```

The following commands **make paid OpenAI calls**. They were not run during
implementation. The investigation runner loads `.env.local`; plan assessment uses
Node's env-file loader. Use synthetic fixtures and keep credentials out of reports.

```sh
# Candidate, three runs per scenario; Luna judges
OPENAI_JUDGE_MODEL=gpt-6-luna npm run eval -- --model gpt-6-luna --reasoning-effort none --runs 3
# Candidate evaluated with the historical judge, while still available
OPENAI_JUDGE_MODEL=gpt-4.1-mini npm run eval -- --model gpt-6-luna --reasoning-effort none --runs 3
# Quality challenger, same judge and disabled reasoning
OPENAI_JUDGE_MODEL=gpt-6-luna npm run eval -- --model gpt-6-sol --reasoning-effort none --runs 3
# Plan coverage assessment: production builder and unchanged 16 golden cases
OPENAI_GENERATION_MODEL=gpt-6-luna node --env-file=.env.local --import tsx scripts/eval/plan-recommendations/run.ts --live
```

Plan reports now use a unique timestamp/model directory rather than overwriting
`reports/plan-recommendations.json`. Existing reports remain untouched. Model
comparisons should hold the judge constant, then separately calibrate new judges
against saved trajectories and human review. These are model-quality gates, not
claims established by mocked compatibility tests.

Official model support and Standard short-context rates verified November 15, 2026:
[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) $0.10/$0.50 and
[Sol](https://developers.openai.com/api/docs/models/gpt-6-sol) $2/$10 input/output
per million tokens. Both support Responses, structured output and effort `none`.
[Compatibility guide](https://developers.openai.com/api/docs/guides/latest-model)
requires omitting temperature for non-`none` reasoning. Account-specific access
and model quality still require separate validation. Cost estimates omit cache
writes, long-context, regional and other processing premiums.

Before any hosted rollout, apply `20261115000001_openai_model_receipts.sql` through
the normal approved database process **before** releasing the application change.
It only replaces the usage-receipt function to accept/price Luna and Sol; table
structures, grants, quotas, disabled-by-default activation and existing policy
ceilings remain unchanged. Existing GPT-4.1 receipts still settle, including saved
responses recovered after migration. The existing ceiling may reject an unusually
expensive Sol call; Sol is an evaluation challenger, not the beta default.
Rollback can use the environment overrides without removing receipt support.
No hosted migration, activation, merge, deployment or paid benchmark was performed
as part of Phase 1 implementation.

## Bounded Luna pilot

Opt-in safeguards apply only to this evaluation command:

```sh
OPENAI_GENERATION_MODEL=gpt-6-luna OPENAI_JUDGE_MODEL=gpt-4.1-mini EVAL_SPEND_LIMIT_USD=5 node --import tsx scripts/eval/run.ts --bounded-pilot --model gpt-6-luna --reasoning-effort none --runs 1
```

This makes paid calls. Run only with explicit authorization. It requires all five
synthetic scenarios, one run each, Luna/none, and historical mini judges. Limits:
35 agent calls total (at most eight per scenario including kickoff), 200 judge
calls, five fresh text-fixture uploads no larger than 2 KiB each, 64 KiB serialized
agent inputs, 16 KiB judge inputs, 4096 agent output tokens and 1024 judge output
tokens. Existing scenario-specific turn caps remain authoritative. The simulated
user makes no model calls. All model/upload clients use zero automatic retries.

The transport is installed before SDK clients are created. It blocks other hosts,
API endpoints, retries, tools, streaming, background jobs and nonstandard tiers.
Both model IDs are checked via metadata GET before generation. File uploads are
fresh known-size text fixtures; the pilot preserves the historical upload cache.
SDK multipart support is declared with the native Response constructor to avoid
its local data-URL probe. No production network access or database writes are
allowed by the pilot transport.

Before dispatch, reserve the full per-request byte/token upper estimate, never
refunding reservations (including errors). Text tokens are bounded by serialized
UTF-8 bytes plus maximum fixture bytes and 4096 framing/schema tokens. A 50% cost
margin covers cache-write and estimation overhead. Each upload receives a further
$0.01 allowance even though plain user-data uploads have no generation fee. At
the current maximum fixture size of 1232 bytes, the maximum is $3.626516 versus
the $5 default operational threshold. Set a lower EVAL_SPEND_LIMIT_USD to refuse
runs whose complete estimate cannot fit; values above $5 are rejected. Estimates
use the official Standard input/output rates verified above, without cache-read
discounts. This is not a guaranteed provider billing cap or an account-wide limit.

Any HTTP/network error, incomplete/invalid receipt, input/call/budget limit or
harness incompatibility stops the pilot and blocks subsequent API requests.
`pilot-control.json` records limits, maximum estimate, retained reservations,
receipt-based token/cost/latency measurements and stop reason. Summary/raw reports
remain timestamped; historical reports are never overwritten. Agent scenario
latency excludes judge time; the control log also records per-request latency.

Offline validation (no paid calls): `npm run test:eval-pilot`.

### Single GI-01 diagnostic

With explicit authorization, run exactly GI-01 once under a $1 operational threshold:

```sh
OPENAI_GENERATION_MODEL=gpt-6-luna OPENAI_JUDGE_MODEL=gpt-4.1-mini EVAL_SPEND_LIMIT_USD=1 node --import tsx scripts/eval/run.ts --gi01-diagnostic --scenario GI-01 --model gpt-6-luna --reasoning-effort none --runs 1
```

This flag activates the guard itself; other scenarios, repeat runs, other models,
non-none reasoning, and skipped judges are rejected before dispatch. The profile
permits seven agent calls including kickoff, 40 judge calls and one fresh synthetic
text upload. Existing token/input caps, zero retries and immediate error stops
remain unchanged. Worst-case estimate for the 1049-byte GI-01 resume is
$0.72071905 with the existing 50% margin and upload allowance, below $1.

The control report retains response IDs/status/model, request IDs, raw outputs,
JSON/SDK-envelope inspection and per-request tokens, cost estimates and latency.
These inspections observe the response without changing production parsing or
schemas. `partial-trajectory.json` is checkpointed before later harness operations,
and `interrupted-outcome.json` plus the original exception stack are saved on a
caught failure. The fatal runner error is also retained in the control report.
Artifacts exclude request credentials and real user inputs; known secrets and
local identity paths are redacted while stack frames/line numbers remain useful.
Only synthetic GI-01 fixture data is sent. Do not automatically repeat a failed
diagnostic or interpret its operational threshold as a provider billing guarantee.
