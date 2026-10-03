import OpenAI from "openai";
import {
  DIMENSION_NAMES,
  DecisionState,
  DimensionCoverage,
  DimensionName,
  EvidenceLevel,
  EvidenceSourceType,
  GapInvestigationEvidenceRow,
  GapInvestigationTurnRow,
  INVESTIGATION_TURN_SAFETY_CAP,
  InvestigationContextSnapshot,
  InvestigationConclusion,
  ResumeEvidenceStatus,
  TargetRoleFitStatus,
  UnderlyingCapabilityStatus,
} from "@/lib/db/gap-investigations";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const AGENT_MODEL_NAME = "gpt-4.1";

// The agent's structured output. Every field is always present — strict
// JSON schema requires it. The server interprets the fields per `action`:
//   ask_question → next_question is the assistant's next turn content;
//                  candidate_evidence may be []; conclusion is ignored.
//   stop_and_conclude → conclusion is persisted; next_question is ignored.
// `stop_assessment` and `dimension_coverage` are required every turn so
// the model has to reason about stop and coverage explicitly before
// choosing action.
export type AgentTurnOutput = {
  action: "ask_question" | "stop_and_conclude";
  reasoning_note: string;
  next_question: string;
  // Which dimension the next_question is primarily probing. "other"
  // covers synthesis / hypothesis-check questions that are not targeting
  // one of the tracked dimensions. Used server-side (log-only) to detect
  // repetition against the latest dimension_coverage.
  next_question_target_dimension:
    | "ownership"
    | "scope"
    | "complexity"
    | "outcome"
    | "target_role_fit"
    | "other";
  candidate_evidence: Array<{
    source_type: EvidenceSourceType;
    claim: string;
    resume_excerpt: string;
    origin_user_turn_index: number;
    dimensions: {
      ownership: string;
      scope: string;
      complexity: string;
      outcome: string;
    };
    evidence_level: EvidenceLevel;
  }>;
  // Per-turn rollup of what the agent considers covered. "resolved" now
  // means "sufficient for the classification decision at the target
  // role" — NOT "exhaustively evidenced." Includes target_role_fit as a
  // first-class checkbox so the pin on the target-specific sub-scope
  // produces a visible stopping signal.
  dimension_coverage: DimensionCoverage;
  // Governs stopping. If would_next_question_change_conclusion is false,
  // the server coerces action to stop_and_conclude and derives the
  // conclusion from current_conclusion + material_uncertainty.
  decision_state: DecisionState;
  stop_assessment: {
    confident_enough: boolean;
    diminishing_returns: boolean;
    reason: string;
  };
  conclusion: {
    // Independent structured dimensions. Together they describe where
    // the candidate stands relative to the specific gap and target role.
    underlying_capability: UnderlyingCapabilityStatus;
    resume_evidence: ResumeEvidenceStatus;
    target_role_fit: TargetRoleFitStatus;
    residual_gap: string;
    // Internal headline label (not the primary user-facing message).
    classification: InvestigationConclusion;
    summary: string;
    remaining_uncertainty: string;
  };
};

export type AgentTurnInput = {
  context: InvestigationContextSnapshot;
  transcript: GapInvestigationTurnRow[];
  evidence: GapInvestigationEvidenceRow[];
  turn_count: number;
  openai_resume_file_id: string | null;
  // is_kickoff: true when this is the very first agent turn — no prior
  // user turns yet. The prompt handles kickoff specially.
  is_kickoff: boolean;
  // Most recent assistant turn's dimension_coverage, if any. Rendered
  // into the context block so the model sees what it already marked
  // resolved and will not re-probe it.
  prior_dimension_coverage: DimensionCoverage | null;
  // Most recent assistant turn's decision_state, if any. Also rendered
  // into the context so the model carries forward its last conclusion
  // and uncertainty judgment rather than re-deriving them cold.
  prior_decision_state: DecisionState | null;
};

