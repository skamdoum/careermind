// Drive one scenario end-to-end against the real production agent.
// No DB, no API routes — the context snapshot is built in-memory and
// runAgentTurnFull is called directly from the production module.

import fs from "node:fs";
import path from "node:path";
import {
  AGENT_MODEL_NAME,
  runAgentTurnFull,
  type AgentTurnFullResult,
  type AgentTurnInput,
  type AgentTurnOutput,
} from "@/lib/gap-investigation/agent";
import {
  latestDecisionState,
  latestDimensionCoverage,
  type GapInvestigationTurnRow,
  type InvestigationContextSnapshot,
} from "@/lib/db/gap-investigations";
import type { GoldenScenario, StopReason, TrajectoryTurn } from "./types";
import {
  answerAsSimulatedUser,
  createSimulatedUserState,
} from "./simulated-user";
import { uploadOrReuseResume } from "./openai-file-cache";

const RESUME_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "resumes"
);

export type AgentRunOutcome = {
  trajectory: TrajectoryTurn[];
  stop_reason: StopReason;
  turn_count: number;
  usage_totals: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  model: string;
  gate_coercion_events: number;
  repetition_events: number;
  harness_errors: string[];
};

function buildContextSnapshot(args: {
  scenario: GoldenScenario;
  resumeFileName: string;
}): InvestigationContextSnapshot {
  const { scenario, resumeFileName } = args;
  return {
    gap: {
      gap_code: scenario.seed_gap.gap_code ?? null,
      gap_title: scenario.seed_gap.gap_title,
      gap_description: scenario.seed_gap.gap_description,
      recommended_fix: scenario.seed_gap.recommended_fix ?? null,
      severity: scenario.seed_gap.severity ?? null,
    },
    target: {
      role: scenario.target.role,
      level: scenario.target.level,
    },
    analysis: {
      id: `eval:${scenario.id}`,
      positioning_summary: scenario.seed_analysis.positioning_summary ?? null,
      related_signals: scenario.seed_analysis.related_signals ?? [],
    },
    resume: {
      id: `eval:${scenario.id}:resume`,
      file_name: resumeFileName,
    },
  };
}

// Build an array of GapInvestigationTurnRow-shaped records from the
// trajectory so the production helpers (latestDimensionCoverage,
// latestDecisionState) and the agent itself see the same transcript
// shape as production.
function toRowShape(trajectory: TrajectoryTurn[]): GapInvestigationTurnRow[] {
  return trajectory.map((t) => ({
    id: `eval-turn-${t.index}`,
    investigation_id: "eval",
    user_id: "eval",
    role: t.role,
    content: t.content,
    structured: t.structured ?? null,
    turn_index: t.index,
    created_at: new Date().toISOString(),
  }));
}

// Server-side coercion logic — lifted from
// app/api/gap-investigations/[id]/turns/route.ts so eval mirrors the
// production enforcement of the material-change gate.
function applyGateCoercion(agentOut: AgentTurnOutput): {
  out: AgentTurnOutput;
  coerced: boolean;
} {
  if (
    agentOut.action === "ask_question" &&
    agentOut.decision_state &&
    agentOut.decision_state.would_next_question_change_conclusion === false
  ) {
    const cc = agentOut.decision_state.current_conclusion;
    const uncertainty = agentOut.decision_state.material_uncertainty || "";
    const derivedClassification =
      cc.underlying_capability === "not_demonstrated"
        ? "capability_gap"
        : cc.underlying_capability === "demonstrated" &&
          cc.target_role_fit !== "meets"
        ? "scope_mismatch"
        : cc.underlying_capability === "demonstrated" &&
          cc.target_role_fit === "meets" &&
          cc.resume_evidence !== "demonstrates"
        ? "evidence_gap"
        : "partial_evidence";
    const existingSummary = (agentOut.conclusion?.summary ?? "").trim();
    return {
      coerced: true,
      out: {
        ...agentOut,
        action: "stop_and_conclude",
        conclusion: {
          underlying_capability: cc.underlying_capability,
          resume_evidence: cc.resume_evidence,
          target_role_fit: cc.target_role_fit,
          residual_gap:
            (agentOut.conclusion?.residual_gap ?? "").trim() || uncertainty,
          classification:
            agentOut.conclusion?.classification &&
            agentOut.conclusion.classification !== "partial_evidence"
              ? agentOut.conclusion.classification
              : derivedClassification,
          summary:
            existingSummary ||
            "Concluding on the evidence in hand: another question would not materially change the classification.",
          remaining_uncertainty:
            (agentOut.conclusion?.remaining_uncertainty ?? "").trim() ||
            uncertainty,
        },
      },
    };
  }
  return { out: agentOut, coerced: false };
}

