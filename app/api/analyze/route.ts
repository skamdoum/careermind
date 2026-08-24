import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { createClient } from "@/lib/supabase/server";
import {
  GAP_CODES,
  SIGNAL_CODES,
  gapCodeRubric,
  signalCodeRubric,
} from "@/lib/db/taxonomy";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    // Resolve the active career profile once, up front, and keep it for the
    // entire request. Never re-read mid-flight so a profile switch made during
    // the analysis does not split ownership across two profiles.
    const activeProfile = await resolveActiveCareerProfile(supabase, user.id);
    const activeProfileId = activeProfile.id;

    const body = await req.json();
    const {
      resumeText,
      jobDescription,
      targetRole,
      targetLevel,
      latestResume,
      career_goal_id,
      job_description_id,
    } = body;

    if (
      (career_goal_id && !job_description_id) ||
      (!career_goal_id && job_description_id)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "career_goal_id and job_description_id must be provided together",
        },
        { status: 400 }
      );
    }

    let effectiveJobDescription: string | undefined = jobDescription;
    let effectiveTargetRole: string | undefined = targetRole;
    let effectiveTargetLevel: string | undefined = targetLevel;

    if (career_goal_id && job_description_id) {
      const { data: goal, error: goalError } = await supabase
        .from("career_goals")
        .select("id, target_level, target_function")
        .eq("id", career_goal_id)
        .eq("user_id", user.id)
        .eq("career_profile_id", activeProfileId)
        .maybeSingle();

      if (goalError) {
        return NextResponse.json(
          { success: false, error: goalError.message },
          { status: 500 }
        );
      }

      if (!goal) {
        return NextResponse.json(
          { success: false, error: "Career goal not found" },
          { status: 404 }
        );
      }

      const { data: job, error: jobError } = await supabase
        .from("job_descriptions")
        .select("id, jd_text, career_goal_id, role_title")
        .eq("id", job_description_id)
        .eq("user_id", user.id)
        .eq("career_profile_id", activeProfileId)
        .maybeSingle();

      if (jobError) {
        return NextResponse.json(
          { success: false, error: jobError.message },
          { status: 500 }
        );
      }

      if (!job || job.career_goal_id !== career_goal_id) {
        return NextResponse.json(
          { success: false, error: "Target job not found" },
          { status: 404 }
        );
      }

      effectiveJobDescription = job.jd_text;
      effectiveTargetRole =
        job.role_title || goal.target_function || targetRole || "PM";
      effectiveTargetLevel = goal.target_level || targetLevel || "Senior";
    }

    if (!effectiveJobDescription) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const { count } = await supabase
      .from("analyses")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    const FREE_ANALYSIS_LIMIT = 50;
    if ((count || 0) >= FREE_ANALYSIS_LIMIT) {
      return NextResponse.json(
        {
          success: false,
          error: "Free limit reached",
          data: { code: "LIMIT_REACHED" },
        },
        { status: 403 }
      );
    }

    if (!resumeText && !latestResume?.file_path) {
      return NextResponse.json(
        { success: false, error: "Provide resume text or upload a resume first" },
        { status: 400 }
      );
    }

      const resumeContentParts: any[] = [];

      if (latestResume?.file_path) {
        const { data: fileData, error: downloadError } = await supabaseAdmin.storage
          .from("resumes")
          .download(latestResume.file_path);

        if (downloadError) {
          throw downloadError;
        }

        const bytes = Buffer.from(await fileData.arrayBuffer());

        const openaiFile = await openai.files.create({
          file: new File([bytes], latestResume.file_name || "resume.pdf", {
            type: latestResume.mime_type || "application/octet-stream",
          }),
          purpose: "user_data",
        });

        resumeContentParts.push({
          type: "input_file",
          file_id: openaiFile.id,
        });
      }

      // Isolate the resume source: only fall back to pasted text when no
      // resume file was loaded. Never send both — stale pasted text alongside
      // a fresh uploaded file could contaminate evidence grounding.
      if (resumeContentParts.length === 0 && resumeText) {
        resumeContentParts.push({
          type: "input_text",
          text: `RESUME TEXT:\n${resumeText}`,
        });
      }
    const response = await openai.responses.create({
      model: "gpt-4.1",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: `You are CareerMind, an expert Product Manager hiring evaluator for experienced PMs targeting competitive roles.

Your job is to make a calibrated hiring judgment grounded in explicit resume evidence for THIS specific target role. Do NOT make assumptions beyond what the resume actually demonstrates.

================================================================
GROUNDING (STRICT)
================================================================

All evidence must come EXCLUSIVELY from the resume supplied in THIS request.

Never invent or infer specific:
- employers, projects, products, metrics, dates, technologies, responsibilities, customers, team sizes, outcomes, degrees, or certifications.

If a fact is not supported by the resume, do not state it as evidence.
Do not fill missing information with plausible PM experience.
Do not use information from previous analyses, generic candidate patterns, or assumptions about a title.
Evidence bullets must be concise paraphrases of actual resume text — never paraphrase into inferred detail.

================================================================
EVIDENCE HIERARCHY
================================================================

Classify every claim against the resume using one of:

DIRECT — Explicit evidence that the candidate personally owned/drove the relevant capability at meaningful scope.
SUPPORTING — Strong relevant evidence, but ownership, depth, or scope is not fully established.
ADJACENT — Transferable exposure, collaboration, participation, or neighboring experience.
NONE — No resume evidence supporting the requirement.

Only DIRECT or sufficiently strong SUPPORTING evidence should normally establish a critical requirement as MET.
ADJACENT evidence must NEVER be described as demonstrated ownership.

Explicit distinctions you must respect:
- Product Marketing ≠ Product Management
- Project Management ≠ Product Management
- Partnering with PMs ≠ owning product strategy
- Supporting a launch ≠ owning a product launch
- Supporting a roadmap ≠ owning a roadmap
- Customer research for messaging/GTM ≠ product discovery ownership
- Working with engineering ≠ leading product execution
- Working around APIs ≠ owning an API product
- SaaS experience ≠ platform experience
- Presenting information to executives ≠ influencing executive decisions

Evaluate what the resume actually demonstrates, not what the candidate may plausibly have done.

================================================================
ABSENCE OF EVIDENCE ≠ ABSENCE OF CAPABILITY
================================================================

You are analyzing a resume, not the candidate's entire career.

"No evidence of X in the resume" does NOT automatically mean "the candidate cannot do X."
When information is missing, describe it as an EVIDENCE GAP — not as an established capability gap — unless the resume affirmatively demonstrates experience below or contrary to the required capability.
Do not make unsupported claims about what the candidate has never done.

================================================================
COUNTER-EVIDENCE CHECK (RUN BEFORE EMITTING ANY GAP)
================================================================

Before generating any gap:
1. Search the resume for evidence that would contradict the proposed gap.
2. If DIRECT evidence satisfies the underlying requirement, DO NOT emit that gap.
3. Do not create weaker variants of already-satisfied requirements merely to populate the gaps array.

Examples:
- If the resume explicitly states ownership of multi-year platform strategy, do not create a "platform strategy insufficient" gap.
- If the resume explicitly shows executive investment influence, do not create an executive-influence gap.

Zero gaps is valid. The gaps array may be [].
Only emit a gap when it is material to the hiring decision for THIS specific role.

================================================================
ALTITUDE CALIBRATION (SENIOR vs. PRINCIPAL)
================================================================

Evaluate target level separately from execution quality.

Typical SENIOR PM evidence:
- owns a meaningful product/problem area
- roadmap and prioritization ownership
- customer discovery
- measurable outcomes
- cross-functional leadership
- delivery across multiple teams
- relevant product/technical judgment

PRINCIPAL-level evidence generally requires additional scope such as:
- setting multi-year strategic direction
- platform / product-line / portfolio scope
- cross-organizational influence
- major investment or strategic tradeoff decisions
- executive influence
- organizational leverage
- strategy adopted across multiple teams
- ecosystem / platform effects
- mentorship or influence over other PMs
- solving ambiguous problems that span organizations

Excellent Senior-level execution does NOT automatically establish Principal-level altitude.
Do not require every Principal characteristic if the resume clearly demonstrates equivalent strategic scope through other evidence.
Titles alone do not establish altitude.

================================================================
OUTPUT REQUIREMENTS
================================================================

Return valid JSON matching the schema. positioning_summary, role_requirements, signals, gaps, and core_verdict MUST be internally consistent — never contradict each other.

1. POSITIONING SUMMARY
- 3–5 sentences describing where the candidate stands FOR THIS SPECIFIC ROLE.
- Ground it in what the resume actually shows.
- Must be consistent with the verdict, role_requirements, and gaps.

2. ROLE REQUIREMENTS (3–6 items, derived from THIS job description)
Each item:
- requirement: a specific capability, experience, or qualification called for by this JD.
- importance: "gating" | "high" | "medium".
- evidence_level: "direct" | "supporting" | "adjacent" | "none" (per the evidence hierarchy above).
- evidence: bullet list of resume-grounded evidence (empty [] when evidence_level is "none").
- assessment: "met" | "partial" | "not_met".

Rules:
- A GATING requirement is one whose absence would materially prevent the candidate from being credible for this role — e.g., required professional function, minimum relevant experience, explicitly required domain expertise, mandatory technical expertise, required leadership/scope.
- Do NOT treat every JD bullet as gating — typically 1–3 items are truly gating.
- assessment = "met" requires DIRECT or strong SUPPORTING evidence.
- ADJACENT evidence → assessment = "partial" (at most).
- NONE evidence → assessment = "not_met".

3. CORE VERDICT — one of "Strong Hire" | "Borderline" | "Below Bar"

STRONG HIRE:
The resume clearly satisfies the fundamental requirements of this specific role and demonstrates strong evidence at the expected level across most high-priority dimensions. Minor weaknesses, presentation improvements, or a few 4/5 signals do not prevent Strong Hire. Strong Hire does not require perfection or zero gaps.

BORDERLINE:
The resume satisfies most fundamental requirements but contains one or more material uncertainties, partial matches, evidence gaps, or level/scope mismatches that could realistically determine whether the candidate receives an interview.

BELOW BAR:
The resume fails one or more fundamental/gating requirements, OR contains multiple material gaps that make an interview unlikely for this specific role.

Verdict rules:
- Do NOT average generic strengths against missing gating requirements. A candidate may have excellent transferable skills and several strong signals while still being Below Bar if a fundamental requirement is absent.
- Do NOT downgrade a clearly qualified candidate merely because every dimension is not perfect.
- The verdict MUST be consistent with the role_requirements assessments (especially gating ones) and the signals/gaps you emit.

4. TOP SIGNALS (max 6)
Each item:
- signal_code (choose EXACTLY one canonical code from the SIGNAL CODES list below)
- name (short human-readable label; may add nuance beyond the code)
- score (1–5)
- reasoning (specific, grounded in resume evidence for THIS role)
- evidence (bullet list of resume-grounded evidence)
- risk_level ("low" | "medium" | "high")
- importance ("High" | "Medium" | "Low")

Signals must describe strengths relevant to the TARGET ROLE. Do not turn general professional competence into target-role strength.

Score scale:
- 5 = direct, repeated, highly relevant evidence at or above target scope
- 4 = strong direct evidence at target scope
- 3 = meaningful but partial, adjacent, or somewhat below target scope
- 2 = weak / limited relevant evidence
- 1 = essentially no meaningful evidence

Do not give a 4 or 5 based primarily on adjacent experience.

SIGNAL CODES — pick the closest fit; do not invent new codes:
${signalCodeRubric()}

5. CRITICAL GAPS (max 4, zero is valid)
Apply the COUNTER-EVIDENCE CHECK above before emitting any gap.

Prioritize gaps in this order:
1. Missing gating requirements.
2. Target-level / altitude mismatch.
3. Missing critical role/domain capabilities.
4. Important evidence gaps.
5. Secondary resume-positioning improvements.

Do NOT allow a secondary presentation issue to outrank a fundamental qualification problem.

Each item:
- gap_code (choose EXACTLY one canonical code from the GAP CODES list below)
- title (short human-readable label; may add nuance beyond the code)
- description
- why_this_matters (tie directly to the hiring decision for THIS role)
- severity ("High" | "Medium" | "Low")

GAP CODES — pick the closest fit; do not invent new codes:
${gapCodeRubric()}

6. PRIORITIZED ACTION PLAN (max 5 tasks)
Each item:
- title
- description
- task_type ("resume" | "story" | "interview_prep" | "application" | "networking" | "strategy")
- priority ("High" | "Medium" | "Low")
- expected_impact (what improves if done)

7. NEXT BEST ACTION
- ONE action only.
- Must be the highest-leverage step.
- Must take <30 minutes to start.

================================================================
STYLE
================================================================
- Speak directly to the candidate using "you".
- Be direct but professional. No fluff. No generic advice.
- Never use third-person phrasing like "the candidate".

Enum echoes:
- risk_level must be exactly one of: low, medium, high
- importance must be exactly one of: High, Medium, Low
- severity must be exactly one of: High, Medium, Low
- task priority must be exactly one of: High, Medium, Low
- role_requirement importance must be exactly one of: gating, high, medium
- role_requirement evidence_level must be exactly one of: direct, supporting, adjacent, none
- role_requirement assessment must be exactly one of: met, partial, not_met

Return only valid JSON.`,
            },
          ],
        },
        {
          role: "user",
          content: [
            ...resumeContentParts,
            {
              type: "input_text",
              text: `
      TARGET ROLE: ${effectiveTargetRole}
      TARGET LEVEL: ${effectiveTargetLevel}

      JOB DESCRIPTION:
      ${effectiveJobDescription}
              `
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "careermind_initial_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              positioning_summary: { type: "string" },
              core_verdict: {
              type: "string",
              enum: ["Strong Hire", "Borderline", "Below Bar"]
               },
              role_requirements: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    requirement: { type: "string" },
                    importance: {
                      type: "string",
                      enum: ["gating", "high", "medium"],
                    },
                    evidence_level: {
                      type: "string",
                      enum: ["direct", "supporting", "adjacent", "none"],
                    },
                    evidence: {
                      type: "array",
                      items: { type: "string" },
                    },
                    assessment: {
                      type: "string",
                      enum: ["met", "partial", "not_met"],
                    },
                  },
                  required: [
                    "requirement",
                    "importance",
                    "evidence_level",
                    "evidence",
                    "assessment",
                  ],
                },
              },
              signals: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    signal_code: {
                      type: "string",
                      enum: [...SIGNAL_CODES],
                    },
                    signal_name: { type: "string" },
                    score: { type: "integer", minimum: 1, maximum: 5 },
                    rationale: { type: "string" },
                    evidence: {
                      type: "array",
                      items: { type: "string" }
                    },
                    risk_level: {
                    type: "string",
                    enum: ["low", "medium", "high"]
                    },
                   importance: {
                      type: "string",
                      enum: ["High", "Medium", "Low"]
                    }
                  },
                  required: [
                    "signal_code",
                    "signal_name",
                    "score",
                    "rationale",
                    "evidence",
                    "risk_level",
                    "importance"
                  ]
                }
              },
              gaps: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    gap_code: {
                      type: "string",
                      enum: [...GAP_CODES],
                    },
                    gap_title: { type: "string" },
                    gap_description: { type: "string" },
                    priority: { type: "integer" },
                    recommended_fix: { type: "string" }
                  },
                  required: [
                    "gap_code",
                    "gap_title",
                    "gap_description",
                    "priority",
                    "recommended_fix"
                  ]
                }
              },
              plan: {
                type: "object",
                additionalProperties: false,
                properties: {
                  next_best_action: { type: "string" },
                  tasks: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        priority: { type: "integer" },
                        task_type: {
                          type: "string",
                          enum: ["resume", "story", "interview_prep", "application", "networking", "strategy"]
                        }
                      },
                      required: ["title", "description", "priority", "task_type"]
                    }
                  }
                },
                required: ["next_best_action", "tasks"]
              }
            },
            required: ["positioning_summary", "core_verdict", "role_requirements", "signals", "gaps", "plan"]
          }
        }
      }
    });

    const content = response.output_text;
    const parsed = JSON.parse(content);

    // TODO(v2.2): Compute core_verdict deterministically from
    // parsed.role_requirements (gating + high-importance assessments) rather
    // than trusting the model's self-reported core_verdict. Per CLAUDE.md,
    // deterministic logic should own verdicts; V2.1 intentionally isolates
    // the prompt/schema/grounding improvements so their calibration effect
    // can be measured independently before that mechanical layer is added.

    const { data: analysisRow, error: analysisError } = await supabaseAdmin
      .from("analyses")
      .insert({
        user_id: user.id,
        analysis_type: "initial_onboarding",
        model_name: "gpt-4.1",
        raw_json: parsed,
        summary: parsed.positioning_summary,
        status: "completed",
        career_profile_id: activeProfileId,
        career_goal_id: career_goal_id ?? null,
        job_description_id: job_description_id ?? null,
        resume_id: latestResume?.id ?? null,
      })
      .select()
      .single();

    if (analysisError) throw analysisError;

    const analysisId = analysisRow.id;

    if (parsed.signals?.length) {
const normalizeRiskLevel = (value: unknown): "low" | "medium" | "high" => {
  const v = String(value || "").trim().toLowerCase();

  if (v === "low") return "low";
  if (v === "medium") return "medium";
  if (v === "high") return "high";

  return "medium";
};

const normalizePriorityLabel = (value: unknown): "High" | "Medium" | "Low" => {
  const v = String(value || "").trim().toLowerCase();

  if (v === "high") return "High";
  if (v === "medium") return "Medium";
  if (v === "low") return "Low";

  return "Medium";
};

const signalCodeSet = new Set<string>(SIGNAL_CODES);
const normalizeSignalCode = (v: unknown): string | null => {
  const raw = String(v || "").trim();
  return signalCodeSet.has(raw) ? raw : null;
};

const signalRows = parsed.signals.map((s: any) => ({
  analysis_id: analysisId,
  user_id: user.id,
  signal_code: normalizeSignalCode(s.signal_code),
  signal_name: s.signal_name,
  score: Math.max(1, Math.min(5, Number(s.score) || 1)),
  rationale: s.rationale,
  evidence: s.evidence,
  risk_level: normalizeRiskLevel(s.risk_level),
}));

 console.log("PARSED RESULT:", parsed);
 
      const { error } = await supabaseAdmin
        .from("signal_assessments")
        .insert(signalRows);

      if (error) throw error;
    }

    if (parsed.gaps?.length) {
      const gapCodeSet = new Set<string>(GAP_CODES);
      const normalizeGapCode = (v: unknown): string | null => {
        const raw = String(v || "").trim();
        return gapCodeSet.has(raw) ? raw : null;
      };

      const gapRows = parsed.gaps.map((g: any) => ({
        analysis_id: analysisId,
        user_id: user.id,
        gap_code: normalizeGapCode(g.gap_code),
        gap_title: g.gap_title,
        gap_description: g.gap_description,
        priority: g.priority,
        recommended_fix: g.recommended_fix
      }));

      const { error } = await supabaseAdmin
        .from("gaps")
        .insert(gapRows);

      if (error) throw error;
    }

    const { data: planRow, error: planError } = await supabaseAdmin
      .from("plans")
      .insert({
        user_id: user.id,
        analysis_id: analysisId,
        plan_type: "initial",
        next_best_action: parsed.plan.next_best_action
      })
      .select()
      .single();

    if (planError) throw planError;

    if (parsed.plan?.tasks?.length) {
      const allowedTaskTypes = new Set([
        "resume",
        "story",
        "interview_prep",
        "application",
        "networking",
        "strategy",
      ]);

      const normalizeTaskType = (value: unknown): string => {
        const v = String(value || "").trim().toLowerCase();

        if (allowedTaskTypes.has(v)) return v;

        // simple fallback mapping
        if (["branding", "positioning", "profile"].includes(v)) return "strategy";
        if (["resume_edit", "resume_review", "cv"].includes(v)) return "resume";
        if (["storytelling", "story_bank"].includes(v)) return "story";
        if (["interview", "prep"].includes(v)) return "interview_prep";
        if (["apply", "job_apply"].includes(v)) return "application";
        if (["outreach", "reachout"].includes(v)) return "networking";

        return "strategy";
      };

      const taskRows = parsed.plan.tasks.map((t: any) => ({
        plan_id: planRow.id,
        user_id: user.id,
        title: t.title,
        description: t.description,
        priority: Math.max(1, Math.min(5, Number(t.priority) || 3)),
        task_type: normalizeTaskType(t.task_type),
        status: "not_started"
      }));

      const { error } = await supabaseAdmin
        .from("plan_tasks")
        .insert(taskRows);

      if (error) throw error;
    }

    return NextResponse.json({
      success: true,
      data: {
        analysisId,
        planId: planRow.id,
        result: parsed,
      },
    });
  } catch (error: any) {
    console.error("Analyze API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Something went wrong"
      },
      { status: 500 }
    );
  }
}