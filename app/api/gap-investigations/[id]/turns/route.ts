import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  INVESTIGATION_TURN_SAFETY_CAP,
  latestDecisionState,
  latestDimensionCoverage,
  loadInvestigationBundle,
  persistCandidateEvidence,
} from "@/lib/db/gap-investigations";
import { runAgentTurn } from "@/lib/gap-investigation/agent";

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

    const bundle = await loadInvestigationBundle(id, user.id);
    if (!bundle) {
      return NextResponse.json(
        { success: false, error: "Investigation not found" },
        { status: 404 }
      );
    }

    const { investigation, turns, evidence } = bundle;

    if (investigation.status !== "active") {
      return NextResponse.json(
        {
          success: false,
          error: `Investigation is ${investigation.status}; no further turns.`,
        },
        { status: 400 }
      );
    }

    // Append the user turn first — the model reads it in the next call
    // via the transcript block.
    const nextUserTurnIndex = turns.length;

    const { data: userTurn, error: userTurnErr } = await supabaseAdmin
      .from("gap_investigation_turns")
      .insert({
        investigation_id: investigation.id,
        user_id: user.id,
        role: "user",
        content,
        structured: null,
        turn_index: nextUserTurnIndex,
      })
      .select()
      .single();

    if (userTurnErr || !userTurn) {
      return NextResponse.json(
        {
          success: false,
          error: userTurnErr?.message || "Failed to save your answer",
        },
        { status: 500 }
      );
    }

    const fullTranscript = [
      ...turns,
      {
        ...userTurn,
        role: "user" as const,
      },
    ];

    // turn_count semantically = number of user turns so far, i.e. how many
    // exchanges the user has completed. That's the cap we enforce.
    const userTurnsSoFar = fullTranscript.filter(
      (t) => t.role === "user"
    ).length;

    // Pull forward the dimension coverage and decision_state the agent
    // set on its most recent assistant turn. Rendered into the prompt so
    // the model will not re-probe a dimension it already marked resolved
    // and so it carries forward its last conclusion / uncertainty.
    const priorCoverage = latestDimensionCoverage(turns);
    const priorDecisionState = latestDecisionState(turns);

    // Run the agent iteration.
    let agentOut;
    try {
      agentOut = await runAgentTurn({
        context: investigation.context_snapshot,
        transcript: fullTranscript,
        evidence,
        turn_count: userTurnsSoFar,
        openai_resume_file_id: investigation.openai_resume_file_id,
        is_kickoff: false,
        prior_dimension_coverage: priorCoverage,
        prior_decision_state: priorDecisionState,
      });
    } catch (agentErr: unknown) {
      const msg =
        agentErr instanceof Error ? agentErr.message : "Agent turn failed";
      return NextResponse.json(
        { success: false, error: msg },
        { status: 502 }
      );
    }

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

    // Persist the assistant turn.
    const assistantContent =
      agentOut.action === "ask_question"
        ? agentOut.next_question
        : agentOut.conclusion.summary || "(investigation concluded)";

    const { data: assistantTurn, error: asstErr } = await supabaseAdmin
      .from("gap_investigation_turns")
      .insert({
        investigation_id: investigation.id,
        user_id: user.id,
        role: "assistant",
        content: assistantContent,
        structured: agentOut,
        turn_index: nextUserTurnIndex + 1,
      })
      .select()
      .single();

    if (asstErr || !assistantTurn) {
      return NextResponse.json(
        {
          success: false,
          error: asstErr?.message || "Failed to save agent turn",
        },
        { status: 500 }
      );
    }

    // Persist any candidate evidence. transcriptTurnIds maps the model's
    // origin_user_turn_index back to a DB turn id.
    const transcriptWithNew = [
      ...fullTranscript,
      { role: "assistant" as const, turn_index: nextUserTurnIndex + 1 },
    ];
    const transcriptTurnIds = [
      ...turns.map((t) => t.id),
      userTurn.id as string,
      assistantTurn.id as string,
    ];

    await persistCandidateEvidence({
      investigationId: investigation.id,
      userId: user.id,
      transcript: transcriptWithNew,
      transcriptTurnIds,
      candidateEvidence: agentOut.candidate_evidence,
    });

    // Update investigation row: bump turn_count, transition on conclude.
    const updates: Record<string, unknown> = {
      turn_count: userTurnsSoFar,
      updated_at: new Date().toISOString(),
    };
    if (agentOut.action === "stop_and_conclude") {
      updates.status = "concluded";
      updates.conclusion = agentOut.conclusion.classification;
      updates.conclusion_summary = agentOut.conclusion.summary;
      updates.remaining_uncertainty = agentOut.conclusion.remaining_uncertainty;
      updates.underlying_capability = agentOut.conclusion.underlying_capability;
      updates.resume_evidence = agentOut.conclusion.resume_evidence;
      updates.target_role_fit = agentOut.conclusion.target_role_fit;
      updates.residual_gap = agentOut.conclusion.residual_gap;
    }
    await supabaseAdmin
      .from("gap_investigations")
      .update(updates)
      .eq("id", investigation.id);

    // Return the fresh bundle so the client has a single source of truth.
    const refreshed = await loadInvestigationBundle(investigation.id, user.id);

    return NextResponse.json({ success: true, data: refreshed });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to submit turn";
    console.error("[gap-investigations] turn POST error:", err);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}
