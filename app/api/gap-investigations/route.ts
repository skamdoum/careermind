import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import {
  runAgentTurn,
  uploadResumeFileForInvestigation,
} from "@/lib/gap-investigation/agent";
import {
  InvestigationContextSnapshot,
} from "@/lib/db/gap-investigations";
import {
  operationErrorResponse,
  operationUsageHeaders,
  claimOperation,
  lookupOperation,
  requestKey,
  inputHash,
  operationResponse,
  finishOperation,
  operationLifecycle,
  operationRpc,
} from "@/lib/ai-operations/server";

// POST /api/gap-investigations
// Body: { gap_id: string }
// Creates an investigation for the seed gap: freezes context snapshot,
// uploads the analysis's resume to OpenAI once, runs the kickoff agent
// turn, persists first assistant turn + any resume-source evidence, and
// returns the new investigation id + initial state so the client can
// redirect to the investigation page.
export async function POST(req: Request) {
  try {
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
    const gapId =
      typeof body?.gap_id === "string" ? body.gap_id.trim() : "";
    if (!gapId) {
      return NextResponse.json(
        { success: false, error: "gap_id is required" },
        { status: 400 }
      );
    }

    const key = requestKey(req);
    const hash = inputHash([gapId]);
    const existing = await lookupOperation(user.id, "gap_kickoff", key, hash);
    if (existing) {
      const replay = operationResponse(existing, "gap_kickoff");
      if (replay) return replay;
    }
    let operationContext = existing?.context;
    if (!operationContext) {
      const activeProfile = await resolveActiveCareerProfile(supabase, user.id);

      // Load the seed gap (RLS-scoped to the caller).
      const { data: seedGap, error: gapErr } = await supabase
        .from("gaps")
        .select(
          "id, analysis_id, user_id, gap_code, gap_title, gap_description, recommended_fix, priority"
        )
        .eq("id", gapId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (gapErr) {
        return NextResponse.json(
          { success: false, error: gapErr.message },
          { status: 500 }
        );
      }
      if (!seedGap) {
        return NextResponse.json(
          { success: false, error: "Gap not found" },
          { status: 404 }
        );
      }

      // Load the analysis this gap belongs to. It must belong to the
      // active career profile — otherwise refuse (context would be stale).
      const { data: analysis, error: analysisErr } = await supabase
        .from("analyses")
        .select(
          "id, raw_json, summary, career_profile_id, career_goal_id, job_description_id, resume_id"
        )
        .eq("id", seedGap.analysis_id)
        .eq("user_id", user.id)
        .eq("career_profile_id", activeProfile.id)
        .maybeSingle();

      if (analysisErr) {
        return NextResponse.json(
          { success: false, error: analysisErr.message },
          { status: 500 }
        );
      }
      if (!analysis) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Analysis for this gap is not available under the active job search.",
          },
          { status: 404 }
        );
      }

      // Resolve target role/level via career_goal + job_description.
      let targetRole = "PM";
      let targetLevel = "Senior";
      if (analysis.job_description_id) {
        const { data: job } = await supabase
          .from("job_descriptions")
          .select("id, role_title, career_goal_id")
          .eq("id", analysis.job_description_id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (job?.role_title) targetRole = job.role_title;
      }
      if (analysis.career_goal_id) {
        const { data: goal } = await supabase
          .from("career_goals")
          .select("id, target_level, target_function")
          .eq("id", analysis.career_goal_id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (goal?.target_level) targetLevel = goal.target_level;
        if (goal?.target_function && targetRole === "PM") {
          targetRole = goal.target_function;
        }
      }

      // Resolve the resume tied to this analysis. Preferred: the resume
      // that was actually sent to the analyzer.
      let resumeRow: {
        id: string;
        file_path: string;
        file_name: string | null;
        mime_type: string | null;
      } | null = null;

      if (analysis.resume_id) {
        const { data: r } = await supabase
          .from("resumes")
          .select("id, file_path, file_name, mime_type")
          .eq("id", analysis.resume_id)
          .eq("user_id", user.id)
          .eq("career_profile_id", activeProfile.id)
          .maybeSingle();
        if (r) resumeRow = r;
      }

      // Fall back to the newest resume for this profile if the analysis
      // pre-dated resume_id (older rows).
      if (!resumeRow) {
        const { data: r } = await supabase
          .from("resumes")
          .select("id, file_path, file_name, mime_type")
          .eq("user_id", user.id)
          .eq("career_profile_id", activeProfile.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (r) resumeRow = r;
      }

      // Related signals: same-analysis signals whose code semantically
      // relates to this gap code. V1 keeps this loose — same code, or a
      // few well-known adjacencies.
      const analysisRaw = (analysis.raw_json ?? {}) as {
        positioning_summary?: string;
        signals?: Array<{
          signal_code?: string;
          signal_name?: string;
          name?: string;
          score?: number;
          rationale?: string;
          reasoning?: string;
        }>;
      };
      const relatedSignals = pickRelatedSignals(
        analysisRaw.signals ?? [],
        seedGap.gap_code
      );

      const contextSnapshot: InvestigationContextSnapshot = {
        gap: {
          gap_code: seedGap.gap_code ?? null,
          gap_title: seedGap.gap_title ?? "Gap",
          gap_description: seedGap.gap_description ?? "",
          recommended_fix: seedGap.recommended_fix ?? null,
          severity: null,
        },
        target: {
          role: targetRole,
          level: targetLevel,
        },
        analysis: {
          id: analysis.id as string,
          positioning_summary:
            analysisRaw.positioning_summary ??
            (analysis.summary as string | null) ??
            null,
          related_signals: relatedSignals,
        },
        resume: {
          id: resumeRow?.id ?? null,
          file_name: resumeRow?.file_name ?? null,
        },
      };

      operationContext = { career_profile_id: activeProfile.id, seed_gap_id: seedGap.id, seed_analysis_id: analysis.id, gap_code: seedGap.gap_code ?? null, snapshot: contextSnapshot, resume: resumeRow };
    }
    const claimed = await claimOperation(user.id, {
      kind: "gap_kickoff", key, hash,
      context: operationContext,
    });
    const early = operationResponse(claimed, "gap_kickoff");
    if (early) return early;
    if (claimed.outcome !== "claimed") throw new Error("Operation not claimed");
    const data = await finishOperation(claimed, {
      ...operationLifecycle(user.id, claimed),
      generate: async () => {
        const resume = claimed.context.resume;
        let fileId: string | null = null;
        if (resume) {
          const { data: blob, error } = await supabase.storage.from("resumes").download(resume.file_path);
          if (error || !blob) throw new Error("Resume download failed");
          fileId = await uploadResumeFileForInvestigation({ blob, fileName: resume.file_name || "resume.pdf", mimeType: resume.mime_type || "application/octet-stream" });
        }
        const agent = await runAgentTurn({
          context: claimed.context.snapshot!, transcript: [], evidence: [], turn_count: 0,
          openai_resume_file_id: fileId, is_kickoff: true,
          prior_dimension_coverage: null, prior_decision_state: null,
        });
        return { agent, file_id: fileId };
      },
      finalize: () => operationRpc(user.id, "finalize_career_gap", { p_id: claimed.id, p_token: claimed.token }),
    });
    return NextResponse.json({ success: true, data }, { headers: operationUsageHeaders(claimed) });

  } catch (err: unknown) {
    const operationError = operationErrorResponse(err);
    if (operationError) return operationError;
    const msg =
      err instanceof Error ? err.message : "Failed to start investigation";
    console.error("[gap-investigations] POST error:", err);
    return NextResponse.json(
      { success: false, error: msg },
      { status: err instanceof OpenAI.APIError ? 502 : 500 }
    );
  }
}

// -----------------------------------------------------------------
// Coarse related-signal picker for the context snapshot. V1 heuristic:
// same code, or a small hand-picked adjacency map. Kept in this file
// because it's a local packaging concern for the snapshot, not domain
// logic worth its own module.
// -----------------------------------------------------------------
const GAP_TO_SIGNAL_ADJACENCY: Record<string, string[]> = {
  quantified_impact: ["execution", "product_strategy"],
  strategic_scope: ["product_strategy", "stakeholder_influence", "ownership"],
  organizational_influence: [
    "stakeholder_influence",
    "cross_functional_leadership",
  ],
  technical_depth: ["technical_depth", "platform_thinking"],
  customer_orientation: ["customer_orientation", "product_sense"],
  product_strategy: ["product_strategy", "product_sense"],
  cross_functional_leadership: [
    "cross_functional_leadership",
    "stakeholder_influence",
  ],
  execution_scale: ["execution", "ownership"],
  domain_depth: ["technical_depth", "product_sense"],
  ai_product_depth: ["ai_product_judgment", "technical_depth"],
};

function pickRelatedSignals(
  signals: Array<{
    signal_code?: string;
    signal_name?: string;
    name?: string;
    score?: number;
    rationale?: string;
    reasoning?: string;
  }>,
  gapCode: string | null
): InvestigationContextSnapshot["analysis"]["related_signals"] {
  const relatedCodes = new Set<string>(
    gapCode ? GAP_TO_SIGNAL_ADJACENCY[gapCode] ?? [] : []
  );

  const scored = signals
    .filter(
      (s) =>
        typeof s.score === "number" && (s.signal_name || s.name || s.signal_code)
    )
    .map((s) => ({
      name: (s.signal_name || s.name || s.signal_code || "").trim(),
      score: Number(s.score) || 0,
      rationale: (s.rationale || s.reasoning || "").trim(),
      related: s.signal_code ? relatedCodes.has(s.signal_code) : false,
    }));

  const related = scored.filter((s) => s.related);
  const chosen = related.length > 0 ? related : scored.slice(0, 3);

  return chosen.slice(0, 4).map((s) => ({
    signal_name: s.name,
    score: s.score,
    rationale: s.rationale,
  }));
}