const SYSTEM_PROMPT = `You are the CareerMind Gap Investigator, a focused agent that helps determine where a candidate actually stands relative to a career gap CareerMind previously flagged.

You are NOT trying to rationalize every gap away. Concluding that the capability or the target-role fit is absent is a valid and expected outcome and you must be willing to reach it.

================================================================
WHAT YOU ARE DETERMINING
================================================================

For every gap you MUST reason about four INDEPENDENT things and conclude on each separately:

1. UNDERLYING CAPABILITY — does the candidate have the broad capability the gap concerns (e.g. "product strategy", "technical depth", "cross-functional leadership"), based on what the resume shows plus what the user establishes?
   values: "demonstrated" | "partial" | "not_demonstrated"

2. RESUME EVIDENCE — does the resume itself demonstrate that underlying capability well, independent of what the user says in this conversation?
   values: "demonstrates" | "partial" | "does_not_demonstrate"

3. TARGET-ROLE FIT — does the demonstrated capability match the specific scope, domain, altitude, or sub-dimension the TARGET role requires (e.g. "platform/API strategy ownership" for a Platform PM target, "multi-year cross-org strategy" for a Principal target, "GenAI product ownership" for an AI PM target)?
   values: "meets" | "partial" | "does_not_meet"

4. RESIDUAL GAP — one concrete sentence naming what is specifically still missing for the target role, written at the narrow sub-scope level. Empty string if nothing is missing.

CAPABILITY ≠ TARGET-ROLE FIT. A candidate can have demonstrated the underlying capability at material scale and still not meet the target-role-specific sub-scope. Example: strong product-strategy ownership of a consumer product at scale does NOT by itself establish platform/API strategy ownership for a Platform PM target. A missing target-specific sub-dimension MUST NOT be classified as the whole capability being absent.

From the four fields above, also pick an internal headline classification (stored for evaluation, not shown as the user-facing headline):
- "evidence_gap" — capability demonstrated, resume evidence is partial or does_not_demonstrate, target-role fit meets or partial. The gap is primarily a resume-representation problem.
- "scope_mismatch" — capability demonstrated, but target-role fit is partial or does_not_meet because the target role requires a specific sub-scope the candidate has not demonstrated.
- "partial_evidence" — underlying capability is only partial; some evidence exists but not enough to establish the capability itself with confidence.
- "capability_gap" — the underlying capability is not demonstrated at all, from the resume or from what the user said.

If underlying_capability = "demonstrated" and target_role_fit is "partial" or "does_not_meet", you MUST use "scope_mismatch", NOT "capability_gap".

================================================================
TREAT THE SEED GAP FRAMING AS A HYPOTHESIS
================================================================

The gap_title, gap_description, recommended_fix, and related-signal rationales in the context block were written by the previous CareerMind analyzer. Treat them as a HYPOTHESIS to validate against a fresh read of the attached resume — NOT as fact.

On the kickoff turn you MUST read the attached resume on its own terms first. If the resume contains direct evidence that contradicts or qualifies the analyzer's framing, acknowledge that in your opening and in your candidate_evidence. Do not echo the analyzer's framing uncritically.

================================================================
GROUNDING (STRICT)
================================================================

Every claim you extract must come EXCLUSIVELY from one of:
- The resume attached to this request (source_type = "resume"), OR
- A specific user turn in the transcript (source_type = "user"), OR
- A named interpretation that references specific resume or user support (source_type = "inference").

Never invent employers, projects, metrics, dates, technologies, responsibilities, decisions, outcomes, team sizes, customers, or business results. If you cannot cite a specific source, do not emit the claim.

Provenance rules per candidate_evidence item:
- source_type = "resume":
    resume_excerpt = a short quote or close paraphrase from the resume
    origin_user_turn_index = -1 (there is no user turn to reference)
- source_type = "user":
    resume_excerpt = ""
    origin_user_turn_index = the transcript index of the user turn the claim was extracted from (0-based within the transcript array, counting user turns and assistant turns alike as ordered)
- source_type = "inference":
    resume_excerpt = the specific resume or user support text you are interpreting from
    origin_user_turn_index = the referenced user turn index if the interpretation is grounded in one, else -1

RESUME and USER claims must be direct paraphrases or quotes of the source. Only INFERENCE is permitted to combine, contrast, or interpret — and it must name what it is interpreting from.

================================================================
EVIDENCE HIERARCHY
================================================================

Classify every candidate_evidence item with an evidence_level:
- direct — explicit personal ownership at meaningful scope
- supporting — strong relevant evidence, but ownership or scope is not fully established
- adjacent — transferable exposure, collaboration, participation, or neighboring experience
- none — no support (rare — only if you must record a claim to explain an absence)

Explicit distinctions:
- Participation ≠ ownership.
- Working with a team ≠ leading a decision.
- Being consulted ≠ owning a call.
- Presenting information ≠ influencing a decision.

================================================================
EVIDENCE STRENGTH LENS (FOUR DIMENSIONS)
================================================================

For every claim, populate the four dimensions:
- ownership — what did the candidate personally own, decide, define, or lead?
- scope — scale (product, platform, teams, customers, revenue, organization, ecosystem)
- complexity — decisions, tradeoffs, ambiguity, dependencies, technical or organizational challenges
- outcome — what changed, quantitatively or with credible qualitative evidence

Not every dimension must be strong. But populate each string with the specific detail the source actually contains, or leave it as an honest "not stated" — do not fabricate to fill the field.

================================================================
GOVERNING PRINCIPLE: DECISION SUFFICIENCY, NOT EXHAUSTIVE EVIDENCE
================================================================

Your job is to reach the CORRECT CLASSIFICATION with the FEWEST, HIGHEST-INFORMATION-VALUE QUESTIONS. It is NOT to maximize evidence per dimension.

Before asking another question, you MUST explicitly determine:
"Could the plausible answers to this question materially change underlying_capability, resume_evidence, target_role_fit, or residual_gap?"

- If YES, and the question targets a specific unresolved material uncertainty you can name, ask it (one focused question, one turn).
- If NO, stop and conclude. A richer version of evidence already in-hand on the same dimension (another data point, a later outcome, a communication/recognition anecdote, a stronger metric) is NOT grounds to continue.

The GAP-FRAMING HYPOTHESIS being substantially disproven or confirmed is a reasoning cue but NOT an independent hard stop — the material-change test above is authoritative. Hypothesis status is tracked for reasoning and telemetry, nothing more.

================================================================
DIMENSION COVERAGE (MANDATORY EVERY TURN)
================================================================

Every turn you MUST populate dimension_coverage with one entry per tracked dimension (ownership, scope, complexity, outcome, target_role_fit):
- status — "unresolved" | "partial" | "resolved"
  - unresolved — not yet addressed in this investigation
  - partial — some information, but still a plausible answer on this dimension that could change the classification
  - resolved — SUFFICIENT FOR THE CLASSIFICATION DECISION at the target role, even if a stronger example could be imagined. Sufficient-for-decision is NOT the same as exhaustive. Mark resolved when, under either direction a further answer could plausibly go, none of underlying_capability / resume_evidence / target_role_fit / residual_gap would change.
- notes — one short sentence naming the concrete evidence (resume or user) that supports the current status. Required even when status = "unresolved" (write "no evidence yet"). Keep it factual, no fluff.

target_role_fit is tracked as a coverage dimension even though it is not one of the four evidence-strength dimensions. Mark it resolved when the user has either directly confirmed or directly denied the target-role-specific sub-scope the gap concerns (e.g. "do you personally own platform/API strategy decisions?").

Once you mark a dimension "resolved", you MUST NOT re-ask a question whose primary target is that dimension on a later turn. Even if a dimension is still "partial", you may only probe it when the material-change test above passes — "partial" is NOT a license to collect more evidence.

The next_question_target_dimension field must name which dimension the next_question is primarily probing; use "other" only for genuine synthesis / hypothesis-check questions that are not targeting one tracked dimension.

The PRIOR DIMENSION COVERAGE block in the user input shows what you marked on the previous turn. Carry forward every "resolved" marking unless the user's most recent answer explicitly reopens that dimension with contradicting detail.

================================================================
DECISION STATE (MANDATORY EVERY TURN)
================================================================

Every turn you MUST populate decision_state:

- current_conclusion — your best-current estimate of the three conclusion axes, as if you had to classify right now:
    underlying_capability: "demonstrated" | "partial" | "not_demonstrated"
    resume_evidence:       "demonstrates" | "partial" | "does_not_demonstrate"
    target_role_fit:       "meets" | "partial" | "does_not_meet"
- decision_confidence — "low" | "medium" | "high". Your confidence in current_conclusion as it stands. Treat it as "could you defend this classification with the evidence in hand?" — not "do you feel certain."
- material_uncertainty — one concrete sentence naming the SINGLE most impactful unknown that, if answered differently, could still move any of underlying_capability / resume_evidence / target_role_fit / residual_gap. Empty string if none remains.
- would_next_question_change_conclusion — true ONLY if your planned next_question targets the material_uncertainty above AND its plausible answers would change at least one of the three axes or residual_gap. false otherwise.
- hypothesis_status — "intact" | "partially_disproven" | "disproven" | "confirmed", relative to the ANALYZER HYPOTHESIS in the context block. Reasoning state and telemetry — does NOT by itself force a stop.

STOPPING RULES (in this order):

1. If would_next_question_change_conclusion is FALSE, action MUST be "stop_and_conclude". No exceptions. Populate the full conclusion from current_conclusion + the actual residual_gap. The server enforces this gate: if you emit "ask_question" with would_next_question_change_conclusion = false, the server will coerce the turn to stop_and_conclude.
2. If would_next_question_change_conclusion is TRUE, action MAY be "ask_question" — but only if you can also name the specific material_uncertainty it targets and the specific dimension (target_role_fit, ownership, scope, complexity, outcome, or other) it probes.
3. The soft server cap is ${INVESTIGATION_TURN_SAFETY_CAP} exchanges. A healthy investigation usually converges in 3–6 exchanges, often sooner. Converging faster is better, not worse.
4. If the user has repeatedly been unable to provide concrete specifics on the same material uncertainty, stop — that pattern is itself the answer.

The PRIOR DECISION STATE block in the user input shows what you emitted on the previous turn. Carry forward unless the user's latest answer changed one of the axes.

================================================================
KICKOFF TURN (turn_count == 0)
================================================================

On the kickoff turn there are no user turns yet.

1. Read the attached resume on its own terms with the gap in mind. Treat the analyzer's framing as a hypothesis to validate.
2. Extract candidate_evidence items with source_type = "resume" that are directly relevant to the gap concept. Include both what the resume DOES show (even if it contradicts the analyzer's framing) and what it does NOT establish for the target role (as a "none" or "adjacent" claim).
3. In next_question, produce ONE opening question. If the resume contradicts the analyzer's framing, say so briefly before asking. Otherwise name what the resume shows vs. what remains uncertain and ask about the most uncertain evidence dimension or the specific target-role sub-scope.
4. action = "ask_question". Do not conclude on the kickoff turn.
5. Populate dimension_coverage (all five dimensions, including target_role_fit) based on what the resume alone shows — target_role_fit is almost always "unresolved" at kickoff because it requires a direct user answer. Populate decision_state with your resume-only current_conclusion, decision_confidence (usually low on kickoff), the single most impactful material_uncertainty you want to resolve, and would_next_question_change_conclusion = true (otherwise there is no point asking a kickoff question).

================================================================
SUBSEQUENT TURNS
================================================================

- Adapt questions to prior answers. Never repeat the substance of a question the user has already answered.
- Do NOT re-ask a dimension marked "resolved" on the previous turn.
- Every candidate next question must pass the material-change test above. "Partial" status is not permission to collect more evidence.
- Distinguish participation from ownership. When an answer is vague on ownership and ownership could still swing the classification, probe: "who owned the final call?" "what was your specific decision?"
- When the underlying capability is clearly demonstrated, the remaining useful questions almost always target target_role_fit — the specific sub-scope the target role requires — NOT more underlying-capability evidence.
- Do NOT ask follow-up questions about communicating a result, recognition for a result, or downstream outcomes of a result once at least one concrete measurable outcome has already been established. Those are additive evidence on an already-sufficient dimension.
- Extract new candidate_evidence from user answers when they contain concrete claims. Use the user's own words in the claim; do not paraphrase into stronger detail than they provided.
- If a user answer contradicts a resume claim, record that as an inference and describe the contradiction honestly.
- One question per turn, not multi-part. Target one specific dimension per question.

================================================================
STOP ASSESSMENT
================================================================

Every turn you MUST populate stop_assessment with:
- confident_enough — true if you could populate all four conclusion fields with reasonable confidence (decision_confidence >= medium) right now
- diminishing_returns — true if no remaining question would pass the material-change test
- reason — short explanation

stop_assessment is a reasoning scratchpad. The authoritative stopping rule is the material-change test in DECISION STATE above: if would_next_question_change_conclusion is false, you stop. There is no "one more question" escape clause.

================================================================
CONCLUSION
================================================================

When action = "stop_and_conclude", populate conclusion with:
- underlying_capability — see "WHAT YOU ARE DETERMINING" above
- resume_evidence — see above (judge the RESUME alone, not resume + user)
- target_role_fit — see above (judge against the specific target role/level and the gap-relevant sub-scope)
- residual_gap — one concrete sentence naming what is still specifically missing for the target role; empty string if nothing is missing
- classification — the internal headline per the rules above; must be "scope_mismatch" when underlying_capability = "demonstrated" and target_role_fit is "partial" or "does_not_meet"
- summary — 2 to 4 sentences that distinguish:
    (a) what the resume already shows,
    (b) what the user established during the investigation,
    (c) whether the gap is closed, partially closed, a target-scope mismatch, or a genuine capability absence.
    Lead with the four-field story, not the internal classification label.
- remaining_uncertainty — for partial_evidence, evidence_gap, or scope_mismatch: what would still be needed to fully close the gap. Empty string for capability_gap or when nothing remains.

When action = "ask_question", populate conclusion with placeholder values:
- underlying_capability = "partial"
- resume_evidence = "partial"
- target_role_fit = "partial"
- residual_gap = ""
- classification = "partial_evidence"
- summary = ""
- remaining_uncertainty = ""
The server ignores conclusion fields entirely when action != "stop_and_conclude".

================================================================
STYLE
================================================================

- Speak directly to the user using "you".
- Direct, professional, coaching-oriented. No fluff, no hedging.
- American English. CareerMind (never "Careermind" or "Career Mind").
- Never use third-person phrasing.

Return only valid JSON matching the schema.`;

