// Stage-1 eval CLI.
//
// Usage:
//   npm run eval                     # all scenarios, default agent model
//   npm run eval -- --scenario GI-03 # one scenario by id prefix
//   npm run eval -- --model gpt-4.1  # override agent model
//   npm run eval -- --skip-judges    # deterministic metrics only
//
// Does NOT auto-accept a baseline. Output lives under scripts/eval/reports/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnvLocal } from "./env";

// Env is loaded BEFORE the modules that transitively instantiate a
// Supabase client at import time (lib/supabase/admin.ts). All non-env
// imports from this harness go through the dynamic import inside
// main() so they resolve after process.env is populated.
loadDotEnvLocal();

import type { GoldenScenario, PricingTable, ScenarioResult } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = path.join(__dirname, "scenarios");
const PRICING_FILE = path.join(__dirname, "pricing.json");

function parseArgs(argv: string[]): {
  scenarioFilter: string | null;
  modelOverride: string | undefined;
  reasoningEffort: "low" | "medium" | "high" | undefined;
  skipJudges: boolean;
  runs: number;
} {
  let scenarioFilter: string | null = null;
  let modelOverride: string | undefined = undefined;
  let reasoningEffort: "low" | "medium" | "high" | undefined = undefined;
  let skipJudges = false;
  let runs = 1;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenario" && argv[i + 1]) scenarioFilter = argv[++i];
    else if (a === "--model" && argv[i + 1]) modelOverride = argv[++i];
    else if (a === "--reasoning-effort" && argv[i + 1]) {
      const v = argv[++i];
      if (v === "low" || v === "medium" || v === "high") reasoningEffort = v;
    } else if (a === "--skip-judges") skipJudges = true;
    else if (a === "--runs" && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) runs = n;
    }
  }
  return { scenarioFilter, modelOverride, reasoningEffort, skipJudges, runs };
}

function loadScenarios(filter: string | null): GoldenScenario[] {
  const files = fs
    .readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".json"));
  const out: GoldenScenario[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(SCENARIOS_DIR, f), "utf8");
    const sc = JSON.parse(raw) as GoldenScenario;
    if (filter && !sc.id.toLowerCase().includes(filter.toLowerCase())) continue;
    out.push(sc);
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function loadPricing(): PricingTable {
  try {
    const raw = JSON.parse(fs.readFileSync(PRICING_FILE, "utf8"));
    delete (raw as Record<string, unknown>)._note;
    return raw as PricingTable;
  } catch {
    return {};
  }
}

type DetMetrics = ScenarioResult["deterministic"];

function overallPassRubric(args: {
  scenario: GoldenScenario;
  det: DetMetrics;
  harnessErrors: string[];
}): { pass: boolean; passReasons: string[]; failReasons: string[] } {
  const passReasons: string[] = [];
  const failReasons: string[] = [];

  if (args.harnessErrors.length > 0) {
    failReasons.push("harness error");
    return { pass: false, passReasons, failReasons };
  }

  if (!args.det.classification_match)
    failReasons.push("classification mismatch");
  else passReasons.push("classification match");

  if (!args.det.underlying_capability_match)
    failReasons.push("underlying_capability mismatch");
  if (!args.det.resume_evidence_match)
    failReasons.push("resume_evidence mismatch");
  if (!args.det.target_role_fit_match)
    failReasons.push("target_role_fit mismatch");

  if (args.det.mentions_required_total > 0) {
    if (
      args.det.mentions_required_hits <
      args.det.mentions_required_total
    ) {
      failReasons.push(
        `residual_gap missing required mentions (${args.det.mentions_required_hits}/${args.det.mentions_required_total})`
      );
    } else {
      passReasons.push("residual_gap mentions ok");
    }
  }

  if (args.det.forbidden_mentions_hit > 0)
    failReasons.push(
      `forbidden claim(s) detected: ${args.det.forbidden_mentions_hit}`
    );

  if (args.det.grounding_violations > 0)
    failReasons.push(
      `grounding violation(s): ${args.det.grounding_violations}`
    );

  if (args.det.residual_gap_required_but_missing)
    failReasons.push(
      `residual_gap required for ${args.scenario.expected.classification} verdict but missing or trivially short`
    );

  if (!args.det.within_hard_max_turns)
    failReasons.push(
      `turn count ${args.det.turn_count} > hard_max ${args.scenario.expected.hard_max_turns}`
    );

  if (
    args.det.stop_reason === "scenario_cap_hit" ||
    args.det.stop_reason === "safety_cap_hit"
  ) {
    failReasons.push(`stop_reason=${args.det.stop_reason}`);
  }

  if (
    args.scenario.expected.expect_participation_vs_ownership_probe &&
    args.det.participation_vs_ownership_probe_present === false
  ) {
    failReasons.push("expected participation-vs-ownership probe not present");
  }

  return { pass: failReasons.length === 0, passReasons, failReasons };
}

