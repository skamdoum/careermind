"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import Card from "@/app/components/ui/Card";
import type { PlanRecommendation } from "@/lib/gap-investigation/plan-recommendation-types";

const LABELS = { FULL_MATCH: "Already addressed by your plan", PARTIAL_MATCH: "Partially addressed by your plan", NO_MATCH: "Additional action recommended", NO_ACTION_NEEDED: "No additional action needed" };
const STATUSES = { not_started: "New", in_progress: "In progress", done: "Done" };

export default function PlanRecommendationSection({ investigationId }: { investigationId: string }) {
  const [result, setResult] = useState<PlanRecommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function checkPlan() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await fetch(`/api/gap-investigations/${encodeURIComponent(investigationId)}/action-plan-recommendation`, { method: "POST", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || body.error || "Could not check your plan");
      setResult(body.data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not check your plan"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Card padding="lg"><div className="space-y-3">
    <h2 className="text-[15px] font-semibold">Action Plan follow-up</h2>
    <p className="text-[13px] text-[color:var(--color-text-secondary)]">Compare this finding with tasks saved for the originating analysis. Confirm or edit supporting evidence first.</p>
    <button onClick={checkPlan} disabled={busy} className="rounded-[6px] bg-[color:var(--color-accent-ink)] text-white px-3 py-2 text-[13px] disabled:opacity-50">{busy ? "Checking…" : "Check existing actions"}</button>
    {error && <p role="alert" className="text-[13px] text-[color:var(--color-danger-text)]">{error}</p>}
    {result && <RecommendationResult result={result} />}
    <p className="text-[12px] text-[color:var(--color-text-muted)]">Your Action Plan has not been modified. This check only returns recommendations.</p>
  </div></Card>;
}

export function RecommendationResult({ result }: { result: PlanRecommendation }) {
  return <div className="space-y-3 text-[13px]" role="status">
    <h3 className="font-semibold">{LABELS[result.outcome]}</h3>
    <p>{result.rationale}</p>
    {result.plan_availability !== "available" && <p>{result.plan_availability === "missing" ? "No saved plan exists for the originating analysis." : "The saved plan has no tasks."} No plan or task has been created.</p>}
    {result.matches.map(task => <div key={task.task_id} className="space-y-1">
      <Link href={`/dashboard/strategy#plan-${task.plan_id}`} className="underline">{task.title}</Link>
      <span className="ml-2">{STATUSES[task.status]}</span>
      {task.description && <p>{task.description}</p>}
      <p>{task.coverage_reason}</p>
    </div>)}
    {!!result.matches.length && <p>These tasks address the finding in your plan. Their status does not establish that the career gap is resolved.</p>}
    {result.remaining_need && <p><strong>Remaining need:</strong> {result.remaining_need}</p>}
    {result.proposed_task && <div className="rounded-[6px] bg-[color:var(--color-surface-elevated)] p-3 space-y-1"><h4 className="font-semibold">Suggested task: {result.proposed_task.title}</h4><p>{result.proposed_task.description}</p><p>Suggestion only — not added to your plan.</p></div>}
    <p className="text-[12px] text-[color:var(--color-text-muted)]">Assessment at the time of this check. Check again after changing evidence or tasks.</p>
  </div>;
}
