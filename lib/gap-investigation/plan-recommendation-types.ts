import type { PlanTaskStatus } from "@/lib/action-plans/types";

export type EvidenceClaim = { id: string; claim: string; source_type: string };
export type RecommendationTask = { id: string; plan_id: string; title: string; description: string | null; status: PlanTaskStatus };
export type RecommendationInput = {
  investigation_id: string;
  seed_analysis_id: string;
  target: { role: string; level: string; requirements: string[] };
  finding: { title: string; reported_dimensions: { underlying_capability: string | null; resume_evidence: string | null; target_role_fit: string | null } | null; reported_residual_gap: string | null };
  evidence: EvidenceClaim[];
  plans: Array<{ id: string; tasks: RecommendationTask[] }>;
};
export type PlanRecommendation = {
  outcome: "FULL_MATCH" | "PARTIAL_MATCH" | "NO_MATCH" | "NO_ACTION_NEEDED";
  investigation_id: string;
  seed_analysis_id: string;
  source_hash: string;
  plan_availability: "available" | "empty" | "missing";
  matches: Array<Omit<RecommendationTask, "id"> & { task_id: string; coverage_reason: string }>;
  remaining_need: string | null;
  proposed_task: { title: string; description: string; task_type: string } | null;
  rationale: string;
  supporting_evidence_ids: string[];
};
