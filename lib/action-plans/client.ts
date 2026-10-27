import type { ActionPlanData, PlanTask, PlanTaskStatus } from "./types";

export async function loadActionPlans(signal?: AbortSignal): Promise<ActionPlanData> {
  const response = await fetch("/api/action-plans", { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error || "Could not load your action plans");
  return body.data;
}

export async function saveTaskStatus(id: string, status: PlanTaskStatus): Promise<PlanTask> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error || "Could not save task status");
  return body.data;
}
