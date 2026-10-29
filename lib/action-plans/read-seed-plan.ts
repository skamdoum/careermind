import type { SupabaseClient } from "@supabase/supabase-js";
import { AssessmentError, normalizeEvidence } from "@/lib/gap-investigation/plan-recommendation";
import type { RecommendationInput, RecommendationTask } from "@/lib/gap-investigation/plan-recommendation-types";
import type { GapInvestigationRow, GapInvestigationEvidenceRow } from "@/lib/db/gap-investigations";

// No profile resolver: its fallback creates/updates records. No admin client.
export async function readSeedPlan(client: SupabaseClient, userId: string, investigationId: string): Promise<RecommendationInput> {
  const check = (error: unknown) => { if (error) throw new AssessmentError("read_unavailable", "Could not read the investigation and saved plan. Please try again.", 503); };
  const { data: profile, error: profileError } = await client.from("profiles").select("active_career_profile_id").eq("id", userId).maybeSingle();
  check(profileError);
  if (!profile?.active_career_profile_id) throw new AssessmentError("active_profile_required", "Select an existing job search before checking your plan.", 409);
  const { data: active, error: activeError } = await client.from("career_profiles").select("id").eq("id", profile.active_career_profile_id).eq("user_id", userId).maybeSingle();
  check(activeError);
  if (!active) throw new AssessmentError("active_profile_required", "Select an existing job search before checking your plan.", 409);
  const { data, error } = await client.from("gap_investigations").select("id,user_id,career_profile_id,status,seed_analysis_id,context_snapshot,underlying_capability,resume_evidence,target_role_fit,residual_gap").eq("id", investigationId).eq("user_id", userId).eq("career_profile_id", active.id).maybeSingle();
  check(error);
  if (!data) throw new AssessmentError("investigation_not_found", "Investigation not found in the active job search.", 404);
  const investigation = data as GapInvestigationRow;
  if (investigation.status !== "concluded") throw new AssessmentError("investigation_not_concluded", "Conclude the investigation before checking your plan.", 409);
  if (!investigation.seed_analysis_id) throw new AssessmentError("seed_analysis_unavailable", "The originating analysis is no longer available.", 409);
  const { data: analysis, error: analysisError } = await client.from("analyses").select("id,raw_json").eq("id", investigation.seed_analysis_id).eq("user_id", userId).eq("career_profile_id", active.id).maybeSingle();
  check(analysisError);
  if (!analysis) throw new AssessmentError("seed_analysis_unavailable", "The originating analysis is no longer available.", 409);

  // Stable pagination within the exact authorized parent scope, never another analysis.
  const plans: RecommendationInput["plans"] = [];
  for (let offset = 0; ; offset += 100) {
    const { data: page, error: planError } = await client.from("plans").select("id").eq("analysis_id", analysis.id).eq("user_id", userId).order("id").range(offset, offset + 99);
    check(planError);
    for (const plan of page ?? []) {
      const tasks: RecommendationTask[] = [];
      for (let taskOffset = 0; ; taskOffset += 100) {
        const { data: taskPage, error: taskError } = await client.from("plan_tasks").select("id,plan_id,title,description,status").eq("plan_id", plan.id).eq("user_id", userId).order("id").range(taskOffset, taskOffset + 99);
        check(taskError); tasks.push(...(taskPage ?? []) as RecommendationTask[]);
        if ((taskPage ?? []).length < 100) break;
      }
      plans.push({ id: plan.id, tasks });
    }
    if ((page ?? []).length < 100) break;
  }
  const evidenceRows: GapInvestigationEvidenceRow[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data: page, error: evidenceError } = await client.from("gap_investigation_evidence").select("id,claim,user_status,user_edit,source_type").eq("investigation_id", investigation.id).eq("user_id", userId).in("user_status", ["confirmed", "edited"]).order("id").range(offset, offset + 99);
    check(evidenceError); evidenceRows.push(...(page ?? []) as GapInvestigationEvidenceRow[]);
    if ((page ?? []).length < 100) break;
  }
  const evidence = normalizeEvidence(evidenceRows);
  if (!evidence.length) throw new AssessmentError("insufficient_grounding", "Confirm or edit the supporting evidence before checking your plan.");
  const edited = evidenceRows.some(row => row.user_status === "edited");
  const raw = analysis.raw_json as { role_requirements?: Array<{ requirement?: unknown }> } | null;
  const requirements = Array.isArray(raw?.role_requirements) ? raw.role_requirements.map(row => row?.requirement).filter((value): value is string => typeof value === "string" && !!value.trim()) : [];
  if (!investigation.context_snapshot?.target?.role || !investigation.context_snapshot?.target?.level || !requirements.length) {
    throw new AssessmentError("insufficient_grounding", "The originating target requirements are incomplete. This investigation cannot be assessed reliably.");
  }
  return {
    investigation_id: investigation.id, seed_analysis_id: analysis.id,
    target: { role: investigation.context_snapshot?.target?.role ?? "Unspecified", level: investigation.context_snapshot?.target?.level ?? "Unspecified", requirements: requirements },
    finding: { title: investigation.context_snapshot?.gap?.gap_title ?? "Investigated gap", reported_dimensions: edited ? null : { underlying_capability: investigation.underlying_capability, resume_evidence: investigation.resume_evidence, target_role_fit: investigation.target_role_fit }, reported_residual_gap: edited ? null : investigation.residual_gap },
    evidence, plans,
  };
}
