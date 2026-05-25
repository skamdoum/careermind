import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let resumeText = "";
    let jobDescription = "";
    let targetRole = "";
    let targetLevel = "";
    let latestResume: any = null;
    let guestResumeFile: File | null = null;

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();

      resumeText = String(formData.get("resumeText") || "");
      jobDescription = String(formData.get("jobDescription") || "");
      targetRole = String(formData.get("targetRole") || "");
      targetLevel = String(formData.get("targetLevel") || "");
      guestResumeFile = formData.get("resumeFile") as File | null;
    } else {
      const body = await req.json();

      resumeText = body.resumeText || "";
      jobDescription = body.jobDescription || "";
      targetRole = body.targetRole || "";
      targetLevel = body.targetLevel || "";
      latestResume = body.latestResume || null;
    }

    if (!jobDescription) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!resumeText && !latestResume?.file_path && !guestResumeFile) {
      return NextResponse.json(
        { error: "Provide resume text or upload a resume first" },
        { status: 400 }
      );
    }

    if (user) {
      const FREE_ANALYSIS_LIMIT = 50;

      const { count } = await supabase
        .from("analyses")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      if ((count || 0) >= FREE_ANALYSIS_LIMIT) {
        return NextResponse.json(
          {
            error: "Free limit reached",
            code: "LIMIT_REACHED",
          },
          { status: 403 }
        );
      }
    }

    let resumeContentParts: any[] = [];

    // Logged-in file from Supabase Storage
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

    // Guest file direct upload
    if (guestResumeFile) {
      const bytes = Buffer.from(await guestResumeFile.arrayBuffer());

      const openaiFile = await openai.files.create({
        file: new File([bytes], guestResumeFile.name || "resume.pdf", {
          type: guestResumeFile.type || "application/octet-stream",
        }),
        purpose: "user_data",
      });

      resumeContentParts.push({
        type: "input_file",
        file_id: openaiFile.id,
      });
    }

    if (resumeText) {
      resumeContentParts.push({
        type: "input_text",
        text: `RESUME TEXT FALLBACK:\n${resumeText}`,
      });
    }
    const response = await openai.responses.create({
      model: "gpt-5.4",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
           text: `
You are CareerMind, an expert career coach for experienced Product Managers targeting competitive roles.

Your task is to evaluate how well a candidate fits a specific Product Manager role and provide clear, decisive, and actionable guidance to maximize interview and hiring success.

You must:
1. Identify the most important requirements of the job
2. Evaluate the resume strictly against those requirements
3. Make a clear, calibrated hiring judgment
4. Provide actionable improvement guidance

Do not summarize the resume. Focus only on evaluation, gaps, and actions.

---

# Decision Framework

Apply this strict priority order when determining fit:

1. **Direct Evidence of Relevant Product Ownership (HIGHEST PRIORITY)**
   - Named products, launches, or features
   - Clear ownership (e.g., “led”, “owned”, “delivered”)
   - Measurable outcomes (ARR, adoption, NRR, engagement, etc.)
   - If strong, directly relevant evidence exists, it should heavily influence fit

2. **Core Domain Requirements**
   - Must-have experience required to succeed in the role
   - If missing, fit must be downgraded regardless of general strength

3. **Role-Shape Alignment (LOWEST PRIORITY)**
   - Alignment between candidate’s background and role scope (e.g., platform vs workflow, AI vs generalist)
   - Used only to refine decisions—not override strong evidence

---

# Interpretation Rules

## Evidence Recognition
- Identify explicit product names, launches, or owned initiatives
- Treat named products or 0→X outcomes as strong ownership signals
- Do not ignore clearly stated product ownership
- If a product directly matches the role domain, treat it as a primary signal


## Fit Calibration
- Fit must reflect readiness for THIS role—not general seniority
- Do not assign "High" if core domain capability is missing
- Adjacent experience ≠ direct experience
- Transferable skills support—but do not justify—strong fit alone
- When direct experience is missing, assess whether adjacent experience is strong enough to support near-term execution in the role. If yes, this may support "Medium"; if not, prefer "Low".

## Specialization vs Generalization
- Strong specialization (AI, infra, platform, etc.) does NOT imply strong fit for a broader role
- If role is generalist and candidate is specialized, lean toward "Medium"
- HOWEVER: if direct relevant product ownership exists, do NOT penalize for specialization

## Positive Evidence Override
- Strong, explicit, relevant product ownership overrides inferred gaps
- Measurable outcomes (ARR, adoption, NRR) carry high weight
- Do not downgrade a candidate if clear evidence proves capability

## Final Calibration Rule
When signals conflict:
- Direct evidence > domain assumptions > role-shape adjustments

# Gap Specificity Rules

- Identify gaps at the level of concrete responsibilities, not broad categories.
- Break down missing experience into the specific practices, metrics, or systems required by the role.

- For infrastructure or reliability roles, explicitly evaluate and call out gaps in:
  - SLO/SLI definition and management
  - Latency and performance optimization (e.g., p95/p99)
  - Capacity planning and scaling decisions
  - Incident management and postmortem processes
  - On-call experience and operational readiness
  - Observability systems (alerts, dashboards, telemetry)
  - Operational metrics (MTTR, error rate, availability, cost efficiency)

- Do not collapse multiple missing requirements into a single generic gap.
- Each critical gap should represent a distinct missing capability.

- Avoid vague gaps such as "technical depth" or "infra experience" when more specific deficiencies can be identified.

- Gaps must map directly to the job’s success criteria and measurable outcomes.


---

# Output Requirements

Return a single valid JSON object with the following structure:

{
"fit": "High" | "Medium" | "Low",

"positioning_summary": "...",

"core_verdict": "Strong Hire" | "Borderline" | "Below Bar",

"top_signals": [
  {
    "name": "...",
    "score": 1-5,
    "reasoning": "...",
    "evidence": ["...", "..."],
    "importance": "High" | "Medium" | "Low"
  }
],

"primary_gap": "...",

"critical_gaps": [
  {
    "title": "...",
    "description": "...",
    "why_this_matters": "...",
    "severity": "High" | "Medium" | "Low"
  }
],

"prioritized_action_plan": [
  {
    "title": "...",
    "description": "...",
    "task_type": "resume" | "story" | "interview_prep" | "application" | "networking" | "strategy",
    "priority": "High" | "Medium" | "Low",
    "expected_impact": "..."
  }
],

"next_best_action": "..."
}

---

# Section Rules

## Fit
- One of: High / Medium / Low
- Must reflect true hiring readiness

## Positioning Summary
- Start with: Yes / Borderline / No (likelihood of interview)
- 3–5 direct sentences
- No fluff

## Core Verdict
- Strong Hire / Borderline / Below Bar
- Must align with fit

## Top Signals
- Max 6
- Focus on strongest hiring drivers
- Use concrete evidence

## Critical Gaps
- Max 4
- Must impact hiring decision
- Avoid generic weaknesses

## Action Plan
- Max 5
- Must be specific and actionable
- Prioritize highest leverage

## Next Best Action
- One step
- Must be doable within 30 minutes

---

# Style Guidelines

- Speak directly to the candidate (“you”)
- Be direct, precise, and professional
- No hedging or vague language
- No third-person phrasing
- No fluff

---

# Constraints

- Output ONLY valid JSON
- Do not include explanations outside JSON
- Do not omit any required fields
- Keep response concise and high-signal (target ~500–700 words)

---

Remember:
Your job is to make a clear hiring judgment, justify it with evidence, and tell the candidate exactly what to fix.
` }
          ]
        },
        {
          role: "user",
          content: [
            ...resumeContentParts,
            {
              type: "input_text",
              text: `
      TARGET ROLE: ${targetRole}
      TARGET LEVEL: ${targetLevel}

      JOB DESCRIPTION:
      ${jobDescription}
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
            fit: {
              type: "string",
              enum: ["High", "Medium", "Low"]
            },
            positioning_summary: { type: "string" },
            core_verdict: {
              type: "string",
              enum: ["Strong Hire", "Borderline", "Below Bar"]
            },
            top_signals: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  score: { type: "integer", minimum: 1, maximum: 5 },
                  reasoning: { type: "string" },
                  evidence: {
                    type: "array",
                    items: { type: "string" }
                  },
                  importance: {
                    type: "string",
                    enum: ["High", "Medium", "Low"]
                  }
                },
                required: ["name", "score", "reasoning", "evidence", "importance"]
              }
            },
            primary_gap: { type: "string" },
            critical_gaps: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  why_this_matters: { type: "string" },
                  severity: {
                    type: "string",
                    enum: ["High", "Medium", "Low"]
                  }
                },
                required: ["title", "description", "why_this_matters", "severity"]
              }
            },
            prioritized_action_plan: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  task_type: {
                    type: "string",
                    enum: ["resume", "story", "interview_prep", "application", "networking", "strategy"]
                  },
                  priority: {
                    type: "string",
                    enum: ["High", "Medium", "Low"]
                  },
                  expected_impact: { type: "string" }
                },
                required: ["title", "description", "task_type", "priority", "expected_impact"]
              }
            },
            next_best_action: { type: "string" }
          },
          required: [
            "fit",
            "positioning_summary",
            "core_verdict",
            "top_signals",
            "primary_gap",
            "critical_gaps",
            "prioritized_action_plan",
            "next_best_action"
          ]
        }
        }
      }
    });

    const content = response.output_text;
    const parsed = JSON.parse(content);

    console.log("PARSED ANALYZE OUTPUT:", JSON.stringify(parsed, null, 2));

const normalized = {
  fit: parsed.fit,
  core_verdict: parsed.core_verdict,
  positioning_summary: parsed.positioning_summary,
  primary_gap: parsed.primary_gap,

  signals: (parsed.top_signals || []).map((s: any) => ({
    signal_name: s.name,
    score: s.score,
    rationale: s.reasoning,
    evidence: s.evidence || [],
    importance: s.importance,
    risk_level: "medium",
  })),

  gaps: (parsed.critical_gaps || []).map((g: any, index: number) => ({
    gap_title: g.title,
    gap_description: g.description,
    why_this_matters: g.why_this_matters,
    severity: g.severity,
    priority: index + 1,
    recommended_fix: g.why_this_matters,
  })),

  plan: {
    next_best_action: parsed.next_best_action || "",
    tasks: (parsed.prioritized_action_plan || []).map((t: any) => ({
      title: t.title,
      description: t.description,
      task_type: t.task_type,
      priority:
        t.priority === "High" ? 1 :
        t.priority === "Medium" ? 2 : 3,
      priority_label: t.priority,
      expected_impact: t.expected_impact,
    })),
  },
};

let analysisId: string | null = null;
let planId: string | null = null;

if (user) {
  const { data: analysisRow, error: analysisError } = await supabaseAdmin
    .from("analyses")
    .insert({
      user_id: user.id,
      analysis_type: "initial_onboarding",
      model_name: "gpt-5.4",
      raw_json: normalized,
      summary: normalized.positioning_summary,
      status: "completed",
    })
    .select()
    .single();

  if (analysisError) throw analysisError;

  analysisId = analysisRow.id;

  if (normalized.signals?.length) {
    const signalRows = normalized.signals.map((s: any) => ({
      analysis_id: analysisId,
      user_id: user.id,
      signal_name: s.signal_name,
      score: Math.max(1, Math.min(5, Number(s.score) || 1)),
      rationale: s.rationale,
      evidence: s.evidence,
      risk_level:
        s.importance === "High" ? "high" :
       s.importance === "Medium" ? "medium" : "low",
    }));

    const { error } = await supabaseAdmin
      .from("signal_assessments")
      .insert(signalRows);

    if (error) throw error;
  }

  if (normalized.gaps?.length) {
    const gapRows = normalized.gaps.map((g: any) => ({
      analysis_id: analysisId,
      user_id: user.id,
      gap_title: g.gap_title,
      gap_description: g.gap_description,
      priority: g.priority,
      recommended_fix: g.recommended_fix,
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
      next_best_action: normalized.plan.next_best_action,
    })
    .select()
    .single();

  if (planError) throw planError;

  planId = planRow.id;

  if (normalized.plan?.tasks?.length) {
    const taskRows = normalized.plan.tasks.map((t: any) => ({
      plan_id: planId,
      user_id: user.id,
      title: t.title,
      description: t.description,
      priority: t.priority || 3,
      task_type: [
        "resume",
        "story",
        "interview_prep",
        "application",
        "networking",
        "strategy",
      ].includes(t.task_type)
        ? t.task_type
        : "strategy",
      status: "not_started",
    }));

    const { error } = await supabaseAdmin
      .from("plan_tasks")
      .insert(taskRows);

    if (error) throw error;
  }
}

return NextResponse.json({
  success: true,
  analysisId,
  planId,
  result: normalized,
});
  } catch (error: any) {
    console.error("Analyze API error:", error);

    return NextResponse.json(
      {
        error: error?.message || "Something went wrong"
      },
      { status: 500 }
    );
  }
}