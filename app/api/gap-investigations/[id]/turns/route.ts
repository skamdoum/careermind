import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  INVESTIGATION_TURN_SAFETY_CAP,
  latestDecisionState,
  latestDimensionCoverage,
  loadInvestigationBundle,
} from "@/lib/db/gap-investigations";
import { runAgentTurn } from "@/lib/gap-investigation/agent";
import {
  operationErrorResponse,
  operationUsageHeaders,
  claimOperation,
  requestKey,
  inputHash,
  operationResponse,
  finishOperation,
  operationLifecycle,
  operationRpc,
} from "@/lib/ai-operations/server";

// POST /api/gap-investigations/[id]/turns
// Body: { content: string }
// Appends the user's answer, runs one agent iteration, appends the
// assistant's next turn (or transitions the investigation to concluded),
// persists any candidate evidence, and returns the updated bundle.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: userError?.message || "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const content =
      typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json(
        { success: false, error: "content is required" },
        { status: 400 }
      );
    }

    const claimed = await claimOperation(user.id, {
      kind: "gap_turn", key: requestKey(req), hash: inputHash([id, content]), context: {},
      investigationId: id, content, questionId: typeof body.question_id === "string" ? body.question_id : null,
    });
    if (claimed.outcome === "completed") {
      const data = await loadInvestigationBundle(claimed.result!.investigation_id!, user.id, supabase);
      if (!data) throw new Error("Completed investigation is unavailable");
      return NextResponse.json({ success: true, data, idempotent_replay: true });
    }
    const early = operationResponse(claimed, "gap_turn");
    if (early) return early;
    if (claimed.outcome !== "claimed") throw new Error("Operation not claimed");
    await finishOperation(claimed, {
      ...operationLifecycle(user.id, claimed),
      generate: async () => {
        const bundle = await loadInvestigationBundle(id, user.id, supabase);
        if (!bundle) throw new Error("Investigation not found");
        const { investigation, turns: fullTranscript, evidence } = bundle;
        const userTurnsSoFar = fullTranscript.filter((t) => t.role === "user").length;
        const priorCoverage = latestDimensionCoverage(fullTranscript);
        const priorDecisionState = latestDecisionState(fullTranscript);
        let agentOut = await runAgentTurn({
          context: investigation.context_snapshot, transcript: fullTranscript, evidence,
          turn_count: userTurnsSoFar, openai_resume_file_id: investigation.openai_resume_file_id,
          is_kickoff: false, prior_dimension_coverage: priorCoverage, prior_decision_state: priorDecisionState,
        });

        // Observational repetition log (no orchestration — just telemetry).
        // Fires when the agent proposes a next question that primarily
        // targets a dimension it marked "resolved" on the previous turn.
        // Useful for later eval; we do NOT retry or coerce the model today.
        if (
          agentOut.action === "ask_question" &&
          priorCoverage &&
          agentOut.next_question_target_dimension !== "other"
        ) {
          const dim = agentOut.next_question_target_dimension;
          const prior = priorCoverage[dim];
          if (prior?.status === "resolved") {
            console.warn(
              "[gap-investigations] repetition: next_question targets a resolved dimension",
              {
                investigation_id: investigation.id,
                turn: userTurnsSoFar,
                dimension: dim,
                prior_notes: prior.notes,
                next_question: agentOut.next_question,
              }
            );
          }
        }

        // Decision-sufficiency hard gate. If the model emits ask_question
        // while its own decision_state says the next question could NOT
        // materially change the conclusion, coerce to stop_and_conclude and
        // build the conclusion from decision_state.current_conclusion plus
        // material_uncertainty (as residual_gap). Trust the model's own
        // classification + summary when it populated them; otherwise derive.
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
          console.warn(
            "[gap-investigations] gate coerced ask_question to stop_and_conclude",
            {
              investigation_id: investigation.id,
              turn: userTurnsSoFar,
              current_conclusion: cc,
              decision_confidence: agentOut.decision_state.decision_confidence,
              material_uncertainty: uncertainty,
              suppressed_question: agentOut.next_question,
            }
          );
          agentOut = {
            ...agentOut,
            action: "stop_and_conclude" as const,
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
          };
        }

        // Server safety net: if the user has hit the soft cap and the model
        // still chose to ask a question, coerce it into a stop-and-conclude.
        if (
          userTurnsSoFar >= INVESTIGATION_TURN_SAFETY_CAP &&
          agentOut.action !== "stop_and_conclude"
        ) {
          agentOut = {
            ...agentOut,
            action: "stop_and_conclude" as const,
            conclusion: {
              underlying_capability:
                agentOut.conclusion?.underlying_capability || "partial",
              resume_evidence:
                agentOut.conclusion?.resume_evidence || "partial",
              target_role_fit:
                agentOut.conclusion?.target_role_fit || "partial",
              residual_gap: agentOut.conclusion?.residual_gap || "",
              classification:
                agentOut.conclusion?.classification || "partial_evidence",
              summary:
                agentOut.conclusion?.summary ||
                "Reached the turn-count safety cap. Concluding on evidence gathered so far.",
              remaining_uncertainty:
                agentOut.conclusion?.remaining_uncertainty ||
                "Additional focused questioning could still refine this classification.",
            },
          };
        }

        return { agent: agentOut };
      },
      finalize: () => operationRpc(user.id, "finalize_career_gap", { p_id: claimed.id, p_token: claimed.token }),
    });
    const data = await loadInvestigationBundle(id, user.id, supabase);
    if (!data) throw new Error("Investigation unavailable after completion");
    return NextResponse.json({ success: true, data }, { headers: operationUsageHeaders(claimed) });

  } catch (err: unknown) {
    const operationError = operationErrorResponse(err);
    if (operationError) return operationError;
    const msg =
      err instanceof Error ? err.message : "Failed to submit turn";
    console.error("[gap-investigations] turn POST error:", err);
    return NextResponse.json(
      { success: false, error: msg },
      { status: err instanceof OpenAI.APIError ? 502 : 500 }
    );
  }
}
