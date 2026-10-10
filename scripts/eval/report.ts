// Markdown + JSON report writers for an eval run.

import fs from "node:fs";
import path from "node:path";
import type {
  DimensionStat,
  GroundingReject,
  PricingTable,
  ScenarioAggregate,
  ScenarioResult,
  TrajectoryTurn,
} from "./types";

const REPORTS_ROOT = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "reports"
);

export function makeReportDir(timestamp: string, model: string): string {
  const slug = model.replace(/[^a-z0-9._-]+/gi, "_");
  const dir = path.join(REPORTS_ROOT, `${timestamp}-${slug}`);
  fs.mkdirSync(path.join(dir, "trajectories"), { recursive: true });
  return dir;
}

function money(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "n/a";
  return `$${n.toFixed(4)}`;
}

function pct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "n/a";
  return `${(n * 100).toFixed(1)}%`;
}

function num(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(2);
}

export function estimateCost(args: {
  model: string;
  judgeModel: string;
  input_tokens: number;
  output_tokens: number;
  judge_input_tokens: number;
  judge_output_tokens: number;
  pricing: PricingTable;
}): number | null {
  const agent = args.pricing[args.model];
  const judge = args.pricing[args.judgeModel];
  if (!agent && !judge) return null;
  let cost = 0;
  if (agent) {
    cost +=
      (args.input_tokens / 1_000_000) * agent.input_per_1m_usd +
      (args.output_tokens / 1_000_000) * agent.output_per_1m_usd;
  }
  if (judge) {
    cost +=
      (args.judge_input_tokens / 1_000_000) * judge.input_per_1m_usd +
      (args.judge_output_tokens / 1_000_000) * judge.output_per_1m_usd;
  }
  return cost;
}

export function writeTrajectoryMarkdown(args: {
  reportDir: string;
  scenarioId: string;
  trajectory: TrajectoryTurn[];
}): void {
  const lines: string[] = [];
  lines.push(`# Trajectory — ${args.scenarioId}\n`);
  for (const t of args.trajectory) {
    if (t.role === "assistant") {
      lines.push(`## Turn ${t.index} — assistant`);
      lines.push(`**content:** ${t.content}\n`);
      if (t.structured) {
        lines.push(`**action:** \`${t.structured.action}\``);
        if (t.structured.action === "ask_question") {
          lines.push(
            `**target_dimension:** \`${t.structured.next_question_target_dimension}\``
          );
        }
        if (t.structured.decision_state) {
          const ds = t.structured.decision_state;
          lines.push(
            `**decision_state:** uc=${ds.current_conclusion.underlying_capability}, re=${ds.current_conclusion.resume_evidence}, trf=${ds.current_conclusion.target_role_fit}, conf=${ds.decision_confidence}, hyp=${ds.hypothesis_status}, would_next_change=${ds.would_next_question_change_conclusion}`
          );
          lines.push(
            `**material_uncertainty:** ${ds.material_uncertainty || "(none)"}`
          );
        }
        if (t.structured.dimension_coverage) {
          const dc = t.structured.dimension_coverage;
          lines.push(
            `**coverage:** ownership=${dc.ownership.status}, scope=${dc.scope.status}, complexity=${dc.complexity.status}, outcome=${dc.outcome.status}, target_role_fit=${dc.target_role_fit.status}`
          );
        }
        if (t.structured.action === "stop_and_conclude") {
          const c = t.structured.conclusion;
          lines.push(`**classification:** \`${c.classification}\``);
          lines.push(
            `**underlying/resume/trf:** ${c.underlying_capability} / ${c.resume_evidence} / ${c.target_role_fit}`
          );
          lines.push(`**residual_gap:** ${c.residual_gap || "(empty)"}`);
          lines.push(`**summary:** ${c.summary}`);
        }
        if (
          t.structured.candidate_evidence &&
          t.structured.candidate_evidence.length > 0
        ) {
          lines.push(`**candidate_evidence:**`);
          for (const ev of t.structured.candidate_evidence) {
            lines.push(
              `- \`${ev.source_type}/${ev.evidence_level}\` ${ev.claim}` +
                (ev.resume_excerpt ? ` — excerpt: "${ev.resume_excerpt}"` : "")
            );
          }
        }
        if (t.usage) {
          lines.push(
            `**usage:** in=${t.usage.input_tokens}, out=${t.usage.output_tokens}, latency=${t.latency_ms}ms, model=${t.model}`
          );
        }
      }
      lines.push("");
    } else {
      lines.push(`## Turn ${t.index} — user (rule: ${t.matched_rule_id})`);
      lines.push(t.content);
      lines.push("");
    }
  }
  fs.writeFileSync(
    path.join(args.reportDir, "trajectories", `${args.scenarioId}.md`),
    lines.join("\n"),
    "utf8"
  );
}