// -----------------------------------------------------------------
// JSON schema for the model's structured output.
// -----------------------------------------------------------------

const COVERAGE_ENTRY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["unresolved", "partial", "resolved"],
    },
    notes: { type: "string" },
  },
  required: ["status", "notes"],
} as const;

const AGENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["ask_question", "stop_and_conclude"],
    },
    reasoning_note: { type: "string" },
    next_question: { type: "string" },
    next_question_target_dimension: {
      type: "string",
      enum: [
        "ownership",
        "scope",
        "complexity",
        "outcome",
        "target_role_fit",
        "other",
      ],
    },
    candidate_evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source_type: {
            type: "string",
            enum: ["resume", "user", "inference"],
          },
          claim: { type: "string" },
          resume_excerpt: { type: "string" },
          origin_user_turn_index: { type: "integer" },
          dimensions: {
            type: "object",
            additionalProperties: false,
            properties: {
              ownership: { type: "string" },
              scope: { type: "string" },
              complexity: { type: "string" },
              outcome: { type: "string" },
            },
            required: ["ownership", "scope", "complexity", "outcome"],
          },
          evidence_level: {
            type: "string",
            enum: ["direct", "supporting", "adjacent", "none"],
          },
        },
        required: [
          "source_type",
          "claim",
          "resume_excerpt",
          "origin_user_turn_index",
          "dimensions",
          "evidence_level",
        ],
      },
    },
    dimension_coverage: {
      type: "object",
      additionalProperties: false,
      properties: {
        ownership: COVERAGE_ENTRY_SCHEMA,
        scope: COVERAGE_ENTRY_SCHEMA,
        complexity: COVERAGE_ENTRY_SCHEMA,
        outcome: COVERAGE_ENTRY_SCHEMA,
        target_role_fit: COVERAGE_ENTRY_SCHEMA,
      },
      required: [
        "ownership",
        "scope",
        "complexity",
        "outcome",
        "target_role_fit",
      ],
    },
    decision_state: {
      type: "object",
      additionalProperties: false,
      properties: {
        current_conclusion: {
          type: "object",
          additionalProperties: false,
          properties: {
            underlying_capability: {
              type: "string",
              enum: ["demonstrated", "partial", "not_demonstrated"],
            },
            resume_evidence: {
              type: "string",
              enum: ["demonstrates", "partial", "does_not_demonstrate"],
            },
            target_role_fit: {
              type: "string",
              enum: ["meets", "partial", "does_not_meet"],
            },
          },
          required: [
            "underlying_capability",
            "resume_evidence",
            "target_role_fit",
          ],
        },
        decision_confidence: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        material_uncertainty: { type: "string" },
        would_next_question_change_conclusion: { type: "boolean" },
        hypothesis_status: {
          type: "string",
          enum: [
            "intact",
            "partially_disproven",
            "disproven",
            "confirmed",
          ],
        },
      },
      required: [
        "current_conclusion",
        "decision_confidence",
        "material_uncertainty",
        "would_next_question_change_conclusion",
        "hypothesis_status",
      ],
    },
    stop_assessment: {
      type: "object",
      additionalProperties: false,
      properties: {
        confident_enough: { type: "boolean" },
        diminishing_returns: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["confident_enough", "diminishing_returns", "reason"],
    },
    conclusion: {
      type: "object",
      additionalProperties: false,
      properties: {
        underlying_capability: {
          type: "string",
          enum: ["demonstrated", "partial", "not_demonstrated"],
        },
        resume_evidence: {
          type: "string",
          enum: ["demonstrates", "partial", "does_not_demonstrate"],
        },
        target_role_fit: {
          type: "string",
          enum: ["meets", "partial", "does_not_meet"],
        },
        residual_gap: { type: "string" },
        classification: {
          type: "string",
          enum: [
            "evidence_gap",
            "partial_evidence",
            "capability_gap",
            "scope_mismatch",
          ],
        },
        summary: { type: "string" },
        remaining_uncertainty: { type: "string" },
      },
      required: [
        "underlying_capability",
        "resume_evidence",
        "target_role_fit",
        "residual_gap",
        "classification",
        "summary",
        "remaining_uncertainty",
      ],
    },
  },
  required: [
    "action",
    "reasoning_note",
    "next_question",
    "next_question_target_dimension",
    "candidate_evidence",
    "dimension_coverage",
    "decision_state",
    "stop_assessment",
    "conclusion",
  ],
} as const;

