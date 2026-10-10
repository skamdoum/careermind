// Deterministic (non-LLM) metrics scored over an agent trajectory.

import fs from "node:fs";
import path from "node:path";
import type { AgentTurnOutput } from "@/lib/gap-investigation/agent";
import type {
  DeterministicMetrics,
  GoldenScenario,
  StopReason,
  TrajectoryTurn,
} from "../types";

const RESUME_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "resumes"
);

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function substringPresent(text: string, needle: string): boolean {
  return normalize(text).includes(normalize(needle));
}

const HYPOTHESIS_CHALLENGE_MARKERS = [
  "contradict",
  "challenge",
  "disprov",
  "pushes back",
  "actually shows",
  "runs counter",
  "doesn't match",
  "does not match",
  "resume shows",
];

const OWNERSHIP_PROBE_MARKERS = [
  "who owned",
  "final call",
  "personally decide",
  "did you personally",
  "specific decision",
  "specifically did you",
  "your decision",
];

export function scoreScenario(args: {
  scenario: GoldenScenario;
  trajectory: TrajectoryTurn[];
  stop_reason: StopReason;
  gate_coercion_events: number;
  repetition_events: number;
}): DeterministicMetrics {
  const { scenario, trajectory, stop_reason } = args;

  const final = finalConclusion(trajectory);

  const classification_match =
    final?.classification === scenario.expected.classification;
  const underlying_capability_match =
    final?.underlying_capability === scenario.expected.underlying_capability;
  const resume_evidence_match =
    final?.resume_evidence === scenario.expected.resume_evidence;
  const target_role_fit_match =
    final?.target_role_fit === scenario.expected.target_role_fit;

  const residual = final?.residual_gap || "";
  const summary = final?.summary || "";
  const mentions = scenario.expected.residual_gap_must_mention ?? [];
  // Each outer entry is one CONCEPT. A plain string must appear literally;
  // a string[] is an OR-group where any one alternative satisfies the
  // concept. mentions_required_total counts concepts (outer length), not
  // alternatives.
  let mentions_required_hits = 0;
  for (const m of mentions) {
    if (typeof m === "string") {
      if (substringPresent(residual, m)) mentions_required_hits += 1;
    } else if (Array.isArray(m)) {
      if (m.some((alt) => substringPresent(residual, alt))) {
        mentions_required_hits += 1;
      }
    }
  }

  const notMentions = scenario.expected.residual_gap_must_not_mention ?? [];
  const forbidden_in_residual = notMentions.filter((m) =>
    substringPresent(residual, m)
  ).length;

  // Forbidden-claim semantics: "the agent must not CLAIM the candidate
  // has the forbidden capability." A substring scan of the SUMMARY or of
  // absence claims (evidence_level="none") produces false positives —
  // those sentences legitimately mention the forbidden phrase in a
  // NEGATIVE frame (e.g., "has NOT owned product strategy"). Restrict
  // the check to positive candidate_evidence claims with
  // evidence_level ∈ {direct, supporting, adjacent}; those are the
  // claims the agent is asserting as present evidence.
  const forbiddenClaims = scenario.expected.forbidden_claims ?? [];
  const positiveClaimTexts = collectPositiveClaimTexts(trajectory);
  const forbiddenInClaims = forbiddenClaims.filter((c) =>
    positiveClaimTexts.some((text) => substringPresent(text, c))
  ).length;

  const forbidden_mentions_hit = forbidden_in_residual + forbiddenInClaims;

  const grounding_violations = countGroundingViolations({
    trajectory,
    resumeText: readResumeText(scenario.resume.file),
  });

  const kickoff = trajectory.find((t) => t.role === "assistant");
  let kickoff_hypothesis_challenge_present: boolean | null = null;
  if (scenario.expected.expect_kickoff_hypothesis_challenge !== undefined) {
    kickoff_hypothesis_challenge_present =
      !!kickoff &&
      HYPOTHESIS_CHALLENGE_MARKERS.some((m) =>
        substringPresent(kickoff.content, m)
      );
  }

  let participation_vs_ownership_probe_present: boolean | null = null;
  if (scenario.expected.expect_participation_vs_ownership_probe) {
    const anyAssistantQuestion = trajectory
      .filter(
        (t): t is TrajectoryTurn & { role: "assistant" } =>
          t.role === "assistant"
      )
      .some((t) =>
        OWNERSHIP_PROBE_MARKERS.some((m) => substringPresent(t.content, m))
      );
    participation_vs_ownership_probe_present = anyAssistantQuestion;
  }

  const turn_count = trajectory.filter((t) => t.role === "user").length;
  const within_recommended_turns =
    turn_count <= scenario.expected.max_turns_recommended;
  const within_hard_max_turns = turn_count <= scenario.expected.hard_max_turns;

  // Residual-gap required-but-missing check. A verdict that identifies a
  // gap (evidence_gap, capability_gap, scope_mismatch) must name what the
  // remaining gap is. An empty or trivially short residual_gap on those
  // verdicts fails the rubric regardless of keyword matching.
  const REQUIRES_RESIDUAL_GAP = new Set([
    "evidence_gap",
    "capability_gap",
    "scope_mismatch",
  ]);
  const residualTrim = (final?.residual_gap ?? "").trim();
  const residual_gap_required_but_missing =
    !!final?.classification &&
    REQUIRES_RESIDUAL_GAP.has(final.classification) &&
    residualTrim.length < 10;

  return {
    classification_match,
    underlying_capability_match,
    resume_evidence_match,
    target_role_fit_match,
    mentions_required_hits,
    mentions_required_total: mentions.length,
    forbidden_mentions_hit,
    grounding_violations,
    repetition_events: args.repetition_events,
    gate_coercions: args.gate_coercion_events,
    turn_count,
    within_recommended_turns,
    within_hard_max_turns,
    stop_reason,
    kickoff_hypothesis_challenge_present,
    participation_vs_ownership_probe_present,
    residual_gap_required_but_missing,
  };
}

