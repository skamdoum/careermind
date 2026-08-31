"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useEffect, useState } from "react";
import PageHeader from "@/app/components/ui/PageHeader";
import SectionHeader from "@/app/components/ui/SectionHeader";
import MetaStrip from "@/app/components/ui/MetaStrip";
import Card from "@/app/components/ui/Card";
import Badge from "@/app/components/ui/Badge";
import EmptyState from "@/app/components/ui/EmptyState";

type CareerGoal = {
  id: string;
  title: string;
  target_level: string | null;
  target_function: string | null;
  description: string | null;
  status: string;
  primary_resume_id: string | null;
  created_at: string;
  updated_at: string;
};

type TargetJob = {
  id: string;
  career_goal_id: string | null;
  company_name: string | null;
  role_title: string | null;
  source_url: string | null;
  jd_text: string;
  status: string;
  created_at: string;
};

type RecurringItem = {
  label: string;
  count: number;
  percentage: number;
  sample_rationale: string | null;
};

type GoalInsights = {
  analyzed_role_count: number;
  recurring_signals: RecurringItem[];
  recurring_gaps: RecurringItem[];
  recommended_focus: string[];
};

type PageProps = {
  params: Promise<{ id: string }>;
};

function jdPreview(text: string, max = 180): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max).trimEnd() + "…";
}