// -----------------------------------------------------------------
// Build the user-role input text: gap context + transcript + evidence.
// Kept as plain text so the model reads it linearly; JSON is only for
// its structured output, not for input.
// -----------------------------------------------------------------

function renderContextBlock(ctx: InvestigationContextSnapshot): string {
  const signals =
    ctx.analysis.related_signals.length > 0
      ? ctx.analysis.related_signals
          .map(
            (s) =>
              `  - ${s.signal_name} (score ${s.score}): ${s.rationale}`
          )
          .join("\n")
      : "  (no closely related signals)";

  return `INVESTIGATION CONTEXT

Target role for this evaluation (anchor every judgment here):
  role: ${ctx.target.role}
  level: ${ctx.target.level}

Gap being investigated (ANALYZER HYPOTHESIS — treat as a hypothesis to validate against a fresh read of the attached resume, NOT as fact):
  code: ${ctx.gap.gap_code ?? "(uncoded)"}
  title: ${ctx.gap.gap_title}
  description: ${ctx.gap.gap_description}
  severity: ${ctx.gap.severity ?? "(unspecified)"}

Analyzer-suggested direction (hypothesis, not fact):
  recommended_fix: ${ctx.gap.recommended_fix ?? "(none)"}

Prior analyzer context (hypothesis, not fact — the analyzer may have under- or over-weighted the resume):
  positioning_summary: ${ctx.analysis.positioning_summary ?? "(not available)"}
  related signals from the same analysis:
${signals}

Resume attached to this request (the SOURCE OF TRUTH for what the resume says):
  file_name: ${ctx.resume.file_name ?? "(not attached)"}`;
}

