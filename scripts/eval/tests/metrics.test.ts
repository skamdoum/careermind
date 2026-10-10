// Regression tests for the deterministic metric fixes.
//
// Run with:  tsx scripts/eval/tests/metrics.test.ts
//
// Covers:
//   1. OR-group semantic coverage — "resume does not provide X" style
//      phrasings must satisfy the GI-01-style resume-absence OR-group.
//   2. Forbidden-claims discrimination — a positive candidate_evidence
//      claim containing a forbidden phrase is flagged; a summary or an
//      absence (evidence_level="none") claim mentioning the same phrase
//      in a negated frame is NOT flagged.
//   3. Residual-gap non-empty rubric — evidence_gap / capability_gap /
//      scope_mismatch verdicts with empty residual_gap must be flagged.
//
// No LLM calls. No OpenAI. No Supabase. Loads .env.local only because
// the import chain for @/lib/gap-investigation/agent transitively pulls
// in the Supabase admin client.

import { loadDotEnvLocal } from "../env";
loadDotEnvLocal();

import type {
  AgentTurnOutput,
} from "@/lib/gap-investigation/agent";
import type { GoldenScenario, TrajectoryTurn } from "../types";

async function main(): Promise<void> {
  const { scoreScenario } = await import("../metrics/deterministic");

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  const assert = (label: string, cond: boolean, detail = ""): void => {
    if (cond) {
      passed += 1;
      console.log(`  ✓ ${label}`);
    } else {
      failed += 1;
      failures.push(`${label}${detail ? " — " + detail : ""}`);
      console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    }
  };

  // Shared factory: build a minimal GoldenScenario + a single-assistant
  // trajectory with an injected final conclusion + candidate_evidence.
  function makeCase(args: {
    expected: GoldenScenario["expected"];
    conclusion: AgentTurnOutput["conclusion"];
    candidate_evidence?: AgentTurnOutput["candidate_evidence"];
    userTurns?: number;
  }): {
    scenario: GoldenScenario;
    trajectory: TrajectoryTurn[];
  } {
    const scenario: GoldenScenario = {
      id: "TEST-SCENARIO",
      title: "test",
      category: "test",
      resume: { file: "GI-01-growth-analytics-thin.txt" },
      target: { role: "Senior PM", level: "Senior" },
      assessment: {
        general_capability: "test",
        target_specific_requirement: "test",
      },
      seed_gap: {
        gap_code: null,
        gap_title: "test",
        gap_description: "test",
        recommended_fix: null,
        severity: null,
      },
      seed_analysis: {
        positioning_summary: null,
        related_signals: [],
      },
      user_simulation: {
        persona: { style: "direct_concrete", fallback_answer: "" },
        answer_rules: [],
      },
      expected: args.expected,
    };

    const structured: AgentTurnOutput = {
      action: "stop_and_conclude",
      reasoning_note: "test",
      next_question: "",
      next_question_target_dimension: "other",
      candidate_evidence: args.candidate_evidence ?? [],
      dimension_coverage: {
        ownership: { status: "resolved", notes: "" },
        scope: { status: "resolved", notes: "" },
        complexity: { status: "resolved", notes: "" },
        outcome: { status: "resolved", notes: "" },
        target_role_fit: { status: "resolved", notes: "" },
      },
      decision_state: {
        current_conclusion: {
          underlying_capability: args.conclusion.underlying_capability,
          resume_evidence: args.conclusion.resume_evidence,
          target_role_fit: args.conclusion.target_role_fit,
        },
        decision_confidence: "high",
        material_uncertainty: "",
        would_next_question_change_conclusion: false,
        hypothesis_status: "confirmed",
      },
      stop_assessment: {
        confident_enough: true,
        diminishing_returns: true,
        reason: "test",
      },
      conclusion: args.conclusion,
    };

    const trajectory: TrajectoryTurn[] = [];
    const userTurns = args.userTurns ?? 1;
    // Interleave: assistant kickoff, then (user, assistant) pairs.
    // For deterministic metrics tests we only need:
    //  - at least one assistant stop_and_conclude turn with structured
    //  - at least one user turn so origin_user_turn_index=1 is valid
    trajectory.push({
      index: 0,
      role: "assistant",
      content: "kickoff",
      structured: {
        ...structured,
        action: "ask_question",
        next_question: "test",
        candidate_evidence: [],
      },
    });
    for (let i = 0; i < userTurns; i++) {
      trajectory.push({
        index: trajectory.length,
        role: "user",
        content: `user turn ${i}`,
      });
      trajectory.push({
        index: trajectory.length,
        role: "assistant",
        content: "conclusion",
        structured,
      });
    }
    return { scenario, trajectory };
  }

  // ----------------- OR-group semantic coverage -----------------
  console.log("\nOR-group semantic coverage:");

  const OR_GROUP = [
    "lacks",
    "surfac",
    "not quantif",
    "does not provide",
    "does not state",
    "does not include",
    "no explicit",
  ];

  const OR_GROUP_CASES: Array<{ text: string; shouldMatch: boolean }> = [
    { text: "Resume lacks quantified outcomes", shouldMatch: true },
    { text: "Resume does not provide quantified impact", shouldMatch: true },
    { text: "Resume does not state outcome metrics", shouldMatch: true },
    { text: "Resume does not include explicit ownership", shouldMatch: true },
    { text: "The resume does not surface these details", shouldMatch: true },
    { text: "Resume provides full quantified outcomes and ownership", shouldMatch: false },
    { text: "Resume explicitly quantifies 2.4x velocity gain", shouldMatch: false },
  ];
  for (const c of OR_GROUP_CASES) {
    const { scenario, trajectory } = makeCase({
      expected: {
        underlying_capability: "demonstrated",
        resume_evidence: "partial",
        target_role_fit: "meets",
        classification: "evidence_gap",
        residual_gap_must_mention: [["lacks", "surfac", "not quantif", "does not provide", "does not state", "does not include", "no explicit"]],
        max_turns_recommended: 5,
        hard_max_turns: 8,
        forbidden_claims: [],
      },
      conclusion: {
        underlying_capability: "demonstrated",
        resume_evidence: "partial",
        target_role_fit: "meets",
        residual_gap: c.text,
        classification: "evidence_gap",
        summary: "x",
        remaining_uncertainty: "",
      },
    });
    const det = scoreScenario({
      scenario,
      trajectory,
      stop_reason: "agent_stop",
      gate_coercion_events: 0,
      repetition_events: 0,
    });
    const hit = det.mentions_required_hits === 1;
    assert(
      `OR-group ${c.shouldMatch ? "matches" : "ignores"}: "${c.text.slice(0, 50)}…"`,
      hit === c.shouldMatch,
      `expected hit=${c.shouldMatch}, got hit=${hit}`
    );
  }
  void OR_GROUP; // silence unused-var if the harness changes

  // ------------- Forbidden-claims discrimination ---------------
  console.log("\nForbidden-claims discrimination:");

  // 1. Positive claim with forbidden substring → flagged
  {
    const { scenario, trajectory } = makeCase({
      expected: {
        underlying_capability: "not_demonstrated",
        resume_evidence: "does_not_demonstrate",
        target_role_fit: "does_not_meet",
        classification: "capability_gap",
        residual_gap_must_mention: [],
        max_turns_recommended: 5,
        hard_max_turns: 8,
        forbidden_claims: ["owned product strategy"],
      },
      conclusion: {
        underlying_capability: "not_demonstrated",
        resume_evidence: "does_not_demonstrate",
        target_role_fit: "does_not_meet",
        residual_gap: "x",
        classification: "capability_gap",
        summary: "The candidate has not owned product strategy.",
        remaining_uncertainty: "",
      },
      candidate_evidence: [
        {
          source_type: "resume",
          claim: "Candidate owned product strategy for the entire BU.",
          resume_excerpt: "x",
          origin_user_turn_index: -1,
          dimensions: { ownership: "x", scope: "x", complexity: "x", outcome: "x" },
          evidence_level: "direct",
        },
      ],
    });
    const det = scoreScenario({
      scenario,
      trajectory,
      stop_reason: "agent_stop",
      gate_coercion_events: 0,
      repetition_events: 0,
    });
    assert(
      "Forbidden phrase in POSITIVE candidate_evidence claim is flagged",
      det.forbidden_mentions_hit >= 1,
      `expected ≥1, got ${det.forbidden_mentions_hit}`
    );
  }

  // 2. Forbidden phrase appears only in SUMMARY (negated) → NOT flagged
  {
    const { scenario, trajectory } = makeCase({
      expected: {
        underlying_capability: "not_demonstrated",
        resume_evidence: "does_not_demonstrate",
        target_role_fit: "does_not_meet",
        classification: "capability_gap",
        residual_gap_must_mention: [],
        max_turns_recommended: 5,
        hard_max_turns: 8,
        forbidden_claims: ["owned product strategy"],
      },
      conclusion: {
        underlying_capability: "not_demonstrated",
        resume_evidence: "does_not_demonstrate",
        target_role_fit: "does_not_meet",
        residual_gap: "no product strategy ownership",
        classification: "capability_gap",
        summary: "You have not owned product strategy; the PMs you supported did.",
        remaining_uncertainty: "",
      },
      candidate_evidence: [],
    });
    const det = scoreScenario({
      scenario,
      trajectory,
      stop_reason: "agent_stop",
      gate_coercion_events: 0,
      repetition_events: 0,
    });
    assert(
      "Forbidden phrase in SUMMARY only is NOT flagged",
      det.forbidden_mentions_hit === 0,
      `expected 0, got ${det.forbidden_mentions_hit}`
    );
  }

  // 3. Forbidden phrase inside an evidence_level="none" absence claim → NOT flagged
  {
    const { scenario, trajectory } = makeCase({
      expected: {
        underlying_capability: "not_demonstrated",
        resume_evidence: "does_not_demonstrate",
        target_role_fit: "does_not_meet",
        classification: "capability_gap",
        residual_gap_must_mention: [],
        max_turns_recommended: 5,
        hard_max_turns: 8,
        forbidden_claims: ["owned product strategy"],
      },
      conclusion: {
        underlying_capability: "not_demonstrated",
        resume_evidence: "does_not_demonstrate",
        target_role_fit: "does_not_meet",
        residual_gap: "x",
        classification: "capability_gap",
        summary: "x",
        remaining_uncertainty: "",
      },
      candidate_evidence: [
        {
          source_type: "resume",
          claim: "The candidate has not owned product strategy anywhere on the resume.",
          resume_excerpt: "",
          origin_user_turn_index: -1,
          dimensions: { ownership: "x", scope: "x", complexity: "x", outcome: "x" },
          evidence_level: "none",
        },
      ],
    });
    const det = scoreScenario({
      scenario,
      trajectory,
      stop_reason: "agent_stop",
      gate_coercion_events: 0,
      repetition_events: 0,
    });
    assert(
      "Forbidden phrase in evidence_level=\"none\" absence claim is NOT flagged",
      det.forbidden_mentions_hit === 0,
      `expected 0, got ${det.forbidden_mentions_hit}`
    );
  }

  // ---------- Residual-gap non-empty rubric ----------
  console.log("\nResidual-gap non-empty rubric:");

  const RESIDUAL_CASES: Array<{
    classification: AgentTurnOutput["conclusion"]["classification"];
    residual: string;
    shouldFlag: boolean;
    label: string;
  }> = [
    {
      classification: "evidence_gap",
      residual: "",
      shouldFlag: true,
      label: "evidence_gap + empty residual flagged",
    },
    {
      classification: "capability_gap",
      residual: " ",
      shouldFlag: true,
      label: "capability_gap + whitespace residual flagged",
    },
    {
      classification: "scope_mismatch",
      residual: "short",
      shouldFlag: true,
      label: "scope_mismatch + <10-char residual flagged",
    },
    {
      classification: "evidence_gap",
      residual: "Resume lacks quantified outcomes.",
      shouldFlag: false,
      label: "evidence_gap + meaningful residual not flagged",
    },
    {
      classification: "partial_evidence",
      residual: "",
      shouldFlag: false,
      label: "partial_evidence + empty residual not flagged (not required)",
    },
  ];
  for (const c of RESIDUAL_CASES) {
    const { scenario, trajectory } = makeCase({
      expected: {
        underlying_capability: "demonstrated",
        resume_evidence: "partial",
        target_role_fit: "meets",
        classification: c.classification,
        residual_gap_must_mention: [],
        max_turns_recommended: 5,
        hard_max_turns: 8,
        forbidden_claims: [],
      },
      conclusion: {
        underlying_capability: "demonstrated",
        resume_evidence: "partial",
        target_role_fit: "meets",
        residual_gap: c.residual,
        classification: c.classification,
        summary: "x",
        remaining_uncertainty: "",
      },
    });
    const det = scoreScenario({
      scenario,
      trajectory,
      stop_reason: "agent_stop",
      gate_coercion_events: 0,
      repetition_events: 0,
    });
    assert(
      c.label,
      det.residual_gap_required_but_missing === c.shouldFlag,
      `expected flag=${c.shouldFlag}, got ${det.residual_gap_required_but_missing}`
    );
  }

  // -------------------- Summary --------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[tests] fatal:", err);
  process.exit(1);
});