export function writeSummary(args: {
  reportDir: string;
  model: string;
  judgeModel: string;
  results: ScenarioResult[];
}): string {
  const passed = args.results.filter((r) => r.overall_pass).length;
  const total = args.results.length;
  const totalIn = args.results.reduce(
    (s, r) => s + r.usage_totals.input_tokens,
    0
  );
  const totalOut = args.results.reduce(
    (s, r) => s + r.usage_totals.output_tokens,
    0
  );
  const totalCost = args.results.reduce(
    (s, r) => s + (r.est_cost_usd ?? 0),
    0
  );
  const avgTurns =
    args.results.reduce((s, r) => s + r.turn_count, 0) / Math.max(1, total);
  const avgLatency =
    args.results.reduce((s, r) => s + r.duration_ms, 0) / Math.max(1, total);

  const lines: string[] = [];
  lines.push(`# Gap Investigation Agent — Eval Report`);
  lines.push(``);
  lines.push(`- **Timestamp:** ${new Date().toISOString()}`);
  lines.push(`- **Agent model:** \`${args.model}\``);
  lines.push(`- **Judge model:** \`${args.judgeModel}\``);
  lines.push(`- **Scenarios:** ${total}`);
  lines.push(`- **Passed (deterministic rubric):** ${passed} / ${total}`);
  lines.push(
    `- **Avg turns:** ${num(avgTurns)}   •   **Avg duration:** ${(avgLatency / 1000).toFixed(1)}s`
  );
  lines.push(
    `- **Total tokens:** in=${totalIn.toLocaleString()}, out=${totalOut.toLocaleString()}`
  );
  lines.push(`- **Est. total cost:** ${money(totalCost)}`);
  lines.push(``);
  lines.push(`## Per-scenario results`);
  lines.push(``);
  lines.push(
    `| ID | Pass | Expected → Actual | Turns | Unneeded Qs | Grounding | Repetition | Gate coerce | Latency | Tokens | Cost |`
  );
  lines.push(
    `|---|---|---|---|---|---|---|---|---|---|---|`
  );
  for (const r of args.results) {
    const exp = `${r.expected.classification} / uc=${r.expected.underlying_capability} / re=${r.expected.resume_evidence} / trf=${r.expected.target_role_fit}`;
    const act = `${r.actual.classification ?? "?"} / uc=${r.actual.underlying_capability ?? "?"} / re=${r.actual.resume_evidence ?? "?"} / trf=${r.actual.target_role_fit ?? "?"}`;
    const judges = r.judges;
    const unneeded = judges
      ? `${judges.unnecessary_question_count}/${judges.unnecessary_question_total}`
      : "n/a";
    const grounding = judges
      ? `${judges.grounding_pass}/${judges.grounding_total} (${pct(
          judges.grounding_pass_rate
        )})`
      : "n/a";
    const tokens = `${r.usage_totals.input_tokens}/${r.usage_totals.output_tokens}`;
    lines.push(
      `| ${r.scenario_id} | ${r.overall_pass ? "✅" : "❌"} | ${exp}  →  ${act} | ${r.turn_count} | ${unneeded} | ${grounding} | ${r.deterministic.repetition_events} | ${r.deterministic.gate_coercions} | ${(r.duration_ms / 1000).toFixed(1)}s | ${tokens} | ${money(r.est_cost_usd)} |`
    );
  }
  lines.push(``);
  lines.push(`## Scenario detail`);
  for (const r of args.results) {
    lines.push(``);
    lines.push(`### ${r.scenario_id}`);
    lines.push(`${r.title}`);
    lines.push(``);
    lines.push(`- **Stop reason:** \`${r.stop_reason}\``);
    lines.push(
      `- **Mentions required:** ${r.deterministic.mentions_required_hits}/${r.deterministic.mentions_required_total}`
    );
    lines.push(
      `- **Forbidden-claim hits:** ${r.deterministic.forbidden_mentions_hit}`
    );
    lines.push(
      `- **Grounding violations (deterministic):** ${r.deterministic.grounding_violations}`
    );
    if (
      r.deterministic.kickoff_hypothesis_challenge_present !== null
    ) {
      lines.push(
        `- **Kickoff hypothesis challenge:** ${r.deterministic.kickoff_hypothesis_challenge_present ? "yes" : "no"}`
      );
    }
    if (
      r.deterministic.participation_vs_ownership_probe_present !== null
    ) {
      lines.push(
        `- **Participation-vs-ownership probe present:** ${r.deterministic.participation_vs_ownership_probe_present ? "yes" : "no"}`
      );
    }
    if (r.judges) {
      lines.push(
        `- **Judges:** question_relevance_avg=${num(r.judges.question_relevance_avg)}, residual_gap_quality=${num(r.judges.residual_gap_quality)}, summary_quality=${num(r.judges.summary_quality)}, grounding_pass_rate=${pct(r.judges.grounding_pass_rate)}, unnecessary=${r.judges.unnecessary_question_count}/${r.judges.unnecessary_question_total}`
      );
    }
    if (r.pass_reasons.length > 0) {
      lines.push(`- **Pass reasons:** ${r.pass_reasons.join("; ")}`);
    }
    if (r.fail_reasons.length > 0) {
      lines.push(`- **Fail reasons:** ${r.fail_reasons.join("; ")}`);
    }
    if (r.harness_errors.length > 0) {
      lines.push(`- **HARNESS ERRORS:** ${r.harness_errors.join("; ")}`);
    }
    lines.push(
      `- **Trajectory:** \`trajectories/${r.scenario_id}.md\``
    );
  }
  const text = lines.join("\n");
  fs.writeFileSync(path.join(args.reportDir, "summary.md"), text, "utf8");
  return text;
}

