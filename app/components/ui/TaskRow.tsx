"use client";

import * as React from "react";

export type TaskStatus = "new" | "in_progress" | "done";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  new: "New",
  in_progress: "In progress",
  done: "Done",
};

export const TASK_STATUS_ORDER: TaskStatus[] = ["new", "in_progress", "done"];

type TaskRowProps = {
  text: React.ReactNode;
  priority?: string | null;
  impact?: string | null;
  effort?: string | null;
  status: TaskStatus;
  onStatusChange: (status: TaskStatus) => void;
  className?: string;
};

function statusDotClass(status: TaskStatus): string {
  if (status === "done") return "bg-[color:var(--color-success-text)]";
  if (status === "in_progress") return "bg-[color:var(--color-caution-text)]";
  return "bg-[color:var(--color-text-muted)]";
}

/**
 * Compact action-plan task row.
 *
 * Consolidates the previous three colored badge families (priority /
 * impact / effort) into one neutral leading meta strip, replaces the
 * three-button status trio with a single native <select> next to a
 * status dot, and strikes-through completed tasks. All visual noise
 * per task drops from ~6 items to ~2, matching the design audit's
 * Action Plan calibration.
 */
export default function TaskRow({
  text,
  priority,
  impact,
  effort,
  status,
  onStatusChange,
  className = "",
}: TaskRowProps) {
  const meta = [priority, impact ? `${impact} impact` : null, effort ? `${effort} effort` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={"px-4 py-3.5 " + (className || "")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          {meta && (
            <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
              {meta}
            </div>
          )}
          <div
            className={
              "text-[14px] leading-[1.5] " +
              (status === "done"
                ? "text-[color:var(--color-text-muted)] line-through"
                : "text-[color:var(--color-text-primary)]")
            }
          >
            {text}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            aria-hidden
            className={"h-2 w-2 rounded-full " + statusDotClass(status)}
          />
          <select
            value={status}
            onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
            aria-label="Task status"
            className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-2 py-1 text-[12px] font-medium text-[color:var(--color-text-primary)] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
          >
            {TASK_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