// Observational-only — mirrors the production console.warn metric so
// we count repetition events as eval telemetry.
function detectRepetition(
  agentOut: AgentTurnOutput,
  priorCoverage: ReturnType<typeof latestDimensionCoverage>
): boolean {
  if (
    agentOut.action !== "ask_question" ||
    !priorCoverage ||
    agentOut.next_question_target_dimension === "other"
  ) {
    return false;
  }
  const dim = agentOut.next_question_target_dimension;
  const prior = (priorCoverage as Record<string, { status: string }>)[dim];
  return prior?.status === "resolved";
}

export async function runScenarioAgent(args: {
  scenario: GoldenScenario;
  modelOverride?: string;
  reasoningEffort?: "low" | "medium" | "high";
  scenarioHardMax: number;
}): Promise<AgentRunOutcome> {
  const { scenario, modelOverride, reasoningEffort, scenarioHardMax } = args;

  const resumePath = path.join(RESUME_DIR, scenario.resume.file);
  if (!fs.existsSync(resumePath)) {
    throw new Error(`Resume fixture missing: ${resumePath}`);
  }

  const { file_id } = await uploadOrReuseResume({
    localPath: resumePath,
    mimeType: "text/plain",
  });

  const context = buildContextSnapshot({
    scenario,
    resumeFileName: scenario.resume.file,
  });

  const trajectory: TrajectoryTurn[] = [];
  const userState = createSimulatedUserState();
  const harness_errors: string[] = [];
  let gate_coercion_events = 0;
  let repetition_events = 0;
  let input_tokens = 0;
  let output_tokens = 0;
  let total_tokens = 0;
  let modelUsed = modelOverride || AGENT_MODEL_NAME;
  let stop_reason: StopReason = "harness_error";

  const callAgent = async (
    input: AgentTurnInput
  ): Promise<AgentTurnFullResult> => {
    try {
      return await runAgentTurnFull(input);
    } catch (err) {
      harness_errors.push(
        `Agent call failed on turn ${trajectory.length}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      throw err;
    }
  };

  // Kickoff turn.
  const kickoffStart = Date.now();
  let kickoffFull: AgentTurnFullResult;
  try {
    kickoffFull = await callAgent({
      context,
      transcript: [],
      evidence: [],
      turn_count: 0,
      openai_resume_file_id: file_id,
      is_kickoff: true,
      prior_dimension_coverage: null,
      prior_decision_state: null,
      model_override: modelOverride,
      reasoning_effort: reasoningEffort,
    });
  } catch {
    return {
      trajectory,
      stop_reason: "harness_error",
      turn_count: 0,
      usage_totals: { input_tokens, output_tokens, total_tokens },
      model: modelUsed,
      gate_coercion_events,
      repetition_events,
      harness_errors,
    };
  }
  const kickoffLatency = Date.now() - kickoffStart;
  const kickoffCoerced = applyGateCoercion(kickoffFull.output);
  if (kickoffCoerced.coerced) gate_coercion_events += 1;
  input_tokens += kickoffFull.usage.input_tokens;
  output_tokens += kickoffFull.usage.output_tokens;
  total_tokens += kickoffFull.usage.total_tokens;
  modelUsed = kickoffFull.model;

  const kickoffContent =
    kickoffCoerced.out.action === "ask_question"
      ? kickoffCoerced.out.next_question
      : kickoffCoerced.out.conclusion.summary ||
        "(investigation concluded on kickoff)";

  trajectory.push({
    index: 0,
    role: "assistant",
    content: kickoffContent,
    structured: kickoffCoerced.out,
    usage: kickoffFull.usage,
    model: kickoffFull.model,
    latency_ms: kickoffLatency,
  });

  if (kickoffCoerced.out.action === "stop_and_conclude") {
    stop_reason = kickoffCoerced.coerced ? "gate_coerced" : "agent_stop";
    return {
      trajectory,
      stop_reason,
      turn_count: trajectory.filter((t) => t.role === "user").length,
      usage_totals: { input_tokens, output_tokens, total_tokens },
      model: modelUsed,
      gate_coercion_events,
      repetition_events,
      harness_errors,
    };
  }

  // Loop: user → agent → until stop or cap.
  while (true) {
    const userTurnCount = trajectory.filter((t) => t.role === "user").length;
    if (userTurnCount >= scenarioHardMax) {
      stop_reason = "scenario_cap_hit";
      break;
    }

    const lastAssistant = [...trajectory]
      .reverse()
      .find((t) => t.role === "assistant");
    if (!lastAssistant?.structured) {
      harness_errors.push("No assistant turn to answer against");
      stop_reason = "harness_error";
      break;
    }

    const { answer, matched_rule_id } = answerAsSimulatedUser({
      scenario,
      state: userState,
      agentOutput: lastAssistant.structured,
    });

    const nextIndex = trajectory.length;
    trajectory.push({
      index: nextIndex,
      role: "user",
      content: answer,
      matched_rule_id,
    });

    const transcriptRows = toRowShape(trajectory);
    const priorCoverage = latestDimensionCoverage(
      transcriptRows.slice(0, -1) // exclude the user turn just added
    );
    const priorDecisionState = latestDecisionState(
      transcriptRows.slice(0, -1)
    );

    const turnStart = Date.now();
    let full: AgentTurnFullResult;
    try {
      full = await callAgent({
        context,
        transcript: transcriptRows,
        evidence: [],
        turn_count: userTurnCount + 1,
        openai_resume_file_id: file_id,
        is_kickoff: false,
        prior_dimension_coverage: priorCoverage,
        prior_decision_state: priorDecisionState,
        model_override: modelOverride,
        reasoning_effort: reasoningEffort,
      });
    } catch {
      stop_reason = "harness_error";
      break;
    }
    const latency = Date.now() - turnStart;

    const repeated = detectRepetition(full.output, priorCoverage);
    if (repeated) repetition_events += 1;

    const coerced = applyGateCoercion(full.output);
    if (coerced.coerced) gate_coercion_events += 1;

    input_tokens += full.usage.input_tokens;
    output_tokens += full.usage.output_tokens;
    total_tokens += full.usage.total_tokens;

    const asstContent =
      coerced.out.action === "ask_question"
        ? coerced.out.next_question
        : coerced.out.conclusion.summary || "(investigation concluded)";

    trajectory.push({
      index: trajectory.length,
      role: "assistant",
      content: asstContent,
      structured: coerced.out,
      usage: full.usage,
      model: full.model,
      latency_ms: latency,
    });

    if (coerced.out.action === "stop_and_conclude") {
      stop_reason = coerced.coerced ? "gate_coerced" : "agent_stop";
      break;
    }
  }

  return {
    trajectory,
    stop_reason,
    turn_count: trajectory.filter((t) => t.role === "user").length,
    usage_totals: { input_tokens, output_tokens, total_tokens },
    model: modelUsed,
    gate_coercion_events,
    repetition_events,
    harness_errors,
  };
}