export function writeRawJson(args: {
  reportDir: string;
  results: ScenarioResult[];
}): void {
  fs.writeFileSync(
    path.join(args.reportDir, "raw.json"),
    JSON.stringify(args.results, null, 2),
    "utf8"
  );
}

// -----------------------------------------------------------------
// Multi-run aggregation and reporting.
// -----------------------------------------------------------------

export function computeDimensionStat(args: {
  expected: string;
  values: Array<string | null>;
}): DimensionStat {
  const total = args.values.length;
  const distribution: Record<string, number> = {};
  let matches = 0;
  for (const raw of args.values) {
    const v = raw ?? "(null)";
    distribution[v] = (distribution[v] ?? 0) + 1;
    if (v === args.expected) matches += 1;
  }
  let modal_value = "(null)";
  let modal_count = 0;
  for (const [k, v] of Object.entries(distribution)) {
    if (v > modal_count) {
      modal_value = k;
      modal_count = v;
    }
  }
  return {
    expected: args.expected,
    matches,
    total,
    match_pct: total > 0 ? (matches / total) * 100 : 0,
    distribution,
    modal_value,
    modal_count,
    stability_pct: total > 0 ? (modal_count / total) * 100 : 0,
  };
}

export function aggregateScenarioRuns(args: {
  scenario_id: string;
  title: string;
  category: string;
  model: string;
  runs: ScenarioResult[];
  general_capability?: string;
  target_specific_requirement?: string;
}): ScenarioAggregate {
  const { runs } = args;

  const classification = computeDimensionStat({
    expected: runs[0].expected.classification,
    values: runs.map((r) => r.actual.classification),
  });
  const underlying = computeDimensionStat({
    expected: runs[0].expected.underlying_capability,
    values: runs.map((r) => r.actual.underlying_capability),
  });
  const resumeEv = computeDimensionStat({
    expected: runs[0].expected.resume_evidence,
    values: runs.map((r) => r.actual.resume_evidence),
  });
  const trf = computeDimensionStat({
    expected: runs[0].expected.target_role_fit,
    values: runs.map((r) => r.actual.target_role_fit),
  });

  const turns_distribution: Record<string, number> = {};
  for (const r of runs) {
    const k = String(r.turn_count);
    turns_distribution[k] = (turns_distribution[k] ?? 0) + 1;
  }

  const sum = <K extends keyof ScenarioResult>(k: K, pick: (r: ScenarioResult) => number) =>
    runs.reduce((s, r) => s + pick(r), 0);

  const input_tokens_total = sum(
    "usage_totals",
    (r) => r.usage_totals.input_tokens
  );
  const output_tokens_total = sum(
    "usage_totals",
    (r) => r.usage_totals.output_tokens
  );
  const costVals = runs.map((r) => r.est_cost_usd);
  const est_cost_usd_total = costVals.every((c) => c === null)
    ? null
    : costVals.reduce((s: number, c) => s + (c ?? 0), 0);

  return {
    scenario_id: args.scenario_id,
    title: args.title,
    category: args.category,
    model: args.model,
    total_runs: runs.length,
    rubric_passed_runs: runs.filter((r) => r.overall_pass).length,
    dimension_stats: {
      classification,
      underlying_capability: underlying,
      resume_evidence: resumeEv,
      target_role_fit: trf,
    },
    turns_distribution,
    avg_turns:
      runs.reduce((s, r) => s + r.turn_count, 0) / Math.max(1, runs.length),
    avg_duration_ms:
      runs.reduce((s, r) => s + r.duration_ms, 0) / Math.max(1, runs.length),
    input_tokens_total,
    output_tokens_total,
    est_cost_usd_total,
    repetition_events_total: runs.reduce(
      (s, r) => s + r.deterministic.repetition_events,
      0
    ),
    gate_coercions_total: runs.reduce(
      (s, r) => s + r.deterministic.gate_coercions,
      0
    ),
    unnecessary_question_total: runs.reduce(
      (s, r) => s + (r.judges?.unnecessary_question_total ?? 0),
      0
    ),
    unnecessary_question_count: runs.reduce(
      (s, r) => s + (r.judges?.unnecessary_question_count ?? 0),
      0
    ),
    grounding_pass_total: runs.reduce(
      (s, r) => s + (r.judges?.grounding_pass ?? 0),
      0
    ),
    grounding_claim_total: runs.reduce(
      (s, r) => s + (r.judges?.grounding_total ?? 0),
      0
    ),
    grounding_rejects: runs.flatMap((r) => r.grounding_rejects),
    mentions_hits_total: runs.reduce(
      (s, r) => s + r.deterministic.mentions_required_hits,
      0
    ),
    mentions_required_total: runs.reduce(
      (s, r) => s + r.deterministic.mentions_required_total,
      0
    ),
    runs,
    general_capability: args.general_capability,
    target_specific_requirement: args.target_specific_requirement,
    residual_gap_missing_total: runs.filter(
      (r) => r.deterministic.residual_gap_required_but_missing
    ).length,
  };
}

