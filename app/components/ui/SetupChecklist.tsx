"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Card from "./Card";

/**
 * Shared "Get set up" checklist.
 *
 * Same 4-step contract everywhere it appears — Goal Detail while any
 * step is incomplete, Overview for users who haven't reached the
 * cross-role-patterns threshold. Hides itself when all four are done
 * (no dismiss button — progress alone hides it).
 */

type SetupStatus = {
  goals_count: number;
  resumes_count: number;
  goal: {
    id: string;
    title: string | null;
    jobs_count: number;
    analyses_count: number;
    latest_job_id: string | null;
    next_unanalyzed_job_id: string | null;
  } | null;
};

type Step = {
  key: "goal" | "resume" | "role" | "analysis";
  label: string;
  done: boolean;
  cta: { label: string; href: string } | null;
  actionable: boolean;
};

function buildSteps(status: SetupStatus): Step[] {
  const goalId = status.goal?.id ?? null;
  const analysesCount = status.goal?.analyses_count ?? 0;
  const jobsCount = status.goal?.jobs_count ?? 0;
  const nextUnanalyzedJobId = status.goal?.next_unanalyzed_job_id ?? null;
  const latestJobId = status.goal?.latest_job_id ?? null;

  const goalDone = status.goals_count >= 1;
  const resumeDone = status.resumes_count >= 1;
  const roleDone = jobsCount >= 1;
  // Onboarding leads the user all the way through analysis #2 so the
  // full CareerMind value (cross-role patterns + Strategy) is
  // unlocked before the checklist retires. The Action Plan already
  // populates from analysis #1, but the workflow only stops feeling
  // half-finished once patterns are on.
  const analysisStepDone = analysesCount >= 2;

  // Label + CTA for the final step progress through:
  //   0 analyses  → "Analyze 2 target roles", CTA "Analyze your first role"
  //   1 analysis  → "Analyze 2 target roles — 1 of 2 complete",
  //                  CTA "Analyze another role" (or "Add another target role"
  //                  when no unanalyzed role exists)
  //   2+ analyses → checked, no CTA
  const analysisLabel =
    analysesCount >= 2
      ? "Analyze 2 target roles"
      : analysesCount === 1
      ? "Analyze 2 target roles — 1 of 2 complete"
      : "Analyze 2 target roles";

  let analysisCta: { label: string; href: string } | null = null;
  const analysisActionable =
    !analysisStepDone && goalDone && resumeDone && roleDone;

  if (analysisActionable && goalId) {
    if (analysesCount === 0 && latestJobId) {
      analysisCta = {
        label: "Analyze your first role",
        href: `/dashboard/goals/${goalId}/jobs/${latestJobId}`,
      };
    } else if (analysesCount === 1 && nextUnanalyzedJobId) {
      analysisCta = {
        label: "Analyze another role",
        href: `/dashboard/goals/${goalId}/jobs/${nextUnanalyzedJobId}`,
      };
    } else if (analysesCount === 1 && !nextUnanalyzedJobId) {
      // The user analyzed the only role they had — the next step
      // is to add another target role so a second analysis is
      // possible.
      analysisCta = {
        label: "Add another target role",
        href: `/dashboard/goals/${goalId}/jobs/new`,
      };
    }
  }

  return [
    {
      key: "goal",
      label: "Set your direction",
      done: goalDone,
      actionable: !goalDone,
      cta: goalDone
        ? null
        : { label: "Create career goal", href: "/dashboard/goals/new" },
    },
    {
      key: "resume",
      label: "Upload your resume",
      done: resumeDone,
      actionable: !resumeDone && goalDone,
      cta:
        resumeDone || !goalDone
          ? null
          : { label: "Upload resume", href: "/analyze" },
    },
    {
      key: "role",
      label: "Add a target role",
      done: roleDone,
      actionable: !roleDone && goalDone,
      cta:
        roleDone || !goalDone || !goalId
          ? null
          : {
              label: "Add target role",
              href: `/dashboard/goals/${goalId}/jobs/new`,
            },
    },
    {
      key: "analysis",
      label: analysisLabel,
      done: analysisStepDone,
      actionable: analysisActionable,
      cta: analysisCta,
    },
  ];
}

function CheckIcon({ done }: { done: boolean }) {
  return done ? (
    <span
      aria-hidden
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent-ink)] text-white text-[11px] font-bold"
    >
      ✓
    </span>
  ) : (
    <span
      aria-hidden
      className="mt-0.5 flex h-5 w-5 shrink-0 rounded-full border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)]"
    />
  );
}

export type SetupChecklistProps = {
  /** Optional goal id to scope job/analysis counts to. */
  goalId?: string;
  /** Optional title override — default "Get set up". */
  title?: string;
  /** Optional subtitle override — sits under the header. */
  subtitle?: string;
  /**
   * When the checklist is fully complete: by default, renders nothing.
   * Pass `null` explicitly to opt out of hiding (Overview may want to
   * suppress it entirely once complete, which is the default).
   */
  hideWhenComplete?: boolean;
};

export default function SetupChecklist({
  goalId,
  title = "Get set up for this goal",
  subtitle,
  hideWhenComplete = true,
}: SetupChecklistProps) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = goalId
      ? `?goal_id=${encodeURIComponent(goalId)}`
      : "";
    fetch(`/api/setup/status${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setStatus(d.data as SetupStatus);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [goalId]);

  if (!loaded || !status) return null;

  const steps = buildSteps(status);
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = doneCount === total;

  if (allDone && hideWhenComplete) return null;

  return (
    <Card padding="lg">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-muted)]">
              {title}
            </div>
            {subtitle && (
              <p className="text-[13px] text-[color:var(--color-text-secondary)]">
                {subtitle}
              </p>
            )}
          </div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)] whitespace-nowrap">
            {doneCount} of {total} done
          </div>
        </div>

        <ol className="divide-y divide-[color:var(--color-border-subtle)] rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)]">
          {steps.map((step, i) => (
            <li
              key={step.key}
              className="flex items-start gap-3 px-4 py-3"
            >
              <CheckIcon done={step.done} />
              <div className="min-w-0 flex-1">
                <div
                  className={
                    "text-[14px] font-semibold " +
                    (step.done
                      ? "text-[color:var(--color-text-muted)] line-through"
                      : step.actionable
                      ? "text-[color:var(--color-text-primary)]"
                      : "text-[color:var(--color-text-muted)]")
                  }
                >
                  {i + 1}. {step.label}
                </div>
              </div>
              {step.cta && step.actionable && (
                <Link
                  href={step.cta.href}
                  className="shrink-0 inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
                >
                  {step.cta.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
