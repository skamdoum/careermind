"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/app/components/ui/PageHeader";
import SectionHeader from "@/app/components/ui/SectionHeader";
import Card from "@/app/components/ui/Card";
import Badge from "@/app/components/ui/Badge";
import EmptyState from "@/app/components/ui/EmptyState";
import TaskRow, {
  TASK_STATUS_LABELS,
  type TaskStatus,
} from "@/app/components/ui/TaskRow";

/**
 * Action Plan surface.
 *
 * Split out of the old dual-mode insights.tsx. The task rows use
 * TaskRow (single leading meta chip + neutral status control),
 * replacing the jangly six-badge-per-task treatment from V0. Progress
 * gets a visible bar (accent-ink fill on surface-elevated track) and
 * a compact stat strip.
 */

type Task = {
  text: string;
  priority?: string | null;
  impact?: string | null;
  effort?: string | null;
};

type Action = {
  title: string;
  impact?: string | null;
  tasks: Task[];
};

type Strategy = {
  actions?: Action[];
};

export default function ActionPlan() {
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [taskStatuses, setTaskStatuses] = useState<Record<string, TaskStatus>>(
    {}
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/strategy")
      .then((r) => r.json())
      .then((d) => {
        setStrategy(d?.success ? (d.data as Strategy) : null);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const actions = strategy?.actions || [];

  let total = 0;
  const counts: Record<TaskStatus, number> = {
    new: 0,
    in_progress: 0,
    done: 0,
  };
  actions.forEach((a, i) => {
    a.tasks?.forEach((_, j) => {
      total++;
      const status = taskStatuses[`${i}:${j}`] || "new";
      counts[status]++;
    });
  });
  const percent = total > 0 ? Math.round((counts.done / total) * 100) : 0;

  if (!loaded) {
    return (
      <div className="text-[13px] text-[color:var(--color-text-muted)]">
        Loading action plan…
      </div>
    );
  }

  if (actions.length === 0) {
    return (
      <EmptyState
        title="No action plan yet"
        description="Run an analysis on a target role to generate your first prioritized plan."
      />
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Action Plan"
        description="Your prioritized execution plan across target roles. Start with P1 tasks and update each status as you make progress."
      />

      {/* Progress — 4-stat strip + visible bar */}
      <Card padding="lg">
        <div className="space-y-4">
          <SectionHeader
            eyebrow="Progress"
            title={`${percent}% complete`}
            meta={`${counts.done} of ${total} done`}
          />
          <div className="h-2 w-full rounded-full bg-[color:var(--color-surface-elevated)] overflow-hidden">
            <div
              className="h-2 rounded-full bg-[color:var(--color-accent-ink)] transition-[width]"
              style={{ width: `${percent}%` }}
              aria-label={`${percent} percent complete`}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <div className="grid grid-cols-3 gap-3 text-[13px]">
            {(["new", "in_progress", "done"] as TaskStatus[]).map((s) => (
              <div
                key={s}
                className="rounded-[6px] bg-[color:var(--color-surface-elevated)] px-3 py-2"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
                  {TASK_STATUS_LABELS[s]}
                </div>
                <div className="text-[16px] font-semibold text-[color:var(--color-text-primary)] mt-0.5">
                  {counts[s]}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Action categories */}
      <div className="space-y-6">
        {actions.map((action, i) => (
          <section key={i} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-7 h-7 rounded-full bg-[color:var(--color-accent-ink)] text-white text-[13px] font-semibold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </div>
                <h3 className="text-[15px] font-semibold text-[color:var(--color-text-primary)] truncate">
                  {action.title}
                </h3>
              </div>
              {action.impact && (
                <Badge
                  variant={
                    action.impact.toLowerCase() === "high"
                      ? "success"
                      : action.impact.toLowerCase() === "medium"
                      ? "caution"
                      : "neutral"
                  }
                >
                  {action.impact} impact
                </Badge>
              )}
            </div>

            <div className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] divide-y divide-[color:var(--color-border-subtle)] overflow-hidden">
              {action.tasks?.map((task, j) => {
                const key = `${i}:${j}`;
                const status = taskStatuses[key] || "new";
                return (
                  <TaskRow
                    key={j}
                    text={task.text}
                    priority={task.priority}
                    impact={task.impact}
                    effort={task.effort}
                    status={status}
                    onStatusChange={(s) =>
                      setTaskStatuses((prev) => ({ ...prev, [key]: s }))
                    }
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
