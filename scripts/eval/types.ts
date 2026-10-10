// Stage 1 eval types. Scenario authoring + runner contracts.

import type {
  AgentTurnOutput,
  AgentTurnUsage,
} from "@/lib/gap-investigation/agent";
import type {
  HypothesisStatus,
  InvestigationConclusion,
  ResumeEvidenceStatus,
  TargetRoleFitStatus,
  UnderlyingCapabilityStatus,
} from "@/lib/db/gap-investigations";

export type AgentDimension =
  | "ownership"
  | "scope"
  | "complexity"
  | "outcome"
  | "target_role_fit"
  | "other";

// A single deterministic answer rule. First-match-wins against the
// agent's `next_question` text + its `next_question_target_dimension`.
export type UserAnswerRule = {
  id: string;
  match: {
    // If present, the rule only fires when the agent's declared target
    // dimension is one of these values.
    dimensions?: AgentDimension[];
    // If present, at least one pattern (case-insensitive substring)
    // must appear in the agent's next_question text.
    patterns?: string[];
    // If present, NONE of these patterns may appear.
    not_patterns?: string[];
  };
  answer: string;
  // Default false — one-shot. Set true for rules that may fire more
  // than once (rarely needed; most rules are one-shot).
  reusable?: boolean;
};

export type UserPersona = {
  // Human-facing label; not used by the matcher. Documentation only.
  style:
    | "direct_concrete"
    | "vague_initial_specific_on_followup"
    | "evasive"
    | "contradictory";
  // Fallback answer when no rule matches.
  fallback_answer: string;
};

// Explicit statement of what the scenario is asking the agent to assess.
// Harness-side metadata only — no production schema change. The general
// capability is the one that drives underlying_capability / resume_evidence;
// the target-specific requirement is what drives target_role_fit. Keeping
// both explicit per-scenario anchors the semantic frame used to interpret
// the agent's output.
export type ScenarioAssessment = {
  general_capability: string;
  target_specific_requirement: string;
};

export type GoldenScenario = {
  id: string;
  title: string;
  category: string;
  resume: { file: string };
  target: { role: string; level: string };
  assessment: ScenarioAssessment;
  seed_gap: {
    gap_code: string | null;
    gap_title: string;
    gap_description: string;
    recommended_fix: string | null;
    severity: "high" | "medium" | "low" | null;
  };
  seed_analysis: {
    positioning_summary: string | null;
    related_signals: Array<{
      signal_name: string;
      score: number;
      rationale: string;
    }>;
  };
  user_simulation: {
    persona: UserPersona;
    answer_rules: UserAnswerRule[];
  };
  expected: {
    underlying_capability: UnderlyingCapabilityStatus;
    resume_evidence: ResumeEvidenceStatus;
    target_role_fit: TargetRoleFitStatus;
    classification: InvestigationConclusion;
    // Each outer entry is one CONCEPT that must be mentioned.
    //   string      → that exact substring is required
    //   string[]    → OR-group; any one alternative satisfies the concept
    // All outer concepts must be satisfied. Case-insensitive substrings.
    residual_gap_must_mention: Array<string | string[]>;
    residual_gap_must_not_mention?: string[];
    hypothesis_status_expected?: HypothesisStatus;
    max_turns_recommended: number;
    hard_max_turns: number;
    expect_kickoff_hypothesis_challenge?: boolean;
    expect_participation_vs_ownership_probe?: boolean;
    forbidden_claims: string[];
  };
};

// -----------------------------------------------------------------
// Runner-side types.
// -----------------------------------------------------------------

export type TrajectoryTurn = {
  index: number;
  role: "assistant" | "user";
  content: string;
  // Only present for assistant turns.
  structured?: AgentTurnOutput;
  usage?: AgentTurnUsage;
  model?: string;
  latency_ms?: number;
  // For user turns: which rule fired, or "(fallback)" if none matched.
  matched_rule_id?: string;
};

export type StopReason =
  | "agent_stop"
  | "gate_coerced"
  | "safety_cap_hit"
  | "scenario_cap_hit"
  | "harness_error";