async function main(): Promise<void> {
  const {
    scenarioFilter,
    modelOverride,
    reasoningEffort,
    skipJudges,
    runs,
  } = parseArgs(process.argv);

  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "OPENAI_API_KEY is not set (looked in .env.local and process env). Aborting."
    );
    process.exit(2);
  }

  // Dynamic imports — these pull in @/lib/supabase/admin which
  // instantiates a Supabase client at import time and needs
  // NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY present.
  const { AGENT_MODEL_NAME } = await import(
    "@/lib/gap-investigation/agent"
  );
  const { runScenarioAgent } = await import("./invoke-agent");
  const {
    scoreScenario,
    finalConclusion,
    finalHypothesisStatus,
  } = await import("./metrics/deterministic");
  const { runAllJudges } = await import("./judges");
  const { JUDGE_MODEL } = await import("./judges/_judge-client");
  const {
    aggregateScenarioRuns,
    estimateCost,
    makeReportDir,
    writeGroundingRejects,
    writeMultiRunSummary,
    writeRawJson,
    writeSummary,
    writeTrajectoryMarkdown,
  } = await import("./report");

  const scenarios = loadScenarios(scenarioFilter);
  if (scenarios.length === 0) {
    console.error("No scenarios matched the filter.");
    process.exit(1);
  }

  const effectiveModel = modelOverride ?? AGENT_MODEL_NAME;
  const pricing = loadPricing();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = makeReportDir(timestamp, effectiveModel);

  console.log(
    `[eval] running ${scenarios.length} scenario(s) × ${runs} run(s) against ${effectiveModel}${
      reasoningEffort ? ` (reasoning_effort=${reasoningEffort})` : ""
    }`
  );
  console.log(`[eval] report dir: ${reportDir}`);

  const allResults: ScenarioResult[] = [];
  const aggregates: Awaited<ReturnType<typeof aggregateScenarioRuns>>[] = [];

  for (const scenario of scenarios) {
    const perRunResults: ScenarioResult[] = [];
    for (let runIdx = 0; runIdx < runs; runIdx++) {
      const started_at = new Date().toISOString();
      const t0 = Date.now();
      console.log(
        `\n[eval] ▶ ${scenario.id} (run ${runIdx + 1}/${runs})`
      );

      const outcome = await runScenarioAgent({
        scenario,
        modelOverride,
        reasoningEffort,
        scenarioHardMax: scenario.expected.hard_max_turns,
      });
      const duration_ms = Date.now() - t0;

      const det = scoreScenario({
        scenario,
        trajectory: outcome.trajectory,
        stop_reason: outcome.stop_reason,
        gate_coercion_events: outcome.gate_coercion_events,
        repetition_events: outcome.repetition_events,
      });

      let judges: ScenarioResult["judges"] = null;
      let judge_input_tokens = 0;
      let judge_output_tokens = 0;
      let grounding_rejects: ScenarioResult["grounding_rejects"] = [];
      const harnessErrors = [...outcome.harness_errors];

      if (!skipJudges && outcome.stop_reason !== "harness_error") {
        try {
          const judgeTotals = await runAllJudges({
            scenario,
            trajectory: outcome.trajectory,
            run_index: runIdx,
          });
          judges = judgeTotals.metrics;
          judge_input_tokens = judgeTotals.usage.input_tokens;
          judge_output_tokens = judgeTotals.usage.output_tokens;
          grounding_rejects = judgeTotals.grounding_rejects;
          harnessErrors.push(...judgeTotals.errors);
        } catch (err) {
          harnessErrors.push(
            `judge orchestrator failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      const est_cost_usd = estimateCost({
        model: outcome.model,
        judgeModel: JUDGE_MODEL,
        input_tokens: outcome.usage_totals.input_tokens,
        output_tokens: outcome.usage_totals.output_tokens,
        judge_input_tokens,
        judge_output_tokens,
        pricing,
      });

      const final = finalConclusion(outcome.trajectory);
      const hyp = finalHypothesisStatus(outcome.trajectory);
      const rubric = overallPassRubric({
        scenario,
        det,
        harnessErrors,
      });

      const result: ScenarioResult = {
        scenario_id: scenario.id,
        title: scenario.title,
        category: scenario.category,
        model: outcome.model,
        started_at,
        duration_ms,
        stop_reason: outcome.stop_reason,
        turn_count: outcome.turn_count,
        trajectory: outcome.trajectory,
        deterministic: det,
        judges,
        usage_totals: outcome.usage_totals,
        est_cost_usd,
        overall_pass: rubric.pass,
        pass_reasons: rubric.passReasons,
        fail_reasons: rubric.failReasons,
        harness_errors: harnessErrors,
        grounding_rejects,
        run_index: runIdx,
        expected: scenario.expected,
        actual: {
          underlying_capability: final?.underlying_capability ?? null,
          resume_evidence: final?.resume_evidence ?? null,
          target_role_fit: final?.target_role_fit ?? null,
          classification: final?.classification ?? null,
          residual_gap: final?.residual_gap ?? null,
          hypothesis_status: (hyp as ScenarioResult["actual"]["hypothesis_status"]) ?? null,
        },
      };

      const runSuffix = `-run-${(runIdx + 1).toString().padStart(2, "0")}`;
      writeTrajectoryMarkdown({
        reportDir,
        scenarioId: `${scenario.id}${runSuffix}`,
        trajectory: outcome.trajectory,
      });

      perRunResults.push(result);
      allResults.push(result);
      console.log(
        `[eval]   ${rubric.pass ? "✅" : "❌"} turns=${result.turn_count} dur=${(duration_ms / 1000).toFixed(1)}s stop=${result.stop_reason} cls=${result.actual.classification}`
      );
    }
    aggregates.push(
      aggregateScenarioRuns({
        scenario_id: scenario.id,
        title: scenario.title,
        category: scenario.category,
        model: effectiveModel,
        runs: perRunResults,
        general_capability: scenario.assessment?.general_capability,
        target_specific_requirement:
          scenario.assessment?.target_specific_requirement,
      })
    );
  }

  writeRawJson({ reportDir, results: allResults });
  writeGroundingRejects({ reportDir, aggregates });
  const summary =
    runs > 1
      ? writeMultiRunSummary({
          reportDir,
          model: effectiveModel,
          judgeModel: JUDGE_MODEL,
          runs,
          aggregates,
        })
      : writeSummary({
          reportDir,
          model: effectiveModel,
          judgeModel: JUDGE_MODEL,
          results: allResults,
        });

  console.log(`\n[eval] report written to: ${reportDir}`);
  console.log(`\n----- summary.md -----\n`);
  console.log(summary);
}

main().catch((err) => {
  console.error("[eval] fatal:", err);
  process.exit(1);
});
