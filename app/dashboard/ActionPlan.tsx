"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import PageHeader from "@/app/components/ui/PageHeader";
import SectionHeader from "@/app/components/ui/SectionHeader";
import Card from "@/app/components/ui/Card";
import EmptyState from "@/app/components/ui/EmptyState";
import TaskRow, { TASK_STATUS_LABELS, type TaskStatus } from "@/app/components/ui/TaskRow";
import { loadActionPlans, saveTaskStatus } from "@/lib/action-plans/client";
import type { ActionPlanData, PlanTaskStatus } from "@/lib/action-plans/types";

export default function ActionPlan() {
  const [data, setData] = useState<ActionPlanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState<string[]>([]);
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    loadActionPlans(controller.signal).then(result => {
      if (!controller.signal.aborted) { setData(result); setError(null); }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load action plans");
    });
    return () => controller.abort();
  }, [attempt]);

  async function updateStatus(id: string, status: TaskStatus) {
    if (pending.current.has(id)) return;
    pending.current.add(id);
    setSaving([...pending.current]);
    setTaskErrors(previous => ({ ...previous, [id]: "" }));
    try {
      const updated = await saveTaskStatus(id, status === "new" ? "not_started" : status);
      // Update from the acknowledged database response, not optimistic local state.
      setData(previous => previous && ({
        groups: previous.groups.map(group => ({
          ...group,
          jobs: group.jobs.map(job => ({
            ...job,
            analyses: job.analyses.map(analysis => ({
              ...analysis,
              plans: analysis.plans.map(plan => ({
                ...plan,
                tasks: plan.tasks.map(task => task.id === id ? { ...task, status: updated.status } : task),
              })),
            })),
          })),
        })),
      }));
    } catch (reason) {
      setTaskErrors(previous => ({ ...previous, [id]: reason instanceof Error ? reason.message : "Could not save task status" }));
    } finally {
      pending.current.delete(id);
      setSaving([...pending.current]);
    }
  }

  if (error && !data) return <EmptyState title="Could not load your action plan" description={error} action={<button className="underline" onClick={() => { setError(null); setAttempt(value => value + 1); }}>Try again</button>} />;
  if (!data) return <p className="text-[13px] text-[color:var(--color-text-muted)]" role="status">Loading action plan…</p>;
  return <ActionPlanView data={data} saving={saving} taskErrors={taskErrors} onStatusChange={updateStatus} />;
}

// The same persisted-data view is used on screen and in rendering tests.
export function ActionPlanView({ data, saving = [], taskErrors = {}, onStatusChange }: {
  data: ActionPlanData;
  saving?: string[];
  taskErrors?: Record<string, string>;
  onStatusChange: (id: string, status: TaskStatus) => void;
}) {
  const tasks = data.groups.flatMap(group => group.jobs.flatMap(job => job.analyses.flatMap(analysis => analysis.plans.flatMap(plan => plan.tasks))));
  const counts: Record<PlanTaskStatus, number> = { not_started: 0, in_progress: 0, done: 0 };
  tasks.forEach(task => { counts[task.status]++; });
  const percent = tasks.length ? Math.round(100 * counts.done / tasks.length) : 0;

  return <div className="space-y-8">
    <PageHeader title="Action Plan" description="Your saved execution plans, organized by career goal and target role. Update tasks as you make progress." />
    {!data.groups.length ? <EmptyState title="Your action plan is built from analyses" description="Run an analysis on a target role to create a saved plan and prioritized tasks." action={<Link href="/analyze" className="underline">Run an analysis</Link>} /> : <>
      {!!tasks.length && <Card padding="lg"><div className="space-y-4">
        <SectionHeader eyebrow="Progress" title={`${percent}% complete`} meta={`${counts.done} of ${tasks.length} done`} />
        <div className="h-2 rounded-full bg-[color:var(--color-surface-elevated)] overflow-hidden"><div className="h-2 rounded-full bg-[color:var(--color-accent-ink)] transition-[width]" style={{ width: `${percent}%` }} role="progressbar" aria-label={`${percent} percent complete`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} /></div>
        <div className="grid grid-cols-3 gap-3 text-[13px]">{(["new", "in_progress", "done"] as TaskStatus[]).map(status => <div key={status} className="rounded-[6px] bg-[color:var(--color-surface-elevated)] px-3 py-2"><div className="text-[11px] font-semibold uppercase text-[color:var(--color-text-muted)]">{TASK_STATUS_LABELS[status]}</div><div className="text-[16px] font-semibold mt-0.5">{counts[status === "new" ? "not_started" : status]}</div></div>)}</div>
      </div></Card>}
      {data.groups.map(group => <section key={group.key} className="space-y-5">
        <h2 className="text-[18px] font-semibold">{group.goal.href ? <Link href={group.goal.href} className="hover:underline">{group.goal.title}</Link> : group.goal.title}</h2>
        {group.jobs.map(job => <section key={job.key} className="space-y-4">
          <h3 className="text-[15px] font-semibold">{job.href ? <Link href={job.href} className="hover:underline">{job.title}</Link> : job.title}</h3>
          {job.analyses.map(analysis => <Card key={analysis.id} padding="lg"><div className="space-y-4">
            <Link href={`/dashboard/${analysis.id}`} className="text-[13px] underline">Analysis {analysis.id.slice(0, 8)} · {analysis.created_at.slice(0, 10)}</Link>
            {!analysis.plans.length && <EmptyState title="No saved plan for this analysis" description="This analysis has no saved action plan. No plan has been created or substituted automatically." />}
            {analysis.plans.map((plan, index) => <div key={plan.id} id={`plan-${plan.id}`} className="space-y-3">
              {analysis.plans.length > 1 && <h4 className="text-[13px] font-semibold">Plan {index + 1}</h4>}
              {plan.next_best_action && <p className="text-[14px] text-[color:var(--color-text-secondary)]">{plan.next_best_action}</p>}
              {!plan.tasks.length ? <EmptyState title="No tasks in this plan" description="This saved plan does not contain any tasks yet." /> : <div className="rounded-[6px] border border-[color:var(--color-border-standard)] divide-y divide-[color:var(--color-border-subtle)] overflow-hidden">{plan.tasks.map(task => <fieldset key={task.id} disabled={saving.includes(task.id)} className="min-w-0" aria-label={task.title}>
                <TaskRow text={<><span className="font-medium">{task.title}</span>{task.description && <span className="block text-[13px] text-[color:var(--color-text-secondary)] mt-1">{task.description}</span>}</>} priority={`P${task.priority}`} status={task.status === "not_started" ? "new" : task.status} onStatusChange={status => onStatusChange(task.id, status)} />
                {saving.includes(task.id) && <p role="status" className="px-4 pb-3 text-[12px]">Saving…</p>}
                {taskErrors[task.id] && <p role="alert" className="px-4 pb-3 text-[13px] text-[color:var(--color-danger-text)]">{taskErrors[task.id]}</p>}
              </fieldset>)}</div>}
            </div>)}
          </div></Card>)}
        </section>)}
      </section>)}
    </>}
  </div>;
}
