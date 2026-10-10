// Deterministic rule-based simulated user. Zero LLM calls — the same
// agent question + the same accumulated usage history always produces
// the same answer. Stage-1 design: an LLM-based "robustness" user may
// be added later as a SEPARATE mode; it must not replace this one for
// golden regression runs.
//
// Matching algorithm: first-match-wins over the ordered rule list.
// A rule MATCHES when:
//   - at least one of `patterns` is a case-insensitive substring of
//     the agent's next_question text, OR `patterns` is empty, AND
//   - none of `not_patterns` is a substring (if provided), AND
//   - if `dimensions` is provided, the agent's declared
//     `next_question_target_dimension` is in it.
// Rules are one-shot by default. Reusable rules may fire more than
// once; typically used for consistent catch-alls.
//
// If no rule matches, the persona's `fallback_answer` is returned and
// the matched_rule_id reported as "(fallback)".

import type { AgentTurnOutput } from "@/lib/gap-investigation/agent";
import type {
  AgentDimension,
  GoldenScenario,
  UserAnswerRule,
} from "./types";

export type SimulatedUserState = {
  used_rule_ids: Set<string>;
};

export function createSimulatedUserState(): SimulatedUserState {
  return { used_rule_ids: new Set() };
}

function patternHit(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

function ruleMatches(
  rule: UserAnswerRule,
  question: string,
  dimension: AgentDimension
): boolean {
  const { dimensions, patterns, not_patterns } = rule.match;

  if (dimensions && dimensions.length > 0) {
    if (!dimensions.includes(dimension)) return false;
  }

  if (not_patterns && not_patterns.length > 0) {
    for (const p of not_patterns) {
      if (patternHit(question, p)) return false;
    }
  }

  if (patterns && patterns.length > 0) {
    for (const p of patterns) {
      if (patternHit(question, p)) return true;
    }
    return false;
  }

  // No patterns and dimension already satisfied (or absent) → match.
  return true;
}

export function answerAsSimulatedUser(args: {
  scenario: GoldenScenario;
  state: SimulatedUserState;
  agentOutput: AgentTurnOutput;
}): { answer: string; matched_rule_id: string } {
  const { scenario, state, agentOutput } = args;
  const question = agentOutput.next_question ?? "";
  const dimension = (agentOutput.next_question_target_dimension ??
    "other") as AgentDimension;

  for (const rule of scenario.user_simulation.answer_rules) {
    if (!rule.reusable && state.used_rule_ids.has(rule.id)) continue;
    if (ruleMatches(rule, question, dimension)) {
      if (!rule.reusable) state.used_rule_ids.add(rule.id);
      return { answer: rule.answer, matched_rule_id: rule.id };
    }
  }

  return {
    answer: scenario.user_simulation.persona.fallback_answer,
    matched_rule_id: "(fallback)",
  };
}