export default function GoalDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const refreshKey = searchParams.get("r") ?? "";

  const [goal, setGoal] = useState<CareerGoal | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "not_found" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<TargetJob[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const [insights, setInsights] = useState<GoalInsights | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setGoal(null);
    setStatus("loading");
    setError(null);
    setJobs(null);
    setJobsError(null);
    setInsights(null);
    setInsightsError(null);

    async function loadGoal() {
      try {
        const res = await fetch(`/api/goals/${id}`, { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.status === 404) {
          if (!cancelled) {
            setGoal(null);
            setStatus("not_found");
          }
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setGoal(null);
          setError(json?.error || "Failed to load career goal");
          setStatus("error");
          return;
        }
        setGoal(json.data as CareerGoal);
        setStatus("ok");
      } catch (e: unknown) {
        if (cancelled) return;
        setGoal(null);
        setError(e instanceof Error ? e.message : "Failed to load career goal");
        setStatus("error");
      }
    }

    async function loadJobs() {
      try {
        const res = await fetch(`/api/goals/${id}/jobs`, { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.status === 404) {
          if (!cancelled) setJobs([]);
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setJobs([]);
          setJobsError(json?.error || "Failed to load target roles");
          return;
        }
        setJobs(json.data as TargetJob[]);
      } catch (e: unknown) {
        if (cancelled) return;
        setJobs([]);
        setJobsError(
          e instanceof Error ? e.message : "Failed to load target roles"
        );
      }
    }

    async function loadInsights() {
      try {
        const res = await fetch(`/api/goals/${id}/insights`, {
          cache: "no-store",
        });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.status === 404) {
          if (!cancelled) setInsights(null);
          return;
        }
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setInsightsError(json?.error || "Failed to load insights");
          return;
        }
        setInsights(json.data as GoalInsights);
      } catch (e: unknown) {
        if (cancelled) return;
        setInsightsError(
          e instanceof Error ? e.message : "Failed to load insights"
        );
      }
    }

    loadGoal();
    loadJobs();
    loadInsights();

    return () => {
      cancelled = true;
    };
  }, [id, router, refreshKey]);

  const jobsLoading = jobs === null && !jobsError;
  const jobsEmpty = jobs !== null && jobs.length === 0 && !jobsError;

  async function handleDelete() {
    if (deleting) return;
    const confirmed = window.confirm(
      "Delete this career goal?\n\nThe career goal and its target roles will be deleted. Historical analyses will be preserved."
    );
    if (!confirmed) return;

    setDeleteError(null);
    setDeleting(true);

    try {
      const res = await fetch(`/api/goals/${id}`, { method: "DELETE" });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setDeleteError(json?.error || "Failed to delete career goal.");
        setDeleting(false);
        return;
      }
      router.push(`/dashboard/goals?r=${Date.now()}`);
    } catch (e: unknown) {
      setDeleteError(
        e instanceof Error ? e.message : "Failed to delete career goal."
      );
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="text-[13px]">
        <Link
          href="/dashboard/goals"
          className="text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
        >
          ← Back to Career Goals
        </Link>
      </div>

      {status === "loading" && (
        <div className="text-[13px] text-[color:var(--color-text-muted)]">
          Loading career goal…
        </div>
      )}

      {status === "not_found" && (
        <EmptyState
          title="Career goal not found"
          description="It may have been deleted, or the link is incorrect."
          action={
            <Link
              href="/dashboard/goals"
              className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
            >
              Back to Career Goals
            </Link>
          }
        />
      )}

      {status === "error" && (
        <Card intent="danger" padding="md">
          <div className="text-[14px]">{error}</div>
        </Card>
      )}

      {status === "ok" && goal && (
        <>
          <PageHeader
            title={goal.title}
            description={
              goal.description ? goal.description : undefined
            }
            action={
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/goals/${id}/edit`}
                  className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-[13px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger-text)] disabled:opacity-60 disabled:cursor-not-allowed underline underline-offset-2"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            }
          />

          <MetaStrip
            items={[
              { label: "Target level", value: goal.target_level || "Not set" },
              {
                label: "Target function",
                value: goal.target_function || "Not set",
              },
              {
                label: "Status",
                value: (
                  <Badge
                    variant={goal.status === "active" ? "success" : "neutral"}
                  >
                    {goal.status}
                  </Badge>
                ),
              },
              {
                label: "Created",
                value: new Date(goal.created_at).toLocaleDateString(),
              },
            ]}
          />

          {deleteError && (
            <Card intent="danger" padding="md">
              <div className="text-[13px]">{deleteError}</div>
            </Card>
          )}

          <section className="space-y-4">
            <SectionHeader
              title="Target roles"
              description={
                jobs && jobs.length > 0
                  ? "Roles you're targeting under this goal."
                  : undefined
              }
              meta={
                jobs && jobs.length > 0
                  ? `${jobs.length} role${jobs.length === 1 ? "" : "s"}`
                  : undefined
              }
              action={
                jobs && jobs.length > 0 ? (
                  <Link
                    href={`/dashboard/goals/${id}/jobs/new`}
                    className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
                  >
                    Add target role
                  </Link>
                ) : null
              }
            />

            {jobsLoading && (
              <div className="text-[13px] text-[color:var(--color-text-muted)]">
                Loading target roles…
              </div>
            )}

            {jobsError && (
              <Card intent="danger" padding="md">
                <div className="text-[13px]">{jobsError}</div>
              </Card>
            )}

            {jobsEmpty && (
              <EmptyState
                title="No target roles yet"
                description="Add 2–5 roles to identify patterns across your target market."
                action={
                  <Link
                    href={`/dashboard/goals/${id}/jobs/new`}
                    className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
                  >
                    Add target role
                  </Link>
                }
              />
            )}

            {jobs && jobs.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {jobs.map((j) => {
                  const heading =
                    [j.role_title, j.company_name].filter(Boolean).join(" · ") ||
                    "Untitled role";
                  return (
                    <Link
                      key={j.id}
                      href={`/dashboard/goals/${id}/jobs/${j.id}`}
                      className="block rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-4 hover:border-[color:var(--color-text-primary)] transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-[15px] font-semibold text-[color:var(--color-text-primary)] min-w-0">
                          {heading}
                        </div>
                        <Badge
                          variant={j.status === "target" ? "info" : "neutral"}
                        >
                          {j.status}
                        </Badge>
                      </div>
                      <div className="text-[13px] leading-[1.6] text-[color:var(--color-text-secondary)] mt-2">
                        {jdPreview(j.jd_text)}
                      </div>
                      <div className="text-[11px] uppercase tracking-[0.03em] text-[color:var(--color-text-muted)] mt-3">
                        Added {new Date(j.created_at).toLocaleDateString()}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <SectionHeader
              title="Cross-job insights"
              description="Patterns across your analyzed target roles under this goal."
            />

            {insights === null && !insightsError && (
              <div className="text-[13px] text-[color:var(--color-text-muted)]">
                Loading insights…
              </div>
            )}

            {insightsError && (
              <Card intent="danger" padding="md">
                <div className="text-[13px]">{insightsError}</div>
              </Card>
            )}

            {insights && insights.analyzed_role_count < 2 && (
              <EmptyState
                title="Not enough analyzed roles yet"
                description={`Analyze at least 2 target roles to identify patterns across your market.${
                  insights.analyzed_role_count === 1
                    ? " You've analyzed 1 so far."
                    : ""
                }`}
              />
            )}

            {insights && insights.analyzed_role_count >= 2 && (
              <div className="space-y-6">
                <div className="text-[11px] uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
                  Based on the latest analysis for each of your{" "}
                  {insights.analyzed_role_count} analyzed target roles.
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
                      Recurring strengths
                    </div>
                    {insights.recurring_signals.length > 0 ? (
                      <ul className="divide-y divide-[color:var(--color-border-subtle)] rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] overflow-hidden">
                        {insights.recurring_signals.map((item) => (
                          <li
                            key={`signal-${item.label}`}
                            className="px-4 py-3 space-y-1"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-[14px] font-semibold text-[color:var(--color-text-primary)]">
                                {item.label}
                              </div>
                              <div className="text-[11px] uppercase tracking-[0.03em] text-[color:var(--color-text-muted)] whitespace-nowrap">
                                {item.count}/{insights.analyzed_role_count} ·{" "}
                                {item.percentage}%
                              </div>
                            </div>
                            {item.sample_rationale && (
                              <div className="text-[12px] leading-[1.5] text-[color:var(--color-text-secondary)]">
                                {item.sample_rationale}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-[13px] text-[color:var(--color-text-muted)]">
                        No recurring strengths yet across your{" "}
                        {insights.analyzed_role_count} analyzed roles.
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
                      Recurring gaps
                    </div>
                    {insights.recurring_gaps.length > 0 ? (
                      <ul className="divide-y divide-[color:var(--color-border-subtle)] rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] overflow-hidden">
                        {insights.recurring_gaps.map((item) => (
                          <li
                            key={`gap-${item.label}`}
                            className="px-4 py-3 space-y-1"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-[14px] font-semibold text-[color:var(--color-text-primary)]">
                                {item.label}
                              </div>
                              <div className="text-[11px] uppercase tracking-[0.03em] text-[color:var(--color-text-muted)] whitespace-nowrap">
                                {item.count}/{insights.analyzed_role_count} ·{" "}
                                {item.percentage}%
                              </div>
                            </div>
                            {item.sample_rationale && (
                              <div className="text-[12px] leading-[1.5] text-[color:var(--color-text-secondary)]">
                                {item.sample_rationale}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-[13px] text-[color:var(--color-text-muted)]">
                        No gap currently appears across multiple target roles.
                      </div>
                    )}
                  </div>
                </div>

                <Card intent="info" padding="lg">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80 mb-2">
                    Recommended focus
                  </div>
                  {insights.recommended_focus.length > 0 ? (
                    <ul className="space-y-1 text-[15px] leading-[1.6] text-[color:var(--color-text-primary)]">
                      {insights.recommended_focus.map((line, i) => (
                        <li key={`focus-${i}`}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-[14px] text-[color:var(--color-text-primary)]">
                      Recommended focus appears once at least one gap recurs
                      across roles.
                    </div>
                  )}
                </Card>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
