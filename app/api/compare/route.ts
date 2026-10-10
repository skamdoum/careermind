import { NextResponse } from "next/server";
import OpenAI from "openai";
import { resolveAuthorizedResume } from "@/lib/db/authorized-resume";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { createClient } from "@/lib/supabase/server";
import { RATE_LIMITS } from "@/lib/rate-limit/types";
import { tryConsume, markCompleted, markFailed, refund } from "@/lib/rate-limit/rpc";
import {
  classifyOpenAIError,
  isTransient,
} from "@/lib/rate-limit/openai-errors";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Cap per request to bound cost per `analyze` reservation. A compare
// request fans out to one OpenAI call per JD; without a cap, a single
// reservation could trigger many calls.
const MAX_JD_PER_COMPARE = 5;

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

    const { resumeText, latestResume, resume_id, jobDescriptions } = await req.json();

    if ((!resumeText && !resume_id && !latestResume?.id && !latestResume?.file_path) || !Array.isArray(jobDescriptions) || jobDescriptions.length === 0 || jobDescriptions.some((jd: unknown) => typeof jd !== "string" || !jd.trim())) {
      return NextResponse.json({ success: false, error: "Missing input" }, { status: 400 });
    }
    if (jobDescriptions.length > MAX_JD_PER_COMPARE) {
      return NextResponse.json(
        {
          success: false,
          error: "too_many_job_descriptions",
          message: `Compare supports at most ${MAX_JD_PER_COMPARE} job descriptions per request.`,
        },
        { status: 400 }
      );
    }

    const profile = await resolveActiveCareerProfile(supabase, user.id);
    const reference = { id: resume_id ?? latestResume?.id, file_path: latestResume?.file_path };
    const resolvedResume = await resolveAuthorizedResume(supabase, user.id, profile.id, reference);
    if ((reference.id || reference.file_path) && !resolvedResume) {
      return NextResponse.json({ success: false, error: "Resume not found" }, { status: 404 });
    }

    const idempotencyKey = req.headers.get("Idempotency-Key") ?? undefined;
    const reservation = await tryConsume({
      userId: user.id,
      bucket: "analyze",
      limit: RATE_LIMITS.analyze,
      idempotencyKey,
    });
    if (reservation.outcome === "rate_limited") {
      return NextResponse.json(
        {
          success: false,
          error: "rate_limit_exceeded",
          message: `You've reached the hourly limit for resume analyses. Try again in about ${Math.max(1, Math.ceil(reservation.retry_after_seconds / 60))} minute(s).`,
          bucket: "analyze",
          limit: reservation.quota_limit,
          used: reservation.used,
          retry_after_seconds: reservation.retry_after_seconds,
        },
        { status: 429, headers: { "Retry-After": String(reservation.retry_after_seconds) } }
      );
    }
    if (reservation.outcome === "duplicate_in_progress") {
      return NextResponse.json(
        { success: false, error: "duplicate_in_progress", message: "A prior comparison with this idempotency key is still in flight." },
        { status: 409 }
      );
    }
    if (reservation.outcome === "duplicate_completed") {
      // Compare does not persist its results, so a duplicate_completed
      // cannot be replayed. Return an explicit error instead of a
      // misleading success with empty data.
      return NextResponse.json(
        {
          success: false,
          error: "idempotent_replay_not_available",
          message: "Compare does not persist results. Retry with a new idempotency key.",
        },
        { status: 409 }
      );
    }
    if (reservation.outcome === "duplicate_failed" || reservation.outcome === "duplicate_refunded") {
      return NextResponse.json(
        {
          success: false,
          error: reservation.outcome === "duplicate_refunded" ? "idempotent_refunded" : "idempotent_failed",
          message: "A prior request with this idempotency key did not complete. Retry with a new idempotency key.",
        },
        { status: reservation.outcome === "duplicate_refunded" ? 503 : 500 }
      );
    }

    try {
    const resumeContentParts: OpenAI.Responses.ResponseInputContent[] = [];

    if (resolvedResume) {
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("resumes")
        .download(resolvedResume.file_path);

      if (downloadError) {
        throw downloadError;
      }

      const bytes = Buffer.from(await fileData.arrayBuffer());

      const openaiFile = await openai.files.create({
        file: new File([bytes], resolvedResume.file_name || "resume.pdf", {
          type: resolvedResume.mime_type || "application/octet-stream",
        }),
        purpose: "user_data",
      });

      resumeContentParts.push({
        type: "input_file",
        file_id: openaiFile.id,
      });
    }

    if (resumeText && !resolvedResume) {
      resumeContentParts.push({
        type: "input_text",
        text: `RESUME TEXT FALLBACK:\n${resumeText}`,
      });
    }

    const results = [];
    for (const jd of jobDescriptions) {
      const response = await openai.responses.create({
        model: "gpt-4.1",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: `You are CareerMind PM.

Analyze the candidate against the job description.

Return valid JSON with:
- company_name (string)
- core_verdict ("Strong Hire" | "Borderline" | "Below Bar")
- reasoning (short explanation)
- score (number from 1 to 5)

Be direct, specific, and decisive.`
              }
            ]
          },
          {
            role: "user",
            content: [
              ...resumeContentParts,
              {
                type: "input_text",
                text: `JOB DESCRIPTION:\n${jd}`
              }
            ]
          }
        ]
      });

      const text = response.output_text;

      const parsed = JSON.parse(text);
      results.push(parsed);
    }

    results.sort((a, b) => b.score - a.score);

    await markCompleted({ userId: user.id, eventId: reservation.event_id });

    return NextResponse.json(
      { success: true, data: results },
      {
        headers: {
          "X-RateLimit-Limit": String(reservation.quota_limit),
          "X-RateLimit-Remaining": String(Math.max(0, reservation.quota_limit - reservation.used)),
        },
      }
    );
    } catch (openaiErr) {
      const cls = classifyOpenAIError(openaiErr);
      if (isTransient(cls)) {
        await refund({ userId: user.id, eventId: reservation.event_id });
      } else {
        await markFailed({ userId: user.id, eventId: reservation.event_id });
      }
      throw openaiErr;
    }

  } catch (err) {
    console.error("COMPARE API ERROR:", err);
    return NextResponse.json({ success: false, error: "Compare failed" }, { status: 500 });
  }
}