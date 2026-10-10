// Rescore a saved raw.json using the CURRENT deterministic metrics
// and rubric, without re-invoking the agent or the LLM judges. Useful
// to validate harness fixes against trajectories we already paid for.
//
// Usage:
//   npm run eval:rescore -- --report scripts/eval/reports/<dir>
//   npm run eval:rescore -- --report <dir1> --report <dir2>
//
// Writes alongside the original raw.json:
//   - rescored-summary.md     — before/after rubric and per-dimension diff
//   - rescored-raw.json       — the recomputed ScenarioResults
//
// Judges are NOT re-run. The stored judge metrics are carried through
// as-is, but a post-hoc scan flags any grounding reject whose rationale
// contradicts the output boolean (the known judge false-positive
// pattern Task 1b addresses).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnvLocal } from "./env";
loadDotEnvLocal();

import type {
  GoldenScenario,
  ScenarioResult,
  TrajectoryTurn,
} from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = path.join(__dirname, "scenarios");

function parseArgs(argv: string[]): string[] {
  const dirs: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--report" && argv[i + 1]) dirs.push(argv[++i]);
  }
  return dirs;
}

function loadScenario(id: string): GoldenScenario | null {
  const files = fs.readdirSync(SCENARIOS_DIR);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const raw = JSON.parse(
      fs.readFileSync(path.join(SCENARIOS_DIR, f), "utf8")
    );
    if (raw?.id === id) return raw as GoldenScenario;
  }
  return null;
}

// Phrases in a rationale that imply the claim IS supported.
const GROUNDED_PHRASES = [
  "is grounded",
  "accurately states",
  "accurately describe",
  "accurately describes",
  "aligns with",
  "supported by",
  "the resume supports",
  "the user did say",
  "matches the resume",
  "matches the user",
  "consistent with",
  "paraphrase of",
  "reflects the resume",
  "reflects the user",
];

function rationaleImpliesGrounded(rationale: string): boolean {
  const low = rationale.toLowerCase();
  for (const p of GROUNDED_PHRASES) {
    if (low.includes(p)) return true;
  }
  return false;
}

type RubricResult = {
  pass: boolean;
  failReasons: string[];
  passReasons: string[];
};

