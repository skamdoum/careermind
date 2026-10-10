# Gap Investigation Agent — Eval Harness (Stage 1)

Deterministic multi-turn eval against the real production agent.

## Usage

```bash
OPENAI_API_KEY=... npm run eval                 # all scenarios
npm run eval -- --scenario GI-03                # one scenario
npm run eval -- --model gpt-4.1                 # override agent model
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