function distString(dist: Record<string, number>): string {
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => `${k}×${v}`).join(", ");
}

function dimRow(label: string, s: DimensionStat): string {
  return `| ${label} | \`${s.expected}\` | ${s.matches}/${s.total} (${s.match_pct.toFixed(0)}%) | ${distString(s.distribution)} | \`${s.modal_value}\` | ${s.stability_pct.toFixed(0)}% |`;
}

export function writeMultiRunSummary(args: {
  reportDir: string;
  model: string;
  judgeModel: string;
  runs: number;
  aggregates: ScenarioAggregate[];
}): string {
  const totalRuns = args.aggregates.reduce(
    (s, a) => s + a.total_runs,
    0
  );
  const totalPasses = args.aggregates.reduce(
    (s, a) => s + a.rubric_passed_runs,
    0
  );
  const totalIn = args.aggregates.reduce(
    (s, a) => s + a.input_tokens_total,
    0
  );
  const totalOut = args.aggregates.reduce(
    (s, a) => s + a.output_tokens_total,
    0
  );
  const totalCost = args.aggregates.reduce(
    (s, a) => s + (a.est_cost_usd_total ?? 0),
    0
  );

  // Suite-level dimension aggregates
  const dimTotals = {
    classification: { matches: 0, total: 0 },
    underlying_capability: { matches: 0, total: 0 },
    resume_evidence: { matches: 0, total: 0 },
    target_role_fit: { matches: 0, total: 0 },
  };
  for (const a of args.aggregates) {
    (
      [
        "classification",
        "underlying_capability",
        "resume_evidence",
        "target_role_fit",
      ] as const
    ).forEach((k) => {
      dimTotals[k].matches += a.dimension_stats[k].matches;
      dimTotals[k].total += a.dimension_stats[k].total;
    });
  }
  const dimPct = (k: keyof typeof dimTotals) =>
    dimTotals[k].total > 0
      ? ((dimTotals[k].matches / dimTotals[k].total) * 100).toFixed(0)
      : "n/a";

  const totalRepetition = args.aggregates.reduce(
    (s, a) => s + a.repetition_events_total,
    0
  );
  const totalGate = args.aggregates.reduce(
    (s, a) => s + a.gate_coercions_total,
    0
  );
  const totalUnneededTotal = args.aggregates.reduce(
    (s, a) => s + a.unnecessary_question_total,
    0
  );
  const totalUnneededCount = args.aggregates.reduce(
    (s, a) => s + a.unnecessary_question_count,
    0
  );
  const totalGroundingPass = args.aggregates.reduce(
    (s, a) => s + a.grounding_pass_total,
    0
  );
  const totalGroundingClaims = args.aggregates.reduce(
    (s, a) => s + a.grounding_claim_total,
    0
  );
  const totalMentionsHit = args.aggregates.reduce(
    (s, a) => s + a.mentions_hits_total,
    0
  );
  const totalMentionsReq = args.aggregates.reduce(
    (s, a) => s + a.mentions_required_total,
    0
  );
  const avgTurnsAcrossRuns =
    args.aggregates.reduce(
      (s, a) => s + a.runs.reduce((ss, r) => ss + r.turn_count, 0),
      0
    ) / Math.max(1, totalRuns);
  const avgDurAcrossRuns =
    args.aggregates.reduce(
      (s, a) => s + a.runs.reduce((ss, r) => ss + r.duration_ms, 0),
      0
    ) / Math.max(1, totalRuns);

  const lines: string[] = [];
  lines.push(`# Gap Investigation Agent — Multi-Run Eval Report`);
  lines.push(``);
  lines.push(`- **Timestamp:** ${new Date().toISOString()}`);
  lines.push(`- **Agent model:** \`${args.model}\``);
  lines.push(`- **Judge model:** \`${args.judgeModel}\``);
  lines.push(`- **Scenarios:** ${args.aggregates.length}`);
  lines.push(`- **Runs per scenario:** ${args.runs}`);
  lines.push(`- **Total investigations:** ${totalRuns}`);
  lines.push(``);
  lines.push(`## Suite-level aggregates`);
  lines.push(``);
  lines.push(
    `- **Rubric pass rate:** ${totalPasses} / ${totalRuns} (${((totalPasses / Math.max(1, totalRuns)) * 100).toFixed(0)}%)`
  );
  lines.push(`- **Classification accuracy:** ${dimPct("classification")}%`);
  lines.push(
    `- **underlying_capability accuracy:** ${dimPct("underlying_capability")}%`
  );
  lines.push(
    `- **resume_evidence accuracy:** ${dimPct("resume_evidence")}%`
  );
  lines.push(
    `- **target_role_fit accuracy:** ${dimPct("target_role_fit")}%`
  );
  lines.push(
    `- **Residual-gap required mentions hit:** ${totalMentionsHit}/${totalMentionsReq}`
  );
  lines.push(
    `- **Grounding (judge) pass rate:** ${totalGroundingPass}/${totalGroundingClaims} (${((totalGroundingPass / Math.max(1, totalGroundingClaims)) * 100).toFixed(1)}%)`
  );
  lines.push(
    `- **Unnecessary questions:** ${totalUnneededCount}/${totalUnneededTotal}`
  );
  lines.push(`- **Repetition events:** ${totalRepetition}`);
  lines.push(`- **Gate coercions:** ${totalGate}`);
  lines.push(
    `- **Avg turns:** ${avgTurnsAcrossRuns.toFixed(2)}   •   **Avg duration:** ${(avgDurAcrossRuns / 1000).toFixed(1)}s`
  );
  lines.push(
    `- **Total tokens:** in=${totalIn.toLocaleString()}, out=${totalOut.toLocaleString()}`
  );
  lines.push(`- **Est. total cost:** ${money(totalCost)}`);
  lines.push(``);

  const totalResidualMissing = args.aggregates.reduce(
    (s, a) => s + (a.residual_gap_missing_total ?? 0),
    0
  );
  lines.push(`- **Residual-gap missing on gap verdicts:** ${totalResidualMissing}`);
  lines.push(``);

  for (const a of args.aggregates) {
    lines.push(`## ${a.scenario_id}`);
    lines.push(a.title);
    lines.push(``);
    if (a.general_capability) {
      lines.push(`- **General capability assessed:** ${a.general_capability}`);
    }
    if (a.target_specific_requirement) {
      lines.push(
        `- **Target-specific requirement:** ${a.target_specific_requirement}`
      );
    }
    lines.push(
      `- **Rubric pass:** ${a.rubric_passed_runs}/${a.total_runs}`
    );
    if (a.residual_gap_missing_total > 0) {
      lines.push(
        `- **Residual-gap missing on gap verdict:** ${a.residual_gap_missing_total}/${a.total_runs}`
      );
    }
    lines.push(
      `- **Avg turns:** ${a.avg_turns.toFixed(2)}   •   **Avg duration:** ${(a.avg_duration_ms / 1000).toFixed(1)}s`
    );
    lines.push(
      `- **Tokens total:** in=${a.input_tokens_total.toLocaleString()}, out=${a.output_tokens_total.toLocaleString()}   •   **Cost:** ${money(a.est_cost_usd_total)}`
    );
    lines.push(
      `- **Repetition:** ${a.repetition_events_total}   •   **Gate coerce:** ${a.gate_coercions_total}`
    );
    lines.push(
      `- **Unnecessary Qs:** ${a.unnecessary_question_count}/${a.unnecessary_question_total}`
    );
    lines.push(
      `- **Grounding:** ${a.grounding_pass_total}/${a.grounding_claim_total}` +
        ` (${a.grounding_rejects.length} rejects — see grounding-rejects.md)`
    );
    lines.push(
      `- **Residual-gap mentions hit:** ${a.mentions_hits_total}/${a.mentions_required_total}`
    );
    lines.push(``);
    lines.push(
      `| dimension | expected | match | distribution | modal | stability |`
    );
    lines.push(`|---|---|---|---|---|---|`);
    lines.push(dimRow("classification", a.dimension_stats.classification));
    lines.push(
      dimRow("underlying_capability", a.dimension_stats.underlying_capability)
    );
    lines.push(dimRow("resume_evidence", a.dimension_stats.resume_evidence));
    lines.push(dimRow("target_role_fit", a.dimension_stats.target_role_fit));
    lines.push(``);
    lines.push(
      `- **Turns distribution:** ${distString(a.turns_distribution)}`
    );
    lines.push(
      `- **Trajectories:** ${a.runs
        .map(
          (r) =>
            `\`trajectories/${a.scenario_id}-run-${(r.run_index + 1).toString().padStart(2, "0")}.md\``
        )
        .join(", ")}`
    );
    lines.push(``);
  }

  const text = lines.join("\n");
  fs.writeFileSync(path.join(args.reportDir, "summary.md"), text, "utf8");
  return text;
}

export function writeGroundingRejects(args: {
  reportDir: string;
  aggregates: ScenarioAggregate[];
}): void {
  const lines: string[] = [];
  lines.push(`# Grounding Judge — Rejected Claims`);
  lines.push(``);
  lines.push(
    `For each item the grounding LLM judge marked \`grounded=false\`. The judge prompt and production behavior are unchanged — this is inspection only.`
  );
  lines.push(``);

  let total = 0;
  for (const a of args.aggregates) {
    const rejects = a.grounding_rejects;
    if (rejects.length === 0) continue;
    total += rejects.length;
    lines.push(`## ${a.scenario_id}  (${rejects.length} reject(s))`);
    lines.push(``);
    rejects.forEach((r: GroundingReject, i: number) => {
      lines.push(
        `### Reject ${i + 1} — run ${r.run_index + 1}, turn ${r.turn_index}`
      );
      lines.push(``);
      lines.push(
        `- **source_type:** \`${r.source_type}\`   •   **evidence_level:** \`${r.evidence_level ?? "n/a"}\`   •   **origin_user_turn_index:** ${r.origin_user_turn_index}`
      );
      lines.push(`- **claim:** ${r.claim}`);
      if (r.resume_excerpt) {
        lines.push(`- **resume_excerpt:** ${r.resume_excerpt}`);
      }
      lines.push(`- **judge_rationale:** ${r.judge_rationale}`);
      lines.push(``);
    });
  }
  if (total === 0) {
    lines.push(`No grounding rejects recorded.`);
  }
  fs.writeFileSync(
    path.join(args.reportDir, "grounding-rejects.md"),
    lines.join("\n"),
    "utf8"
  );
}
