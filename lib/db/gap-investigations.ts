import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Shared type surface for the Gap Investigation Agent.
// Kept intentionally narrow — the DB is the source of truth; these types
// mirror the columns we actually read/write.

export type InvestigationStatus = "active" | "concluded" | "abandoned";

// Internal classification. `scope_mismatch` is used when the underlying
// capability is demonstrated but the target-role-specific scope is not —
// e.g. strong product-strategy ownership at scale on a non-platform
// product, evaluated against a Platform PM target. It is NOT the primary
// user-facing message; the UI renders the four structured dimensions
// instead. Stored for evaluation / debugging.
export type InvestigationConclusion =
  | "evidence_gap"
  | "partial_evidence"
  | "capability_gap"
  | "scope_mismatch";

// Independent structured dimensions of the investigation conclusion.
// Decoupling them lets the UI say "capability demonstrated, target scope
// partial" instead of collapsing both into a single misleading label.
export type UnderlyingCapabilityStatus =
  | "demonstrated"
  | "partial"
  | "not_demonstrated";

export type ResumeEvidenceStatus =
  | "demonstrates"
  | "partial"
  | "does_not_demonstrate";

export type TargetRoleFitStatus = "meets" | "partial" | "does_not_meet";

export type EvidenceSourceType = "resume" | "user" | "inference";

export type EvidenceLevel = "direct" | "supporting" | "adjacent" | "none";

export type UserEvidenceStatus =
  | "pending"
  | "confirmed"
  | "edited"
  | "rejected";

export type TurnRole = "assistant" | "user";

export type EvidenceDimensions = {
  ownership: string;
  scope: string;
  complexity: string;
  outcome: string;
};

// Per-turn coverage of the four evidence dimensions. Promoted to a
// first-class field in the agent output so the model has to explicitly
// mark a dimension before moving on, and the next turn can see what was
// already resolved. Primarily eval telemetry; the server also logs when
// a next_question targets a dimension previously marked resolved.
export type DimensionCoverageStatus = "unresolved" | "partial" | "resolved";

export type DimensionCoverageEntry = {
  status: DimensionCoverageStatus;
  notes: string;
};

export type DimensionCoverage = {
  ownership: DimensionCoverageEntry;
  scope: DimensionCoverageEntry;
  complexity: DimensionCoverageEntry;
  outcome: DimensionCoverageEntry;
  // target_role_fit is tracked alongside the four evidence dimensions
  // so the model has to mark the target-role-specific sub-scope as a
  // first-class coverage checkbox — not only inside the conclusion.
  target_role_fit: DimensionCoverageEntry;
};

export type DimensionName = keyof DimensionCoverage;

export const DIMENSION_NAMES: DimensionName[] = [
  "ownership",
  "scope",
  "complexity",
  "outcome",
  "target_role_fit",
];

export type GapInvestigationRow = {
  id: string;
  user_id: string;
  career_profile_id: string;
  seed_gap_id: string | null;
  seed_analysis_id: string | null;
  gap_code: string | null;
  context_snapshot: InvestigationContextSnapshot;
  status: InvestigationStatus;
  conclusion: InvestigationConclusion | null;
  conclusion_summary: string | null;
  remaining_uncertainty: string | null;
  underlying_capability: UnderlyingCapabilityStatus | null;
  resume_evidence: ResumeEvidenceStatus | null;
  target_role_fit: TargetRoleFitStatus | null;
  residual_gap: string | null;
  model_name: string | null;
  openai_resume_file_id: string | null;
  turn_count: number;
  created_at: string;
  updated_at: string;
};

export type GapInvestigationTurnRow = {
  id: string;
  investigation_id: string;
  user_id: string;
  role: TurnRole;
  content: string;
  structured: unknown | null;
  turn_index: number;
  created_at: string;
};

export type GapInvestigationEvidenceRow = {
  id: string;
  investigation_id: string;
  user_id: string;
  origin_turn_id: string | null;
  source_type: EvidenceSourceType;
  claim: string;
  resume_excerpt: string | null;
  dimensions: EvidenceDimensions | null;
  evidence_level: EvidenceLevel | null;
  user_status: UserEvidenceStatus;
  user_edit: string | null;
  created_at: string;
  updated_at: string;
};

// Context frozen at investigation-creation time. Kept as JSONB on the
// investigation row so we can replay the investigation later even if the
// seed gap row was overwritten by a subsequent re-analysis.
export type InvestigationContextSnapshot = {
  gap: {
    gap_code: string | null;
    gap_title: string;
    gap_description: string;
    recommended_fix: string | null;
    severity: string | null;
  };
  target: {
    role: string;
    level: string;
  };
  analysis: {
    id: string;
    positioning_summary: string | null;
    // Small, curated: only the signals whose code overlaps or aligns with
    // this gap. Kept short so it fits comfortably in the model prompt.
    related_signals: Array<{
      signal_name: string;
      score: number;
      rationale: string;
    }>;
  };
  resume: {
    id: string | null;
    file_name: string | null;
  };
};