export type DeterministicMetrics = {
  classification_match: boolean;
  underlying_capability_match: boolean;
  resume_evidence_match: boolean;
  target_role_fit_match: boolean;
  mentions_required_hits: number;
  mentions_required_total: number;
  forbidden_mentions_hit: number;
  grounding_violations: number;
  repetition_events: number;
  gate_coercions: number;
  turn_count: number;
  within_recommended_turns: boolean;
  within_hard_max_turns: boolean;
  stop_reason: StopReason;
  kickoff_hypothesis_challenge_present: boolean | null;
  participation_vs_ownership_probe_present: boolean | null;
  // True when the final conclusion.classification is in
  // {evidence_gap, capability_gap, scope_mismatch} AND residual_gap is
  // empty or trivially short (< 10 trimmed chars). Fails the rubric
  // regardless of keyword matching.
  residual_gap_required_but_missing: boolean;
};

export type JudgeScore = {
  score?: number;
  necessary?: boolean;
  rationale: string;
};

export type JudgeMetrics = {
  question_relevance_scores: number[];
  question_relevance_avg: number | null;
  unnecessary_question_count: number;
  unnecessary_question_total: number;
  residual_gap_quality: number | null;
  summary_quality: number | null;
  grounding_pass_rate: number | null;
  grounding_pass: number;
  grounding_total: number;
};

// Per-claim grounding rejects captured for post-hoc inspection without
// changing the judge prompt or production behavior.
export type GroundingReject = {
  scenario_id: string;
  run_index: number;
  turn_index: number;
  claim: string;
  source_type: "resume" | "user" | "inference";
  evidence_level: "direct" | "supporting" | "adjacent" | "none" | null;
  resume_excerpt: string;
  origin_user_turn_index: number;
  judge_rationale: string;
};

export type ScenarioResult = {
  scenario_id: string;
  title: string;
  category: string;
  model: string;
  started_at: string;
  duration_ms: number;
  stop_reason: StopReason;
  turn_count: number;
  trajectory: TrajectoryTurn[];
  deterministic: DeterministicMetrics;
  judges: JudgeMetrics | null;
  usage_totals: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  est_cost_usd: number | null;
  overall_pass: boolean;
  pass_reasons: string[];
  fail_reasons: string[];
  harness_errors: string[];
  // Each item the grounding judge marked grounded=false in this run.
  // Populated by the judge orchestrator; empty when judges are skipped.
  grounding_rejects: GroundingReject[];
  run_index: number;
  // Convenience copies for the summary.
  expected: GoldenScenario["expected"];
  actual: {
    underlying_capability: UnderlyingCapabilityStatus | null;
    resume_evidence: ResumeEvidenceStatus | null;
    target_role_fit: TargetRoleFitStatus | null;
    classification: InvestigationConclusion | null;
    residual_gap: string | null;
    hypothesis_status: HypothesisStatus | null;
  };
};

export type PricingTable = Record<
  string,
  { input_per_1m_usd: number; output_per_1m_usd: number }
>;

// -----------------------------------------------------------------
// Multi-run aggregation. Each scenario runs N times independently; the
// aggregate reports per-dimension distributions, modal value, and the
// stability percentage (modal count / N). Variance is NOT hidden
// behind the modal value — distributions are reported alongside.
// -----------------------------------------------------------------

export type DimensionStat = {
  expected: string;
  matches: number;
  total: number;
  match_pct: number;
  distribution: Record<string, number>;
  modal_value: string;
  modal_count: number;
  stability_pct: number;
};

export type ScenarioAggregate = {
  scenario_id: string;
  title: string;
  category: string;
  model: string;
  total_runs: number;
  rubric_passed_runs: number;
  dimension_stats: {
    classification: DimensionStat;
    underlying_capability: DimensionStat;
    resume_evidence: DimensionStat;
    target_role_fit: DimensionStat;
  };
  turns_distribution: Record<string, number>;
  avg_turns: number;
  avg_duration_ms: number;
  input_tokens_total: number;
  output_tokens_total: number;
  est_cost_usd_total: number | null;
  repetition_events_total: number;
  gate_coercions_total: number;
  unnecessary_question_total: number;
  unnecessary_question_count: number;
  grounding_pass_total: number;
  grounding_claim_total: number;
  grounding_rejects: GroundingReject[];
  mentions_hits_total: number;
  mentions_required_total: number;
  runs: ScenarioResult[];
  general_capability?: string;
  target_specific_requirement?: string;
  residual_gap_missing_total: number;
};
