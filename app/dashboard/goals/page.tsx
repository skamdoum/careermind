"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import PageHeader from "@/app/components/ui/PageHeader";
import Card from "@/app/components/ui/Card";
import Badge from "@/app/components/ui/Badge";

type CareerGoal = {
  id: string;
  title: string;
  target_level: string | null;
  target_function: string | null;
  status: string;
  created_at: string;
};

function GoalsListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const refreshKey = searchParams.get("r") ?? "";

  const [goals, setGoals] = useState<CareerGoal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setGoals(null);
    setError(null);

    async function load() {
      try {
        const res = await fetch("/api/goals", { cache: "no-store" });

        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        const json = await res.json();

        if (cancelled) return;

        if (!res.ok || !json?.success) {
          setGoals([]);
          setError(json?.error || "Failed to load career goals");
          return;
        }

        setGoals(json.data as CareerGoal[]);
      } catch (e: unknown) {
        if (cancelled) return;
        setGoals([]);
        setError(e instanceof Error ? e.message : "Failed to load career goals");
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [router, refreshKey]);

  const isLoading = goals === null && !error;
  const isEmpty = goals !== null && goals.length === 0 && !error;

  return (
    <>
      <PageHeader
        title="Career Goals"
        description="The direction you're targeting. Each goal anchors the jobs and analyses you compare against it."
        action={
          goals && goals.length > 0 ? (
            <Link
              href="/dashboard/goals/new"
              className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
            >
              New career goal
            </Link>
          ) : null
        }
      />

      {isLoading && (
        <div className="text-sm text-[color:var(--color-text-muted)]">
          Loading career goals…
        </div>
      )}

      {error && (
        <Card intent="danger" padding="md">
          <div className="text-sm">{error}</div>
        </Card>
      )}

      {isEmpty && (
        <section className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-6 md:p-8 space-y-6">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-muted)]">
              First time here
            </div>
            <h2 className="text-[18px] font-semibold tracking-[-0.005em] text-[color:var(--color-text-primary)]">
              Set up your job search
            </h2>
            <p className="text-[13px] text-[color:var(--color-text-secondary)] max-w-2xl">
              You do the first three. CareerMind turns the analyses into
              recurring patterns, positioning strategy, and a prioritized
              action plan.
            </p>
          </div>

          <ol className="grid gap-3 md:grid-cols-2">
            {[
              {
                n: 1,
                title: "Set your direction",
                desc: "Define the level, function, or career path you're targeting.",
              },
              {
                n: 2,
                title: "Add target roles",
                desc: "Add 2–5 real jobs you'd seriously consider.",
              },
              {
                n: 3,
                title: "Analyze your fit",
                desc: "Upload your resume once and evaluate it against each role.",
              },
              {
                n: 4,
                title: "Work your plan",
                desc: "CareerMind turns recurring strengths and gaps into positioning, strategy, and prioritized actions.",
              },
            ].map((s) => (
              <li
                key={s.n}
                className="flex items-start gap-3 rounded-[6px] bg-[color:var(--color-surface-elevated)] px-4 py-3"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent-ink)] text-white text-[12px] font-semibold">
                  {s.n}
                </span>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[color:var(--color-text-primary)]">
                    {s.title}
                  </div>
                  <p className="text-[13px] leading-[1.5] text-[color:var(--color-text-secondary)] mt-0.5">
                    {s.desc}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div>
            <Link
              href="/dashboard/goals/new"
              className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[14px] font-medium text-white hover:opacity-90"
            >
              Create your first career goal
            </Link>
          </div>
        </section>
      )}

      {goals && goals.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {goals.map((g) => (
            <Link
              key={g.id}
              href={`/dashboard/goals/${g.id}`}
              className="block rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-5 hover:border-[color:var(--color-text-primary)] transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-[15px] font-semibold text-[color:var(--color-text-primary)] min-w-0">
                  {g.title}
                </div>
                <Badge variant={g.status === "active" ? "success" : "neutral"}>
                  {g.status}
                </Badge>
              </div>

              <div className="text-[13px] text-[color:var(--color-text-secondary)] mt-2">
                {[g.target_level, g.target_function].filter(Boolean).join(" · ") ||
                  "No target level or function set"}
              </div>

              <div className="text-[11px] uppercase tracking-[0.03em] text-[color:var(--color-text-muted)] mt-3">
                Created {new Date(g.created_at).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/*
        Secondary discovery link for /analyze. Run Analysis is no longer in
        the primary nav — the V1 flow is Goals → Target Role → Analyze — but
        the standalone route stays reachable here for one-off analyses
        (e.g. regression-test runs).
      */}
      <div className="pt-2 text-[13px] text-[color:var(--color-text-muted)]">
        Need a quick one-off analysis?{" "}
        <Link
          href="/analyze"
          className="text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] underline underline-offset-2"
        >
          Run analysis without a career goal →
        </Link>
      </div>
    </>
  );
}

export default function GoalsListPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-[color:var(--color-text-muted)]">
          Loading career goals…
        </div>
      }
    >
      <GoalsListContent />
    </Suspense>
  );
}