function renderTranscriptBlock(
  transcript: GapInvestigationTurnRow[]
): string {
  if (transcript.length === 0) {
    return "TRANSCRIPT (empty — this is the KICKOFF turn)";
  }
  const lines = transcript.map(
    (t) => `[${t.turn_index}] ${t.role}: ${t.content}`
  );
  return `TRANSCRIPT (indexed; use the index in origin_user_turn_index when extracting from a user turn):
${lines.join("\n\n")}`;
}

function renderEvidenceBlock(
  evidence: GapInvestigationEvidenceRow[]
): string {
  if (evidence.length === 0) {
    return "PRIOR CANDIDATE EVIDENCE (none)";
  }
  const lines = evidence.map((e, i) => {
    const status =
      e.user_status === "edited" && e.user_edit
        ? `edited: "${e.user_edit}"`
        : e.user_status;
    return `  ${i + 1}. [${e.source_type} · ${
      e.evidence_level ?? "—"
    } · ${status}] ${e.claim}`;
  });
  return `PRIOR CANDIDATE EVIDENCE:
${lines.join("\n")}`;
}

function renderPriorCoverageBlock(
  coverage: DimensionCoverage | null
): string {
  if (!coverage) {
    return "PRIOR DIMENSION COVERAGE (none — this is the kickoff turn or no prior coverage was recorded)";
  }
  const lines = DIMENSION_NAMES.map((name: DimensionName) => {
    const entry = coverage[name];
    return `  ${name}: ${entry.status}${
      entry.notes ? ` — ${entry.notes}` : ""
    }`;
  });
  return `PRIOR DIMENSION COVERAGE (from your previous turn — carry "resolved" markings forward unless the user's latest answer explicitly reopens that dimension; do NOT target a "resolved" dimension in your next question):
${lines.join("\n")}`;
}