export type InvestigationBundle = {
  investigation: GapInvestigationRow;
  turns: GapInvestigationTurnRow[];
  evidence: GapInvestigationEvidenceRow[];
};

// ---------------------------------------------------------------------
// Convenience helpers. All writes use the admin client because the
// investigation flow runs inside API routes that have already authorized
// the user upstream and know the user_id to scope to. The service-role client bypasses RLS; explicit ownership predicates
// are mandatory. API operation routes pass their user-scoped client instead.
// ---------------------------------------------------------------------

export async function loadInvestigationBundle(
  investigationId: string,
  userId: string,
  userClient?: SupabaseClient
): Promise<InvestigationBundle | null> {
  const client = userClient ?? supabaseAdmin;
  const { data: investigation, error: invErr } = await client
    .from("gap_investigations")
    .select("*")
    .eq("id", investigationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (invErr) {
    throw new Error(`Failed to load investigation: ${invErr.message}`);
  }
  if (!investigation) return null;

  const [turnsRes, evidenceRes] = await Promise.all([
    client
      .from("gap_investigation_turns")
      .select("*")
      .eq("investigation_id", investigationId)
      .eq("user_id", userId)
      .order("turn_index", { ascending: true }),
    client
      .from("gap_investigation_evidence")
      .select("*")
      .eq("investigation_id", investigationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  ]);

  if (turnsRes.error) {
    throw new Error(`Failed to load turns: ${turnsRes.error.message}`);
  }
  if (evidenceRes.error) {
    throw new Error(`Failed to load evidence: ${evidenceRes.error.message}`);
  }

  return {
    investigation: investigation as GapInvestigationRow,
    turns: (turnsRes.data ?? []) as GapInvestigationTurnRow[],
    evidence: (evidenceRes.data ?? []) as GapInvestigationEvidenceRow[],
  };
}

// Confirmed evidence contract — the single call any downstream feature
// (resume-rewrite agent, action-plan updates, etc.) should use when
// consuming an investigation's validated output. This encodes the
// grounding guarantee: only user-confirmed or user-edited claims count.
export function validatedEvidence(
  evidence: GapInvestigationEvidenceRow[]
): GapInvestigationEvidenceRow[] {
  return evidence.filter(
    (e) => e.user_status === "confirmed" || e.user_status === "edited"
  );
}

// Soft cap for server safety net. The model owns primary stop discipline;
// the cap only fires if the model refuses to converge. A healthy
// investigation converges much earlier — we should measure turn-count
// distribution as an agent-quality metric.
export const INVESTIGATION_TURN_SAFETY_CAP = 12;

// Extract the most recent assistant-turn dimension_coverage from the
// transcript. Returns null if none exists (kickoff turn). Shape-safe
// against older rows: dimensions missing from the stored structure
// default to {status: "unresolved", notes: "not tracked in prior turn"}
// so an in-flight investigation created before target_role_fit was
// tracked keeps working.
export function latestDimensionCoverage(
  transcript: GapInvestigationTurnRow[]
): DimensionCoverage | null {
  const defaultEntry = (): DimensionCoverageEntry => ({
    status: "unresolved",
    notes: "not tracked in prior turn",
  });
  for (let i = transcript.length - 1; i >= 0; i--) {
    const t = transcript[i];
    if (t.role !== "assistant") continue;
    const s = t.structured as { dimension_coverage?: unknown } | null;
    const dc = s?.dimension_coverage;
    if (!dc || typeof dc !== "object") continue;
    const entry = (name: DimensionName): DimensionCoverageEntry => {
      const raw = (dc as Record<string, unknown>)[name];
      if (!raw || typeof raw !== "object") return defaultEntry();
      const r = raw as { status?: unknown; notes?: unknown };
      const status =
        r.status === "resolved" || r.status === "partial"
          ? (r.status as DimensionCoverageStatus)
          : "unresolved";
      return {
        status,
        notes: typeof r.notes === "string" ? r.notes : "",
      };
    };
    return {
      ownership: entry("ownership"),
      scope: entry("scope"),
      complexity: entry("complexity"),
      outcome: entry("outcome"),
      target_role_fit: entry("target_role_fit"),
    };
  }
  return null;
}

// Decision state the agent emits every turn. Lives in the assistant
// turn's `structured` JSON (no DB column change). Used by the server to
// enforce the material-change hard gate, and later as evaluation
// telemetry so we can measure stop decisions against outcomes.
export type DecisionConfidence = "low" | "medium" | "high";

export type HypothesisStatus =
  | "intact"
  | "partially_disproven"
  | "disproven"
  | "confirmed";

export type DecisionState = {
  current_conclusion: {
    underlying_capability: UnderlyingCapabilityStatus;
    resume_evidence: ResumeEvidenceStatus;
    target_role_fit: TargetRoleFitStatus;
  };
  decision_confidence: DecisionConfidence;
  material_uncertainty: string;
  would_next_question_change_conclusion: boolean;
  hypothesis_status: HypothesisStatus;
};

// Pull the most recent assistant turn's decision_state. Returns null
// for the kickoff turn or when no prior turn carried a decision_state
// (older rows). Lenient on missing / malformed fields so a half-shaped
// prior turn never breaks the next call.
export function latestDecisionState(
  transcript: GapInvestigationTurnRow[]
): DecisionState | null {
  const okConfidence = (v: unknown): v is DecisionConfidence =>
    v === "low" || v === "medium" || v === "high";
  const okHyp = (v: unknown): v is HypothesisStatus =>
    v === "intact" ||
    v === "partially_disproven" ||
    v === "disproven" ||
    v === "confirmed";
  const okUC = (v: unknown): v is UnderlyingCapabilityStatus =>
    v === "demonstrated" || v === "partial" || v === "not_demonstrated";
  const okRE = (v: unknown): v is ResumeEvidenceStatus =>
    v === "demonstrates" || v === "partial" || v === "does_not_demonstrate";
  const okTF = (v: unknown): v is TargetRoleFitStatus =>
    v === "meets" || v === "partial" || v === "does_not_meet";

  for (let i = transcript.length - 1; i >= 0; i--) {
    const t = transcript[i];
    if (t.role !== "assistant") continue;
    const s = t.structured as { decision_state?: unknown } | null;
    const ds = s?.decision_state;
    if (!ds || typeof ds !== "object") continue;
    const r = ds as {
      current_conclusion?: unknown;
      decision_confidence?: unknown;
      material_uncertainty?: unknown;
      would_next_question_change_conclusion?: unknown;
      hypothesis_status?: unknown;
    };
    const cc = r.current_conclusion as Record<string, unknown> | undefined;
    if (!cc || typeof cc !== "object") continue;
    const uc = okUC(cc.underlying_capability) ? cc.underlying_capability : "partial";
    const re = okRE(cc.resume_evidence) ? cc.resume_evidence : "partial";
    const tf = okTF(cc.target_role_fit) ? cc.target_role_fit : "partial";
    return {
      current_conclusion: {
        underlying_capability: uc,
        resume_evidence: re,
        target_role_fit: tf,
      },
      decision_confidence: okConfidence(r.decision_confidence)
        ? r.decision_confidence
        : "low",
      material_uncertainty:
        typeof r.material_uncertainty === "string" ? r.material_uncertainty : "",
      would_next_question_change_conclusion:
        r.would_next_question_change_conclusion === true,
      hypothesis_status: okHyp(r.hypothesis_status)
        ? r.hypothesis_status
        : "intact",
    };
  }
  return null;
}

// -----------------------------------------------------------------
// Persist candidate_evidence rows produced by an agent turn.
// Validates provenance: source_type = "user" requires a valid transcript
// user-turn index (used to resolve origin_turn_id). Everything else is
// inserted with origin_turn_id resolved only when the referenced index
// is a user turn — we never attach a claim to a turn the user didn't own.
// -----------------------------------------------------------------
export async function persistCandidateEvidence(args: {
  investigationId: string;
  userId: string;
  // Ordered list of turn ids in the full transcript so we can resolve
  // origin_user_turn_index → origin_turn_id. Length must equal the total
  // number of turns visible to the model when it produced these claims.
  transcriptTurnIds: string[];
  transcript: Array<{ role: TurnRole; turn_index: number }>;
  candidateEvidence: Array<{
    source_type: EvidenceSourceType;
    claim: string;
    resume_excerpt: string;
    origin_user_turn_index: number;
    dimensions: EvidenceDimensions;
    evidence_level: EvidenceLevel;
  }>;
}): Promise<void> {
  const items = args.candidateEvidence ?? [];
  if (items.length === 0) return;

  const rows = items
    .map((ev) => {
      let originTurnId: string | null = null;
      const idx = ev.origin_user_turn_index;
      const inRange =
        Number.isInteger(idx) && idx >= 0 && idx < args.transcript.length;
      const isUserTurn = inRange && args.transcript[idx].role === "user";

      if (ev.source_type === "user" && isUserTurn) {
        originTurnId = args.transcriptTurnIds[idx] ?? null;
      } else if (ev.source_type === "inference" && isUserTurn) {
        originTurnId = args.transcriptTurnIds[idx] ?? null;
      }

      const claim = (ev.claim ?? "").trim();
      if (!claim) return null;

      return {
        investigation_id: args.investigationId,
        user_id: args.userId,
        origin_turn_id: originTurnId,
        source_type: ev.source_type,
        claim,
        resume_excerpt: ev.resume_excerpt?.trim() || null,
        dimensions: ev.dimensions ?? null,
        evidence_level: ev.evidence_level ?? null,
        user_status: "pending" as const,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  const { error } = await supabaseAdmin
    .from("gap_investigation_evidence")
    .insert(rows);

  if (error) {
    // Non-fatal: the turn is already persisted. Log and continue.
    console.error("[gap-investigations] evidence insert error:", error);
  }
}