export function finalConclusion(
  trajectory: TrajectoryTurn[]
): AgentTurnOutput["conclusion"] | null {
  for (let i = trajectory.length - 1; i >= 0; i--) {
    const t = trajectory[i];
    if (
      t.role === "assistant" &&
      t.structured &&
      t.structured.action === "stop_and_conclude"
    ) {
      return t.structured.conclusion;
    }
  }
  return null;
}

export function finalHypothesisStatus(
  trajectory: TrajectoryTurn[]
): string | null {
  for (let i = trajectory.length - 1; i >= 0; i--) {
    const t = trajectory[i];
    if (t.role === "assistant" && t.structured) {
      return t.structured.decision_state?.hypothesis_status ?? null;
    }
  }
  return null;
}

function collectPositiveClaimTexts(trajectory: TrajectoryTurn[]): string[] {
  const positiveLevels = new Set(["direct", "supporting", "adjacent"]);
  const out: string[] = [];
  for (const t of trajectory) {
    if (t.role !== "assistant" || !t.structured) continue;
    for (const ev of t.structured.candidate_evidence ?? []) {
      if (!ev.claim) continue;
      if (!positiveLevels.has(ev.evidence_level ?? "")) continue;
      out.push(ev.claim);
    }
  }
  return out;
}

function countGroundingViolations(args: {
  trajectory: TrajectoryTurn[];
  resumeText: string;
}): number {
  const { trajectory, resumeText } = args;
  const resumeNorm = normalize(resumeText);
  let violations = 0;

  // Build a user-turn index map so we can validate origin_user_turn_index.
  const userTurnIndexes = new Set<number>();
  trajectory.forEach((t) => {
    if (t.role === "user") userTurnIndexes.add(t.index);
  });

  for (const t of trajectory) {
    if (t.role !== "assistant" || !t.structured) continue;
    for (const ev of t.structured.candidate_evidence ?? []) {
      if (ev.source_type === "resume") {
        // Absence-of-evidence claims (evidence_level="none") are
        // meta-interpretations describing what the resume does NOT
        // contain. They legitimately cannot have a verbatim excerpt
        // match. Skip the substring check for these; the LLM
        // grounding judge still evaluates them. Positive resume
        // evidence (direct/supporting/adjacent) still requires an
        // excerpt that overlaps the resume by at least a 10-char
        // window.
        if (ev.evidence_level === "none") continue;
        if (!ev.resume_excerpt || !ev.resume_excerpt.trim()) {
          violations += 1;
          continue;
        }
        const norm = normalize(ev.resume_excerpt);
        if (norm.length < 10 || !windowHit(resumeNorm, norm, 10)) {
          violations += 1;
        }
      } else if (ev.source_type === "user") {
        if (!Number.isInteger(ev.origin_user_turn_index)) {
          violations += 1;
          continue;
        }
        if (!userTurnIndexes.has(ev.origin_user_turn_index)) {
          violations += 1;
        }
      } else if (ev.source_type === "inference") {
        if (!ev.resume_excerpt || !ev.resume_excerpt.trim()) {
          // Inference should cite its substrate. Empty excerpt + no
          // user-turn pointer is a grounding violation.
          if (
            !Number.isInteger(ev.origin_user_turn_index) ||
            ev.origin_user_turn_index < 0 ||
            !userTurnIndexes.has(ev.origin_user_turn_index)
          ) {
            violations += 1;
          }
        }
      }
    }
  }
  return violations;
}

function windowHit(hay: string, needle: string, size: number): boolean {
  if (needle.length <= size) return hay.includes(needle);
  for (let i = 0; i + size <= needle.length; i++) {
    const win = needle.slice(i, i + size);
    if (hay.includes(win)) return true;
  }
  return false;
}

function readResumeText(fileName: string): string {
  const p = path.join(RESUME_DIR, fileName);
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
