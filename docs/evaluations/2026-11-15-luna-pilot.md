# GPT-6 Luna pilot — November 15, 2026

Recommendation: investigate the agent/harness compatibility failure before another
live evaluation. No quality comparison is established by this incomplete pilot.
No production code, prompts, schemas, rubrics, database configuration or hosted
data was changed. PR #17 remains unmerged and undeployed.

## Controls and access

Branch: `codex/openai-luna-phase-1`. The opt-in evaluation guard limits the pilot
to five scenarios, one run each, 35 agent calls (at most eight per scenario), 200
judge calls and five synthetic text uploads. Input/output limits, zero retries,
pre-dispatch reservations and fail-closed stop conditions passed offline tests.
The conservative pre-run maximum was $3.626516, including 50% token-cost margin
and $0.05 upload allowance, below the $5 operational threshold. This is not a
provider billing guarantee or account-wide cap.

Both `gpt-6-luna` and `gpt-4.1-mini` metadata access checks succeeded. Official
Standard input/output prices were verified as $0.10/$0.50 per million Luna tokens
and $0.40/$1.60 per million mini tokens:
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/models/gpt-4.1-mini

An initial attempt stopped on the SDK's local multipart `data:,` feature probe,
with zero uploads/generation dispatched and zero estimated cost. The guard now
exposes the native Response constructor so the SDK skips that probe; an actual
SDK multipart upload was then tested offline. The single paid attempt below was
not repeated after its agent/harness failure.

## Measured pilot outcome

| Scenario | Luna result | Historical GPT-4.1 rubric passes |
| --- | --- | --- |
| GI-01 strong hidden evidence | Aborted: agent/harness error | 1/3 |
| GI-02 genuine capability gap | Not run | 3/3 |
| GI-03 scope mismatch | Not run | 0/3 |
| GI-05 participation vs ownership | Not run | 3/3 |
| GI-06 Senior to Principal | Not run | 3/3 |

Completed scenarios: 0/5. Agent requests: 2. Judge requests: 0. Synthetic uploads:
1. Both generation receipts reported completed status; the scenario runner then
returned harness errors. The original diagnostic saved only a generic stop reason,
so the exact parsing/runtime cause and partial trajectory cannot be reconstructed
from this run. This is an unresolved compatibility/harness failure, not a measured
classification or grounding regression. No automatic retries were performed.

| Luna request | Input tokens | Output tokens | Request latency | Estimated cost |
| --- | ---: | ---: | ---: | ---: |
| 1 | 5,306 | 826 | 7.517 s | $0.0009436 |
| 2 | 5,639 | 1,101 | 8.119 s | $0.0011144 |
| Total | 10,945 | 1,927 | 15.636 s | $0.0020580 |

Latencies measure transport/receipt time, not full completed-investigation latency.
Cost is calculated from reported token counts at uncached Standard prices, not an
invoice; cache writes/discounts and account billing can differ. Reservations
retained: $0.0374032. The unused budget did not authorize another paid attempt.

Deterministic classification accuracy, rubric pass rate, evidence-grounding
violations, repetition and stopping-quality metrics are unavailable: no complete
scenario result was saved. LLM-judge assessments are unavailable: no judges ran.
The safety mechanism stopped execution; that is distinct from the model's intended
investigation stopping behavior.

Control artifacts (gitignored, preserved locally):
- `scripts/eval/reports/2026-11-15T13-34-28-432Z-gpt-6-luna/pilot-control.json` (zero-call attempt)
- `scripts/eval/reports/2026-11-15T13-35-56-721Z-gpt-6-luna/pilot-control.json` (paid pilot)

## Historical reference and limits

The latest saved GPT-4.1 baseline is
`scripts/eval/reports/2026-10-10T15-54-53-457Z-gpt-4.1/`:
15 investigations (three per scenario), 10/15 rubric passes (66.7%), 14/15 correct
classifications (93.3%), judge grounding 144/146 (98.6%), two unnecessary questions
out of 12, zero repetition events and zero gate coercions. Mean investigation
duration was 20.7 seconds. These historical figures are not directly comparable
to two incomplete Luna requests; no performance improvement or degradation can
be concluded. Historical reports remain unchanged.

A future approved run will preserve interrupted outcomes and raw successful output
receipts for diagnosis. No production fix or additional live evaluation was made.
Obtain approval before investigating/fixing the compatibility failure and rerunning.
