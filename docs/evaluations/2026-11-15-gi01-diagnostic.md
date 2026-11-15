# GI-01 live diagnostic — November 15, 2026

**Result: GI-01 did not complete. The second provider response was incomplete and
contained repeated JSON plus unrelated trailing text.** The evaluation guard
stopped immediately. No retry, repeat of GI-01, judge call or other scenario ran.

## Execution and safeguards

Branch: `codex/openai-luna-phase-1`, PR #17. Candidate `gpt-6-luna`, reasoning
`none`; configured judge `gpt-4.1-mini`. Both model-access checks succeeded.

The new opt-in `--gi01-diagnostic` profile permits only GI-01, once. It retains
input/token caps and zero retries, limits calls to seven agent and 40 judge
requests, and permits one known-size synthetic text upload. The operational
threshold was $1. The conservative maximum was $0.72071905, including a 50% token
cost margin and $0.01 upload allowance. No production code, prompt, schema,
rubric, scoring, simulated-user behavior or database configuration was changed.

Before the live call, offline validation passed: 18 safeguard tests, seven failure
path tests, ten model tests, TypeScript and targeted lint. A subsequent accounting
regression increased the safeguard suite to 19 passing tests. No paid rerun was
performed after that change.

## Precise observed failure

1. Kickoff returned `completed`, a single parseable agent JSON object, and an
   ownership question. The existing simulator supplied its synthetic ownership
   answer. That assistant/user trajectory is preserved.
2. The second response returned `status: incomplete`, with 4,096 output tokens
   and zero reasoning tokens. 4,096 is exactly the configured output-token cap.
   Its message phase was `commentary`; kickoff's was `final_answer`.
3. The second message text was 22,146 characters. Its first JSON object ended at
   character offset 4,242, followed by unrelated Thai text and five additional
   `"action"` occurrences in repeated JSON. The final repetition was truncated.
   Inspecting the full text produced:

   `Unexpected non-whitespace character after JSON at position 4245 (line 1 column 4246)`

4. The transport guard rejected the incomplete receipt with
   `Error: Incomplete or invalid provider receipt`. The SDK wrapped the thrown
   fetch error as `Connection error.`; this was not evidence of network loss.
   The original SDK exception stack and terminal guard exception stack were
   saved with local identity paths redacted.

**Failure classification:** incomplete/malformed provider output, caught by the
evaluation transport. Production SDK interpretation/JSON parsing did not receive
the second response. The JSON error above is a read-only diagnostic of its saved
text, not a production-parser exception from this run. There is no evidence here
of a schema-assumption error, simulated-user failure or scenario-loop defect.

The token count, truncated text and status are consistent with output-limit
termination. The specific provider `incomplete_details.reason` was not retained
by the executing guard version, so its exact value cannot be asserted. What
initiated the repeated/unrelated output remains unknown. This diagnostic does
not prove the cause of the earlier two-completed-response pilot, whose bodies
were not saved.

## Observed usage and estimated cost

| Request | Input tokens | Output tokens | Status | Latency | Standard uncached estimate |
| --- | ---: | ---: | --- | --- | ---: |
| Kickoff | 5,306 | 931 | completed | 7.917 s | $0.0009961 |
| First follow-up | 5,631 | 4,096 | incomplete | Not retained | $0.0026111 |
| Total | 10,937 | 5,027 | Stopped | Not available | $0.0036072 |

These token counts are provider-reported observations. Costs use published
Standard uncached input/output prices; they are estimates, not invoices. The
incomplete response also reported cache hits/writes, so billed amounts may differ.
There were two agent calls, zero judge calls and one synthetic fixture upload.
Retained operational reservations were $0.0373483, below the $1 threshold.

The executing guard's `estimatedUsd` included only completed receipts and showed
$0.0009961. The separate analysis accounts for the incomplete receipt's preserved
usage as well. The guard now records valid usage, latency and incomplete details
before stopping on an incomplete response. An offline regression verifies that
behavior. The original control artifact was preserved unchanged. The failed-call
latency cannot be recovered from the retained fields; no extra call was made to
replace that missing measurement.

There is no completed deterministic classification/rubric score, repetition or
model-stopping metric, and no LLM-judge assessment. No scoring of a salvaged JSON
prefix was attempted.

## Artifacts and privacy

Local, gitignored artifact directory:
`scripts/eval/reports/2026-11-15T14-10-49-387Z-gpt-6-luna/`

- `pilot-control.json`: response metadata, raw outputs, diagnostic parsing result,
  original exception stacks, usage receipts and guard stop reason.
- `partial-trajectory.json` and `interrupted-outcome.json`: kickoff, simulated user
  answer and SDK exception stack.
- `diagnostic-analysis.json`: consolidated usage/cost and limitations above.

Only synthetic GI-01 fixture data was submitted. Requests/credentials were not
recorded. Known credentials and local identity paths are redacted during artifact
serialization; a local scan of all diagnostic files passed. Raw outputs are
synthetic-fixture content, not personal user data.

## Recommendation

Pause expanded evaluation. Retain the fail-closed behavior and use the saved
response/request IDs for provider investigation of the malformed structured
output. Do not automatically extract the first JSON object, relax the schema or
blindly raise the token cap to hide the repeated-output problem. Any corrective
experiment or further paid run requires separate authorization. Production
parser, prompts, schemas and scoring remain unchanged; no migration, merge or
deployment was performed.
