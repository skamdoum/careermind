export type PlanTaskStatus = "not_started" | "in_progress" | "done";
export type PlanTask = {
  id: string;
  plan_id: string;
  title: string;
  description: string | null;
  priority: number;
  status: PlanTaskStatus;
};
export type AnalysisPlans = {
  id: string;
  created_at: string;
  plans: Array<{ id: string; next_best_action: string | null; tasks: PlanTask[] }>;
};
export type ActionPlanGroup = {
  key: string;
  goal: { title: string; href: string | null };
  jobs: Array<{
    key: string;
    title: string;
    href: string | null;
    analyses: AnalysisPlans[];
  }>;
};
export type ActionPlanData = { groups: ActionPlanGroup[] };
