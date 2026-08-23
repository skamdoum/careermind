import { requireUserAndActiveProfile } from "@/lib/db/career-profiles";

export type RecurringItem = {
  label: string;
  count: number;
  percentage: number;
  sample_rationale: string | null;
};

export type GoalCrossJobInsights = {
  analyzed_role_count: number;
  recurring_signals: RecurringItem[];
  recurring_gaps: RecurringItem[];
  recommended_focus: string[];
};

const TOP_N = 3;
const MIN_ROLES_FOR_INSIGHTS = 2;
const STRONG_SIGNAL_THRESHOLD = 4;

function normalizeKey(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

type Bucket = {
  label: string;
  roles: Set<string>;
  weightSum: number;
  sample_rationale: string | null;
};

type BucketInput = {
  analysisId: string;
  key: string;
  displayLabel: string;
  weight: number;
  rationale: string | null;
};

function aggregate(
  inputs: BucketInput[],
  analyzedRoleCount: number,
  higherWeightIsBetter: boolean
): RecurringItem[] {
  const buckets = new Map<string, Bucket>();

  // Per (analysisId, key) dedup — one contribution per role even if the LLM
  // repeats the same signal/gap within a single analysis.
  const seenPerAnalysis = new Map<string, Set<string>>();

  for (const input of inputs) {
    if (!input.key) continue;

    const seen = seenPerAnalysis.get(input.analysisId) ?? new Set<string>();
    if (seen.has(input.key)) continue;
    seen.add(input.key);
    seenPerAnalysis.set(input.analysisId, seen);

    const bucket = buckets.get(input.key);
    if (bucket) {
      bucket.roles.add(input.analysisId);
      bucket.weightSum += input.weight;
    } else {
      buckets.set(input.key, {
        label: input.displayLabel,
        roles: new Set([input.analysisId]),
        weightSum: input.weight,
        sample_rationale: input.rationale,
      });
    }
  }

  return Array.from(buckets.values())
    .map((b) => ({
      label: b.label,
      count: b.roles.size,
      weightSum: b.weightSum,
      sample_rationale: b.sample_rationale,
    }))
    .filter((b) => b.count >= 2)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return higherWeightIsBetter
        ? b.weightSum - a.weightSum
        : a.weightSum - b.weightSum;
    })
    .slice(0, TOP_N)
    .map((b) => ({
      label: b.label,
      count: b.count,
      percentage:
        analyzedRoleCount > 0
          ? Math.round((b.count / analyzedRoleCount) * 100)
          : 0,
      sample_rationale: b.sample_rationale,
    }));
}

function buildRecommendedFocus(
  recurringGaps: RecurringItem[],
  analyzedRoleCount: number
): string[] {
  const focus: string[] = [];

  if (recurringGaps[0]) {
    const g = recurringGaps[0];
    focus.push(
      `${g.label} appears as a gap in ${g.count} of ${analyzedRoleCount} target roles. Make this your first improvement priority.`
    );
  }

  if (recurringGaps[1]) {
    const g = recurringGaps[1];
    focus.push(
      `${g.label} shows up in ${g.count} of ${analyzedRoleCount} — address this after the top priority.`
    );
  }

  if (recurringGaps[2]) {
    const g = recurringGaps[2];
    focus.push(
      `${g.label} recurs in ${g.count} of ${analyzedRoleCount} target roles — worth attention once the first two are underway.`
    );
  }

  return focus;
}

export async function getGoalCrossJobInsights(
  goalId: string
): Promise<GoalCrossJobInsights> {
  const { supabase, user, activeProfileId } =
    await requireUserAndActiveProfile();

  const { data: goal, error: goalError } = await supabase
    .from("career_goals")
    .select("id")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .eq("career_profile_id", activeProfileId)
    .maybeSingle();

  if (goalError) {
    throw new Error(`Failed to verify career goal: ${goalError.message}`);
  }

  if (!goal) {
    throw new Error("Career goal not found");
  }

  const { data: analyses, error: analysesError } = await supabase
    .from("analyses")
    .select("id, created_at, job_description_id")
    .eq("career_goal_id", goalId)
    .eq("user_id", user.id)
    .eq("career_profile_id", activeProfileId)
    .not("job_description_id", "is", null)
    .order("created_at", { ascending: false });

  if (analysesError) {
    throw new Error(`Failed to fetch analyses: ${analysesError.message}`);
  }

  const latestAnalysisIdByRole = new Map<string, string>();
  for (const a of analyses ?? []) {
    const jobId = a.job_description_id as string | null;
    if (!jobId) continue;
    if (!latestAnalysisIdByRole.has(jobId)) {
      latestAnalysisIdByRole.set(jobId, a.id as string);
    }
  }

  const analyzed_role_count = latestAnalysisIdByRole.size;
  const latestIds = Array.from(latestAnalysisIdByRole.values());

  if (analyzed_role_count < MIN_ROLES_FOR_INSIGHTS || latestIds.length === 0) {
    return {
      analyzed_role_count,
      recurring_signals: [],
      recurring_gaps: [],
      recommended_focus: [],
    };
  }

  const [signalsResult, gapsResult] = await Promise.all([
    supabase
      .from("signal_assessments")
      .select("analysis_id, signal_name, score, rationale")
      .in("analysis_id", latestIds)
      .eq("user_id", user.id),
    supabase
      .from("gaps")
      .select("analysis_id, gap_title, gap_description, priority")
      .in("analysis_id", latestIds)
      .eq("user_id", user.id),
  ]);

  if (signalsResult.error) {
    throw new Error(`Failed to fetch signals: ${signalsResult.error.message}`);
  }

  if (gapsResult.error) {
    throw new Error(`Failed to fetch gaps: ${gapsResult.error.message}`);
  }

  const signalInputs: BucketInput[] = (signalsResult.data ?? [])
    .filter((s: { score: number }) => (s.score ?? 0) >= STRONG_SIGNAL_THRESHOLD)
    .map((s) => ({
      analysisId: s.analysis_id as string,
      key: normalizeKey(s.signal_name as string | null),
      displayLabel: (s.signal_name as string | null)?.trim() || "",
      weight: Number(s.score) || 0,
      rationale: (s.rationale as string | null) ?? null,
    }));

  const gapInputs: BucketInput[] = (gapsResult.data ?? []).map((g) => ({
    analysisId: g.analysis_id as string,
    key: normalizeKey(g.gap_title as string | null),
    displayLabel: (g.gap_title as string | null)?.trim() || "",
    weight: Number(g.priority) || 0,
    rationale: (g.gap_description as string | null) ?? null,
  }));

  // Signals: higher `score` = stronger signal.
  const recurring_signals = aggregate(signalInputs, analyzed_role_count, true);
  // Gaps: `priority` uses the codebase convention where 1 = highest priority
  // (see PRIORITY_RANK in app/api/strategy/route.ts), so smaller weightSum wins the tie-break.
  const recurring_gaps = aggregate(gapInputs, analyzed_role_count, false);
  const recommended_focus = buildRecommendedFocus(
    recurring_gaps,
    analyzed_role_count
  );

  return {
    analyzed_role_count,
    recurring_signals,
    recurring_gaps,
    recommended_focus,
  };
}