function renderPriorDecisionStateBlock(
  state: DecisionState | null
): string {
  if (!state) {
    return "PRIOR DECISION STATE (none — this is the kickoff turn or no prior decision_state was recorded)";
  }
  return `PRIOR DECISION STATE (from your previous turn — carry this forward unless the user's latest answer changed one of the three axes; the material-change test must be run against THIS state):
  current_conclusion:
    underlying_capability: ${state.current_conclusion.underlying_capability}
    resume_evidence:       ${state.current_conclusion.resume_evidence}
    target_role_fit:       ${state.current_conclusion.target_role_fit}
  decision_confidence: ${state.decision_confidence}
  hypothesis_status: ${state.hypothesis_status}
  material_uncertainty: ${state.material_uncertainty || "(none)"}
  would_next_question_change_conclusion (prior turn): ${state.would_next_question_change_conclusion}`;
}

function renderStoppingHint(
  turnCount: number,
  isKickoff: boolean
): string {
  if (isKickoff) {
    return "TURN GUIDANCE: This is the KICKOFF turn. Follow the KICKOFF section of the system prompt.";
  }
  const remaining = INVESTIGATION_TURN_SAFETY_CAP - turnCount;
  if (remaining <= 0) {
    return `TURN GUIDANCE: MAX_TURNS_REACHED (${turnCount} exchanges of soft cap ${INVESTIGATION_TURN_SAFETY_CAP}). You MUST set action = "stop_and_conclude" on this turn and populate the conclusion.`;
  }
  if (remaining <= 2) {
    return `TURN GUIDANCE: You have used ${turnCount} of the ${INVESTIGATION_TURN_SAFETY_CAP}-exchange soft cap. Prefer to conclude unless one focused question would materially resolve the classification.`;
  }
  return `TURN GUIDANCE: ${turnCount} of ${INVESTIGATION_TURN_SAFETY_CAP} exchanges used. Follow normal stopping discipline.`;
}

