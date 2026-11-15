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
