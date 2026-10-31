import { createHash } from "node:crypto";
import { z } from "zod";
import type { PlanRecommendation, RecommendationInput } from "./plan-recommendation-types";

export class AssessmentError extends Error {
  constructor(public code: string, message: string, public status = 422) { super(message); }
}

// Normalization is deliberately separate from the legacy bundle helper, whose
// module initializes an admin client. This path only consumes session-scoped reads.
export function normalizeEvidence(rows: Array<{ id: string; claim: string; user_status: string; user_edit: string | null; source_type: string }>) {
  return rows.filter(row => row.user_status === "confirmed" || row.user_status === "edited").map(row => {
    const claim = (row.user_status === "edited" ? row.user_edit : row.claim)?.trim();
    if (!claim) throw new AssessmentError("insufficient_grounding", "Confirm or edit the supporting evidence before checking your plan.");
    return { id: row.id, claim, source_type: row.source_type };
  });
}

const text = z.string().trim().min(1).max(3000);
export const modelAssessmentSchema = z.object({
  // Structured Outputs emits keys in schema order. Ground candidate facts before
  // comparing tasks, and choose the classification after the supporting fields.
  grounding: z.array(z.object({
    evidence_id: text,
    quote: z.string().trim().min(10).max(3000).describe("Contiguous verbatim substring of the referenced evidence.claim ONLY. Task text belongs in matches.coverage_reason, never here."),
  }).strict()).max(30).describe("Candidate evidence only; establish this before considering task coverage."),
  assessed_dimensions: z.object({
    underlying_capability: z.enum(["demonstrated", "partial", "not_demonstrated", "unknown"]),
    resume_evidence: z.enum(["demonstrates", "partial", "does_not_demonstrate", "unknown"]),
    target_role_fit: z.enum(["meets", "partial", "does_not_meet", "unknown"]),
  }).strict(),
  matches: z.array(z.object({ task_id: text, coverage_reason: text }).strict()).max(20),
  remaining_need: text.nullable(),
  proposed_task: z.object({ title: text, description: text, task_type: z.enum(["resume", "story", "interview_prep", "application", "networking", "strategy"]) }).strict().nullable(),
  rationale: text,
  outcome: z.enum(["FULL_MATCH", "PARTIAL_MATCH", "NO_MATCH", "NO_ACTION_NEEDED", "INSUFFICIENT_EVIDENCE"]).describe("Choose LAST, consistently with dimensions and task coverage. NO_ACTION_NEEDED requires all dimensions satisfied and no remaining need or proposal."),
}).strict();

export function validateRecommendation(input: RecommendationInput, raw: unknown): PlanRecommendation {
  const result = modelAssessmentSchema.safeParse(raw);
  if (!result.success) throw new AssessmentError("invalid_assessment", "The recommendation could not be validated. Please try again.", 502);
  const model = result.data;
  if (!input.evidence.length || model.outcome === "INSUFFICIENT_EVIDENCE" || Object.values(model.assessed_dimensions).includes("unknown")) {
    throw new AssessmentError("insufficient_grounding", "The validated evidence is not sufficient to assess all three dimensions. Confirm or edit the relevant evidence first.");
  }
  const invalid = () => { throw new AssessmentError("invalid_assessment", "The recommendation contained unsupported or contradictory information. Please try again.", 502); };
  if (!model.grounding.length) invalid();
  for (const citation of model.grounding) {
    const evidence = input.evidence.find(row => row.id === citation.evidence_id);
    if (!evidence || !evidence.claim.includes(citation.quote)) invalid();
  }
  const tasks = input.plans.flatMap(plan => plan.tasks);
  const seen = new Set<string>();
  const matches = model.matches.map(match => {
    const task = tasks.find(row => row.id === match.task_id);
    if (!task || seen.has(match.task_id)) return invalid();
    seen.add(match.task_id);
    // IDs, plan association, titles and current status are always server-controlled.
    return { task_id: task.id, plan_id: task.plan_id, title: task.title, description: task.description, status: task.status, coverage_reason: match.coverage_reason };
  });
  const allMet = model.assessed_dimensions.underlying_capability === "demonstrated" && model.assessed_dimensions.resume_evidence === "demonstrates" && model.assessed_dimensions.target_role_fit === "meets";
  switch (model.outcome) {
    case "FULL_MATCH": if (!matches.length || model.proposed_task || model.remaining_need || allMet) invalid(); break;
    case "PARTIAL_MATCH": if (!matches.length || !model.proposed_task || !model.remaining_need || allMet) invalid(); break;
    case "NO_MATCH": if (matches.length || !model.proposed_task || !model.remaining_need || allMet) invalid(); break;
    case "NO_ACTION_NEEDED": if (matches.length || model.proposed_task || model.remaining_need || !allMet) invalid(); break;
  }
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (model.proposed_task && tasks.some(task => normalize(`${task.title} ${task.description ?? ""}`) === normalize(`${model.proposed_task!.title} ${model.proposed_task!.description}`))) invalid();
  return {
    outcome: model.outcome,
    investigation_id: input.investigation_id,
    seed_analysis_id: input.seed_analysis_id,
    source_hash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    plan_availability: !input.plans.length ? "missing" : tasks.length ? "available" : "empty",
    matches, remaining_need: model.remaining_need, proposed_task: model.proposed_task, rationale: model.rationale,
    supporting_evidence_ids: [...new Set(model.grounding.map(row => row.evidence_id))],
  };
}
