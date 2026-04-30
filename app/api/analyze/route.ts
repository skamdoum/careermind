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
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: userError?.message || "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const {
      resumeText,
      jobDescription,
      targetRole,
      targetLevel,
      latestResume,
    } = body;

    if (!jobDescription) {
      return NextResponse.json(
        { error: "Missing required fields" },
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
          error: "Free limit reached",
          code: "LIMIT_REACHED",
        },
        { status: 403 }
      );
    }

    if (!resumeText && !latestResume?.file_path) {
      return NextResponse.json(
        { error: "Provide resume text or upload a resume first" },
        { status: 400 }
      );
    }

      let resumeContentParts: any[] = [];

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
You are CareerMind, an expert PM career coach for experienced Product Managers targeting competitive roles.

Your job is NOT to describe the candidate. Your job is to make a clear hiring judgment and tell them exactly what to fix.

OUTPUT REQUIREMENTS:

1. POSITIONING SUMMARY
- Answer clearly: Would YOU likely get an interview? (Yes / Borderline / No)
- Be direct and decisive
- 3–5 sentences max

2. CORE VERDICT
- One of: "Strong Hire", "Borderline", "Below Bar"
- This must align with how a real hiring panel would evaluate

3. TOP SIGNALS (max 6)
Each must include:
- name
- score (1–5)
- reasoning (specific)
- evidence (bullet list)
- importance (High / Medium / Low)

4. CRITICAL GAPS (max 4)
Each must include:
- title
- description
- why_this_matters (tie directly to hiring decision)
- severity (High / Medium / Low)

5. PRIORITIZED ACTION PLAN (max 5 tasks)
Each must include:
- title
- description
- task_type (resume, story, interview_prep, application, networking, strategy)
- priority (High / Medium / Low)
- expected_impact (what improves if done)

6. NEXT BEST ACTION
- ONE action only
- must be the highest-leverage step
- must take <30 minutes to start

STYLE:
- speak directly to the candidate using "you"
- be direct but professional
- avoid third-person phrasing like "the candidate"
- no fluff
- no generic advice

- risk_level must be exactly one of: low, medium, high
- importance must be exactly one of: High, Medium, Low
- severity must be exactly one of: High, Medium, Low
- task priority must be exactly one of: High, Medium, Low

Return only valid JSON.
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
              positioning_summary: { type: "string" },
              core_verdict: {
              type: "string",
              enum: ["Strong Hire", "Borderline", "Below Bar"]
               },
              signals: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
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
                    gap_title: { type: "string" },
                    gap_description: { type: "string" },
                    priority: { type: "integer" },
                    recommended_fix: { type: "string" }
                  },
                  required: [
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
            required: ["positioning_summary", "core_verdict", "signals", "gaps", "plan"]
          }
        }
      }
    });

    const content = response.output_text;
    const parsed = JSON.parse(content);

    const { data: analysisRow, error: analysisError } = await supabaseAdmin
      .from("analyses")
      .insert({
        user_id: user.id,
        analysis_type: "initial_onboarding",
        model_name: "gpt-5.4",
        raw_json: parsed,
        summary: parsed.positioning_summary,
        status: "completed"
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

const signalRows = parsed.signals.map((s: any) => ({
  analysis_id: analysisId,
  user_id: user.id,
  signal_name: s.signal_name,
  score: Math.max(1, Math.min(5, Number(s.score) || 1)),
  rationale: s.rationale,
  evidence: s.evidence,
  risk_level: normalizeRiskLevel(s.risk_level),
}));

      const { error } = await supabaseAdmin
        .from("signal_assessments")
        .insert(signalRows);

      if (error) throw error;
    }

    if (parsed.gaps?.length) {
      const gapRows = parsed.gaps.map((g: any) => ({
        analysis_id: analysisId,
        user_id: user.id,
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
      analysisId,
      planId: planRow.id,
      result: parsed
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