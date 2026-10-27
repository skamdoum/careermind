import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionPlanData, PlanTask } from "./types";

type Analysis = { id: string; created_at: string; career_goal_id: string | null; job_description_id: string | null };
type Plan = { id: string; analysis_id: string; next_best_action: string | null };
type Goal = { id: string; title: string };
type Job = { id: string; career_goal_id: string | null; role_title: string | null; company_name: string | null };

// Read every page: Supabase's default response cap must not silently hide plans.
async function rows<T>(query: {
  range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw new Error("Failed to load saved action plans");
    const page = (data ?? []) as T[];
    result.push(...page);
    if (page.length < 500) return result;
  }
}

export async function readActionPlans(client: SupabaseClient, userId: string, profileId: string): Promise<ActionPlanData> {
  // Resolve parent scope first; never select plans by user alone or by a label.
  const analyses = await rows<Analysis>(client.from("analyses")
    .select("id,created_at,career_goal_id,job_description_id")
    .eq("user_id", userId).eq("career_profile_id", profileId)
    .order("created_at", { ascending: false }).order("id"));
  if (!analyses.length) return { groups: [] };

  const [goals, jobs] = await Promise.all([
    rows<Goal>(client.from("career_goals").select("id,title").eq("user_id", userId).eq("career_profile_id", profileId).order("id")),
    rows<Job>(client.from("job_descriptions").select("id,career_goal_id,role_title,company_name").eq("user_id", userId).eq("career_profile_id", profileId).order("id")),
  ]);
  const plans: Plan[] = [], tasks: PlanTask[] = [];
  // Bound IN queries as well as response pages for larger analysis histories.
  for (let i = 0; i < analyses.length; i += 100) {
    plans.push(...await rows<Plan>(client.from("plans").select("id,analysis_id,next_best_action")
      .eq("user_id", userId).in("analysis_id", analyses.slice(i, i + 100).map(a => a.id)).order("created_at").order("id")));
  }
  for (let i = 0; i < plans.length; i += 100) {
    tasks.push(...await rows<PlanTask>(client.from("plan_tasks").select("id,plan_id,title,description,priority,status")
      .eq("user_id", userId).in("plan_id", plans.slice(i, i + 100).map(p => p.id)).order("priority").order("id")));
  }
  const groups: ActionPlanData["groups"] = [];
  for (const analysis of analyses) {
    const goal = goals.find(g => g.id === analysis.career_goal_id);
    // A malformed cross-goal reference must never acquire a different job's label/link.
    const job = jobs.find(j => j.id === analysis.job_description_id && j.career_goal_id === analysis.career_goal_id);
    const goalKey = analysis.career_goal_id ?? "unassigned";
    let group = groups.find(g => g.key === goalKey);
    if (!group) {
      group = { key: goalKey, goal: { title: goal?.title ?? (analysis.career_goal_id ? "Career goal unavailable" : "Analyses without a career goal"), href: goal ? `/dashboard/goals/${goal.id}` : null }, jobs: [] };
      groups.push(group);
    }
    const jobKey = analysis.job_description_id ?? "unassigned";
    let target = group.jobs.find(j => j.key === jobKey);
    if (!target) {
      target = { key: jobKey, title: job ? [job.role_title || "Target role", job.company_name].filter(Boolean).join(" · ") : analysis.job_description_id ? "Target job unavailable" : "No target job", href: job && goal ? `/dashboard/goals/${goal.id}/jobs/${job.id}` : null, analyses: [] };
      group.jobs.push(target);
    }
    target.analyses.push({ id: analysis.id, created_at: analysis.created_at, plans: plans.filter(p => p.analysis_id === analysis.id).map(p => ({ id: p.id, next_best_action: p.next_best_action, tasks: tasks.filter(t => t.plan_id === p.id) })) });
  }
  return { groups };
}
