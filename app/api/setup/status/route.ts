import { NextResponse } from "next/server";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { createClient } from "@/lib/supabase/server";

/**
 * Additive, read-only endpoint that returns just enough counts to drive
 * the Getting Started checklist and the Overview / Strategy /
 * post-analysis empty-state logic. One round trip.
 *
 * Scope:
 *   - Top-level counts (goals, resumes) are scoped to the active career
 *     profile.
 *   - Goal-scoped counts (jobs, analyses) attach to a specific goal:
 *     the one named in ?goal_id=... when provided, otherwise the most
 *     recently created goal for the active profile.
 *   - `goal` is null when the user has no goals yet.
 *
 * No schema changes, no evaluator changes, no RLS changes. This route
 * just aggregates counts that other pages already query individually.
 */

export const dynamic = "force-dynamic";

type GoalStatus = {
  id: string;
  title: string | null;
  jobs_count: number;
  analyses_count: number;
  /** Most-recently-created target role under this goal (any state). */
  latest_job_id: string | null;
  /**
   * Newest target role under this goal that has NOT been analyzed yet.
   * Null when all target roles have at least one analysis, or when
   * the goal has no target roles. Used by SetupChecklist to route the
   * "Analyze another role" CTA to the correct unanalyzed target role.
   */
  next_unanalyzed_job_id: string | null;
};

type SetupStatus = {
  goals_count: number;
  resumes_count: number;
  goal: GoalStatus | null;
};

export async function GET(req: Request) {
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

    const activeProfile = await resolveActiveCareerProfile(supabase, user.id);
    const activeProfileId = activeProfile.id;

    // Top-level counts.
    const [{ count: goalsCount }, { count: resumesCount }] = await Promise.all([
      supabase
        .from("career_goals")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("career_profile_id", activeProfileId),
      supabase
        .from("resumes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("career_profile_id", activeProfileId),
    ]);

    // Which goal to scope job / analysis counts to.
    const url = new URL(req.url);
    const requestedGoalId = url.searchParams.get("goal_id");

    let goalRow: { id: string; title: string | null } | null = null;

    if (requestedGoalId) {
      const { data } = await supabase
        .from("career_goals")
        .select("id, title")
        .eq("id", requestedGoalId)
        .eq("user_id", user.id)
        .eq("career_profile_id", activeProfileId)
        .maybeSingle();
      if (data) goalRow = data as { id: string; title: string | null };
    } else {
      const { data } = await supabase
        .from("career_goals")
        .select("id, title")
        .eq("user_id", user.id)
        .eq("career_profile_id", activeProfileId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) goalRow = data as { id: string; title: string | null };
    }

    let goal: GoalStatus | null = null;

    if (goalRow) {
      // Pull the full job + analysis lists for the goal in one round
      // trip each so we can derive both counts AND the newest-not-yet-
      // analyzed target role without a third query.
      const [jobsQuery, analysesQuery] = await Promise.all([
        supabase
          .from("job_descriptions")
          .select("id, created_at")
          .eq("user_id", user.id)
          .eq("career_profile_id", activeProfileId)
          .eq("career_goal_id", goalRow.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("analyses")
          .select("id, job_description_id")
          .eq("user_id", user.id)
          .eq("career_profile_id", activeProfileId)
          .eq("career_goal_id", goalRow.id),
      ]);

      const jobs = (jobsQuery.data ?? []) as Array<{
        id: string;
        created_at: string;
      }>;
      const analyses = (analysesQuery.data ?? []) as Array<{
        id: string;
        job_description_id: string | null;
      }>;

      const analyzedJobIds = new Set(
        analyses
          .map((a) => a.job_description_id)
          .filter((v): v is string => typeof v === "string")
      );

      const latestJob = jobs[0] ?? null;
      const nextUnanalyzed = jobs.find((j) => !analyzedJobIds.has(j.id)) ?? null;

      goal = {
        id: goalRow.id,
        title: goalRow.title,
        jobs_count: jobs.length,
        analyses_count: analyses.length,
        latest_job_id: latestJob?.id ?? null,
        next_unanalyzed_job_id: nextUnanalyzed?.id ?? null,
      };
    }

    const data: SetupStatus = {
      goals_count: goalsCount ?? 0,
      resumes_count: resumesCount ?? 0,
      goal,
    };

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to load setup status" },
      { status: 500 }
    );
  }
}