function overallPassRubric(args: {
  scenario: GoldenScenario;
  det: ScenarioResult["deterministic"];
  harnessErrors: string[];
}): RubricResult {
  const passReasons: string[] = [];
  const failReasons: string[] = [];

  if (args.harnessErrors.length > 0) {
    failReasons.push("harness error");
    return { pass: false, passReasons, failReasons };
  }
  if (!args.det.classification_match) failReasons.push("classification mismatch");
  else passReasons.push("classification match");
  if (!args.det.underlying_capability_match) failReasons.push("underlying_capability mismatch");
  if (!args.det.resume_evidence_match) failReasons.push("resume_evidence mismatch");
  if (!args.det.target_role_fit_match) failReasons.push("target_role_fit mismatch");
  if (args.det.mentions_required_total > 0) {
    if (args.det.mentions_required_hits < args.det.mentions_required_total) {
      failReasons.push(
        `residual_gap missing required mentions (${args.det.mentions_required_hits}/${args.det.mentions_required_total})`
      );
    } else {
      passReasons.push("residual_gap mentions ok");
    }
  }
  if (args.det.forbidden_mentions_hit > 0) {
    failReasons.push(`forbidden claim(s) detected: ${args.det.forbidden_mentions_hit}`);
  }
  if (args.det.grounding_violations > 0) {
    failReasons.push(`grounding violation(s): ${args.det.grounding_violations}`);
  }
  if (args.det.residual_gap_required_but_missing) {
    failReasons.push(
      `residual_gap required for ${args.scenario.expected.classification} verdict but missing or trivially short`
    );
  }
  if (!args.det.within_hard_max_turns) {
    failReasons.push(
      `turn count ${args.det.turn_count} > hard_max ${args.scenario.expected.hard_max_turns}`
    );
  }
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
  const dirs = parseArgs(process.argv);
  if (dirs.length === 0) {
    console.error(
      "Usage: npm run eval:rescore -- --report <report-dir> [--report <report-dir>]"
    );
    process.exit(2);
  }

  const { scoreScenario } = await import("./metrics/deterministic");

  for (const dir of dirs) {
    const rawPath = path.resolve(dir, "raw.json");
    if (!fs.existsSync(rawPath)) {
      console.error(`[rescore] skipping — missing raw.json at ${rawPath}`);
      continue;
    }
    const original = JSON.parse(fs.readFileSync(rawPath, "utf8")) as ScenarioResult[];
    const rescored: ScenarioResult[] = [];

    let origPass = 0;
    let newPass = 0;
    let flipGoodToBad = 0;
    let flipBadToGood = 0;
    const flipDetails: string[] = [];
    const judgeContradictionsFound: Array<{
      scenario: string;
      run: number;
      claim: string;
      rationale: string;
    }> = [];

    for (const r of original) {
      const scenario = loadScenario(r.scenario_id);
      if (!scenario) {
        console.warn(
          `[rescore] scenario ${r.scenario_id} not found in scenarios dir — carrying result through unchanged`
        );
        rescored.push(r);
        continue;
      }

      const det = scoreScenario({
        scenario,
        trajectory: r.trajectory as TrajectoryTurn[],
        stop_reason: r.stop_reason,
        gate_coercion_events: r.deterministic.gate_coercions,
        repetition_events: r.deterministic.repetition_events,
      });

      const rubric = overallPassRubric({
        scenario,
        det,
        harnessErrors: r.harness_errors ?? [],
      });

      // Scan existing grounding_rejects for rationale/verdict contradictions.
      for (const rej of r.grounding_rejects ?? []) {
        if (rationaleImpliesGrounded(rej.judge_rationale)) {
          judgeContradictionsFound.push({
            scenario: r.scenario_id,
            run: rej.run_index,
            claim: rej.claim,
            rationale: rej.judge_rationale,
          });
        }
      }

      if (r.overall_pass) origPass += 1;
      if (rubric.pass) newPass += 1;
      if (r.overall_pass && !rubric.pass) {
        flipGoodToBad += 1;
        flipDetails.push(
          `  - ${r.scenario_id} run ${r.run_index + 1}: PASS → FAIL (${rubric.failReasons.join("; ")})`
        );
      } else if (!r.overall_pass && rubric.pass) {
        flipBadToGood += 1;
        flipDetails.push(
          `  - ${r.scenario_id} run ${r.run_index + 1}: FAIL → PASS (was: ${r.fail_reasons.join("; ")})`
        );
      }

      rescored.push({
        ...r,
        deterministic: det,
        overall_pass: rubric.pass,
        pass_reasons: rubric.passReasons,
        fail_reasons: rubric.failReasons,
      });
    }

    const total = original.length;
    const summary: string[] = [];
    summary.push(`# Rescored evaluation report`);
    summary.push(``);
    summary.push(`- **Source:** \`${rawPath}\``);
    summary.push(`- **Rescored at:** ${new Date().toISOString()}`);
    summary.push(``);
    summary.push(`- **Rubric pass (original):** ${origPass}/${total}`);
    summary.push(`- **Rubric pass (rescored):** ${newPass}/${total}`);
    summary.push(
      `- **Flips:** ${flipBadToGood} FAIL→PASS, ${flipGoodToBad} PASS→FAIL`
    );
    summary.push(``);
    if (flipDetails.length > 0) {
      summary.push(`## Flipped runs`);
      summary.push(flipDetails.join("\n"));
      summary.push(``);
    }
    summary.push(`## Judge contradictions found in stored rejects`);
    summary.push(
      `Grounding rejects whose rationale implies the claim IS grounded (likely judge false positives Task 1b addresses — detected deterministically without re-invoking the judge):`
    );
    if (judgeContradictionsFound.length === 0) {
      summary.push(``);
      summary.push(`None detected.`);
    } else {
      summary.push(``);
      for (const c of judgeContradictionsFound) {
        summary.push(
          `- ${c.scenario} run ${c.run + 1}: "${c.claim.slice(0, 90)}…" — rationale: "${c.rationale.slice(0, 160)}…"`
        );
      }
    }
    summary.push(``);
    summary.push(`## Per-scenario comparison`);
    const byScenario = new Map<string, { orig: number; neu: number; total: number }>();
    for (const r of original) {
      const b = byScenario.get(r.scenario_id) ?? { orig: 0, neu: 0, total: 0 };
      b.orig += r.overall_pass ? 1 : 0;
      b.total += 1;
      byScenario.set(r.scenario_id, b);
    }
    for (const r of rescored) {
      const b = byScenario.get(r.scenario_id)!;
      b.neu += r.overall_pass ? 1 : 0;
    }
    for (const [id, b] of byScenario) {
      summary.push(
        `- ${id}: pass ${b.orig}/${b.total} → **${b.neu}/${b.total}**`
      );
    }

    const summaryText = summary.join("\n");
    const outSummary = path.join(dir, "rescored-summary.md");
    const outRaw = path.join(dir, "rescored-raw.json");
    fs.writeFileSync(outSummary, summaryText, "utf8");
    fs.writeFileSync(outRaw, JSON.stringify(rescored, null, 2), "utf8");

    console.log(`\n[rescore] ${dir}`);
    console.log(`  original pass:  ${origPass}/${total}`);
    console.log(`  rescored pass:  ${newPass}/${total}`);
    console.log(`  flips: ${flipBadToGood} FAIL→PASS, ${flipGoodToBad} PASS→FAIL`);
    console.log(
      `  judge-rationale contradictions found: ${judgeContradictionsFound.length}`
    );
    console.log(`  wrote ${outSummary}`);
  }
}

main().catch((err) => {
  console.error("[rescore] fatal:", err);
  process.exit(1);
});
