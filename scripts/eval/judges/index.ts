// Qualitative LLM judges. Narrow scopes, structured output, called
// once per metric per scenario trajectory (except per-turn judges and
// per-claim grounding). Each judge is small; the file keeps them
// together so the scoring loop stays readable.

import fs from "node:fs";
import path from "node:path";
import type { AgentTurnOutput } from "@/lib/gap-investigation/agent";
import type {
  GroundingReject,
  JudgeMetrics,
  GoldenScenario,
  TrajectoryTurn,
} from "../types";
import { askJudge, type JudgeUsage } from "./_judge-client";

const RESUME_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "resumes"
);

export type JudgeTotals = {
  metrics: JudgeMetrics;
  usage: JudgeUsage;
  errors: string[];
  grounding_rejects: GroundingReject[];
};

const EMPTY_METRICS: JudgeMetrics = {
  question_relevance_scores: [],
  question_relevance_avg: null,
  unnecessary_question_count: 0,
  unnecessary_question_total: 0,
  residual_gap_quality: null,
  summary_quality: null,
  grounding_pass_rate: null,
  grounding_pass: 0,
  grounding_total: 0,
};

function sumUsage(a: JudgeUsage, b: JudgeUsage): JudgeUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function readResumeText(fileName: string): string {
  try {
    return fs.readFileSync(path.join(RESUME_DIR, fileName), "utf8");
  } catch {
    return "";
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return Math.round(n);
}

export async function runAllJudges(args: {
  scenario: GoldenScenario;
  trajectory: TrajectoryTurn[];
  run_index: number;
}): Promise<JudgeTotals> {
  const errors: string[] = [];
  const grounding_rejects: GroundingReject[] = [];
  let usage: JudgeUsage = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };

  const metrics: JudgeMetrics = { ...EMPTY_METRICS };

  const assistantQuestionTurns = args.trajectory.filter(
    (t): t is TrajectoryTurn & { role: "assistant"; structured: AgentTurnOutput } =>
      t.role === "assistant" &&
      !!t.structured &&
      t.structured.action === "ask_question"
  );

  // 1 — question-relevance (every ask_question turn)
  for (const t of assistantQuestionTurns) {
    try {
      const { response, usage: u } = await scoreQuestionRelevance({
        scenario: args.scenario,
        turn: t,
      });
      metrics.question_relevance_scores.push(clampScore(response.score));
      usage = sumUsage(usage, u);
    } catch (err) {
      errors.push(
        `question_relevance judge failed on turn ${t.index}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  metrics.question_relevance_avg = avg(metrics.question_relevance_scores);

  // 2 — unnecessary-question (every ask_question turn AFTER kickoff)
  const nonKickoffQuestions = assistantQuestionTurns.filter((t) => t.index > 0);
  metrics.unnecessary_question_total = nonKickoffQuestions.length;
  for (const t of nonKickoffQuestions) {
    try {
      const { response, usage: u } = await judgeUnnecessaryQuestion({
        scenario: args.scenario,
        trajectory: args.trajectory,
        turn: t,
      });
      usage = sumUsage(usage, u);
      if (!response.necessary) {
        metrics.unnecessary_question_count += 1;
      }
    } catch (err) {
      errors.push(
        `unnecessary_question judge failed on turn ${t.index}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // 3 — residual-gap quality (one-shot on final conclusion)
  const finalTurn = [...args.trajectory]
    .reverse()
    .find(
      (t): t is TrajectoryTurn & { role: "assistant"; structured: AgentTurnOutput } =>
        t.role === "assistant" &&
        !!t.structured &&
        t.structured.action === "stop_and_conclude"
    );
  if (finalTurn) {
    try {
      const { response, usage: u } = await scoreResidualGapQuality({
        scenario: args.scenario,
        conclusion: finalTurn.structured.conclusion,
      });
      metrics.residual_gap_quality = clampScore(response.score);
      usage = sumUsage(usage, u);
    } catch (err) {
      errors.push(
        `residual_gap_quality judge failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    try {
      const { response, usage: u } = await scoreSummaryQuality({
        scenario: args.scenario,
        conclusion: finalTurn.structured.conclusion,
      });
      metrics.summary_quality = clampScore(response.score);
      usage = sumUsage(usage, u);
    } catch (err) {
      errors.push(
        `summary_quality judge failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // 4 — grounding (per candidate_evidence claim)
  const resumeText = readResumeText(args.scenario.resume.file);
  for (const t of args.trajectory) {
    if (t.role !== "assistant" || !t.structured) continue;
    for (const ev of t.structured.candidate_evidence ?? []) {
      metrics.grounding_total += 1;
      try {
        const { response, usage: u } = await judgeGrounding({
          scenario: args.scenario,
          claim: ev.claim,
          source_type: ev.source_type,
          resume_excerpt: ev.resume_excerpt || "",
          resumeText,
          userAnswersText: args.trajectory
            .filter((x) => x.role === "user")
            .map((x) => x.content)
            .join("\n---\n"),
        });
        usage = sumUsage(usage, u);
        if (response.grounded) {
          metrics.grounding_pass += 1;
        } else {
          grounding_rejects.push({
            scenario_id: args.scenario.id,
            run_index: args.run_index,
            turn_index: t.index,
            claim: ev.claim,
            source_type: ev.source_type,
            evidence_level: ev.evidence_level ?? null,
            resume_excerpt: ev.resume_excerpt || "",
            origin_user_turn_index: ev.origin_user_turn_index,
            judge_rationale: response.rationale,
          });
        }
      } catch (err) {
        errors.push(
          `grounding judge failed on turn ${t.index}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }
  metrics.grounding_pass_rate =
    metrics.grounding_total > 0
      ? metrics.grounding_pass / metrics.grounding_total
      : null;

  return { metrics, usage, errors, grounding_rejects };
}

// ----- individual judges below -----

async function scoreQuestionRelevance(args: {
  scenario: GoldenScenario;
  turn: TrajectoryTurn & { structured: AgentTurnOutput };
}) {
  const ds = args.turn.structured.decision_state;
  const sys = `You rate a career-coach agent's investigation questions. Given the stated material_uncertainty and the question the agent is about to ask, rate on 1-5 how DIRECTLY the question targets that material_uncertainty.
5 = perfectly targeted
4 = clearly targeted with minor framing overhead
3 = relevant to the broader dimension but not pointed at the specific material_uncertainty
2 = tangential
1 = unrelated
Set necessary=true, grounded=true (unused for this judge). Set score to 1-5.`;
  const userPrompt = `TARGET ROLE: ${args.scenario.target.role} (${args.scenario.target.level})

MATERIAL_UNCERTAINTY (what the agent itself declared it is uncertain about):
${ds.material_uncertainty || "(none stated)"}

QUESTION ABOUT TO BE ASKED:
${args.turn.structured.next_question}

DIMENSION DECLARED FOR THIS QUESTION: ${args.turn.structured.next_question_target_dimension}

Rate how directly the question targets the material_uncertainty.`;
  return askJudge({
    systemPrompt: sys,
    userPrompt,
    name: "question_relevance",
  });
}

async function judgeUnnecessaryQuestion(args: {
  scenario: GoldenScenario;
  trajectory: TrajectoryTurn[];
  turn: TrajectoryTurn & { structured: AgentTurnOutput };
}) {
  const ds = args.turn.structured.decision_state;
  const prior = args.trajectory.filter((t) => t.index < args.turn.index);
  const condensed = prior
    .map((t) => {
      if (t.role === "assistant" && t.structured?.action === "ask_question") {
        return `[assistant turn ${t.index}, question] ${t.structured.next_question}`;
      }
      if (
        t.role === "assistant" &&
        t.structured?.action === "stop_and_conclude"
      ) {
        return `[assistant turn ${t.index}, stop] ${t.structured.conclusion.summary}`;
      }
      return `[user turn ${t.index}] ${t.content}`;
    })
    .join("\n");

  const sys = `You rate whether a career-coach agent's next question is NECESSARY. Given everything known BEFORE this question — prior transcript, agent's current_conclusion, decision_confidence, material_uncertainty, hypothesis_status — could plausible answers to the proposed question materially change ANY of: underlying_capability, resume_evidence, target_role_fit, residual_gap?
- necessary=true: at least one plausible answer could change at least one of those four.
- necessary=false: no plausible answer could change any of them (the question is evidence-harvesting on an already-sufficient dimension, or a stronger version of evidence already in hand).
Set score=0 and grounded=true (unused). The decisive output is "necessary".`;
  const userPrompt = `TARGET ROLE: ${args.scenario.target.role} (${args.scenario.target.level})
GAP: ${args.scenario.seed_gap.gap_title}

PRIOR TRANSCRIPT (condensed, in order):
${condensed}

AGENT'S CURRENT STATE BEFORE ASKING THIS QUESTION:
current_conclusion: ${JSON.stringify(ds.current_conclusion)}
decision_confidence: ${ds.decision_confidence}
material_uncertainty: ${ds.material_uncertainty || "(none)"}
hypothesis_status: ${ds.hypothesis_status}

PROPOSED NEXT QUESTION (dimension=${args.turn.structured.next_question_target_dimension}):
${args.turn.structured.next_question}

Is this question NECESSARY per the rule above?`;
  return askJudge({
    systemPrompt: sys,
    userPrompt,
    name: "unnecessary_question",
  });
}

async function scoreResidualGapQuality(args: {
  scenario: GoldenScenario;
  conclusion: AgentTurnOutput["conclusion"];
}) {
  const sys = `You rate the quality of a career-coach agent's residual_gap sentence. 5 = concrete, correct, named at the target-specific sub-scope the role requires. 3 = correct but vague/generic. 1 = wrong, missing, or at the wrong scope. Set necessary=true, grounded=true (unused).`;
  const userPrompt = `TARGET ROLE: ${args.scenario.target.role} (${args.scenario.target.level})
EXPECTED CLASSIFICATION: ${args.scenario.expected.classification}
EXPECTED residual_gap_must_mention (one or more should typically appear): ${JSON.stringify(args.scenario.expected.residual_gap_must_mention)}

AGENT'S RESIDUAL_GAP:
${args.conclusion.residual_gap || "(empty)"}

Rate the residual_gap on 1-5.`;
  return askJudge({
    systemPrompt: sys,
    userPrompt,
    name: "residual_gap_quality",
  });
}

async function scoreSummaryQuality(args: {
  scenario: GoldenScenario;
  conclusion: AgentTurnOutput["conclusion"];
}) {
  const sys = `You rate the quality of a career-coach agent's conclusion summary. 5 = cleanly distinguishes (a) what the resume showed, (b) what the user established, (c) the honest classification/scope story; concrete and specific. 3 = correct direction but partial on at least one piece. 1 = wrong, vague, or contradictory. Set necessary=true, grounded=true (unused).`;
  const userPrompt = `TARGET ROLE: ${args.scenario.target.role} (${args.scenario.target.level})
EXPECTED CLASSIFICATION: ${args.scenario.expected.classification}

AGENT'S FINAL CONCLUSION:
underlying_capability: ${args.conclusion.underlying_capability}
resume_evidence: ${args.conclusion.resume_evidence}
target_role_fit: ${args.conclusion.target_role_fit}
classification: ${args.conclusion.classification}
residual_gap: ${args.conclusion.residual_gap || "(empty)"}
summary: ${args.conclusion.summary || "(empty)"}

Rate the summary on 1-5.`;
  return askJudge({
    systemPrompt: sys,
    userPrompt,
    name: "summary_quality",
  });
}

async function judgeGrounding(args: {
  scenario: GoldenScenario;
  claim: string;
  source_type: "resume" | "user" | "inference";
  resume_excerpt: string;
  resumeText: string;
  userAnswersText: string;
}) {
  // Source-type-aware system prompt. Each source_type names its own
  // arbiter. User-sourced claims are judged against user turns — the
  // resume is NOT the arbiter for them. Fabrication (a claim not
  // actually present in the stated source) still fails.
  //
  // Final-boolean consistency clause: if the rationale concludes the
  // claim IS supported by the stated source, grounded MUST be true. If
  // the rationale concludes the claim is NOT supported, grounded MUST
  // be false. The output boolean cannot contradict the rationale.
  const sys = `You decide whether a career-coach agent's extracted claim is GROUNDED in the SOURCE it declared via source_type. Each source_type has its own arbiter:

- source_type = "resume": the claim must be supported by the RESUME TEXT. The user transcript is not relevant. Grounded = true if the resume text supports the claim (paraphrase is fine). Grounded = false if the resume does not contain the claim's substance. Absence-of-evidence claims (meta-claims that the resume does NOT contain some item) are grounded when they accurately describe the resume — a true statement that "the resume does not quantify X" is grounded in the resume if the resume indeed does not quantify X.

- source_type = "user": the claim must be supported by the USER ANSWERS transcript. The RESUME TEXT is NOT the arbiter and MUST NOT be used to reject the claim. Grounded = true if any user answer in the transcript stated this (verbatim, paraphrase, or close rewording). Grounded = false ONLY if no user answer established the claim's substance (i.e., the agent fabricated it).

- source_type = "inference": the claim is an interpretation that may combine resume and user material. Grounded = true if at least one of (a) the cited RESUME_EXCERPT appears in the resume, or (b) the referenced user answers in the transcript support the interpreted statement. Grounded = false if the inference has no honest substrate in either source.

Paraphrase, summarization, and reasonable rewording are grounded. Inventing numbers, employers, scope, team sizes, outcomes, or decisions that are NOT present in the appropriate source is a grounding violation.

CONSISTENCY RULE (CRITICAL): the "grounded" boolean MUST agree with your rationale. Before you finalize the output, re-read your own rationale sentence-by-sentence:
- If your rationale concludes or implies that the claim IS supported by the stated source (phrases like "the claim is grounded", "aligns with", "supported by", "accurately states", "matches the resume", "the user did say"), you MUST set grounded = true.
- If your rationale concludes the claim is NOT supported (phrases like "no evidence in the stated source", "the agent fabricated", "contradicts the source"), you MUST set grounded = false.
- Do NOT emit a boolean that contradicts your rationale. If you find your rationale and intended verdict conflict, revise the rationale to match the verdict you actually mean.

Decisive output: "grounded". Set score=0 and necessary=true (unused by this judge).`;
  const userPrompt = `CLAIM (source_type=${args.source_type}):
${args.claim}

AGENT'S cited RESUME_EXCERPT (may be empty for user-sourced claims):
${args.resume_excerpt || "(none)"}

RESUME TEXT:
"""
${args.resumeText}
"""

USER ANSWERS (all user turns, concatenated):
"""
${args.userAnswersText}
"""

Apply the source-type-specific rule above. Is this claim grounded?`;
  return askJudge({
    systemPrompt: sys,
    userPrompt,
    name: "grounding",
  });
}