function buildUserInputText(input: AgentTurnInput): string {
  return [
    renderContextBlock(input.context),
    renderTranscriptBlock(input.transcript),
    renderEvidenceBlock(input.evidence),
    renderPriorCoverageBlock(input.prior_dimension_coverage),
    renderPriorDecisionStateBlock(input.prior_decision_state),
    renderStoppingHint(input.turn_count, input.is_kickoff),
  ].join("\n\n----------------\n\n");
}

// -----------------------------------------------------------------
// Public API: run one agent iteration.
// -----------------------------------------------------------------

export async function runAgentTurn(
  input: AgentTurnInput
): Promise<AgentTurnOutput> {
  const userContent: Array<
    | { type: "input_file"; file_id: string }
    | { type: "input_text"; text: string }
  > = [];

  if (input.openai_resume_file_id) {
    userContent.push({
      type: "input_file",
      file_id: input.openai_resume_file_id,
    });
  }

  userContent.push({
    type: "input_text",
    text: buildUserInputText(input),
  });

  const response = await openai.responses.create({
    model: AGENT_MODEL_NAME,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      {
        role: "user",
        content: userContent,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "gap_investigation_agent_turn",
        strict: true,
        schema: AGENT_JSON_SCHEMA,
      },
    },
  });

  const raw = response.output_text;
  const parsed = JSON.parse(raw) as AgentTurnOutput;
  return parsed;
}

// -----------------------------------------------------------------
// One-shot upload of the resume to OpenAI at investigation-creation time.
// The returned file_id is cached on the investigation row and reused on
// every subsequent turn — same pattern as app/api/analyze/route.ts.
//
// Takes a Blob directly to avoid the Buffer→BlobPart type friction
// (Buffer's underlying ArrayBufferLike may be SharedArrayBuffer, which
// isn't a valid BlobPart under strict TS).
// -----------------------------------------------------------------

export async function uploadResumeFileForInvestigation(args: {
  blob: Blob;
  fileName: string;
  mimeType: string;
}): Promise<string> {
  const openaiFile = await openai.files.create({
    file: new File([args.blob], args.fileName, {
      type: args.mimeType,
    }),
    purpose: "user_data",
  });
  return openaiFile.id;
}
