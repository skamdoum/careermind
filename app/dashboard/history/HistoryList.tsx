"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Badge, { type BadgeVariant } from "@/app/components/ui/Badge";
import EmptyState from "@/app/components/ui/EmptyState";

type HistoryAnalysis = {
  id: string;
  summary: string | null;
  created_at: string;
  verdict: string | null;
};

type Filter = "all" | "Strong Hire" | "Borderline" | "Below Bar";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  "Strong Hire": "Strong Hire",
  Borderline: "Borderline",
  "Below Bar": "Below Bar",
};

function verdictVariant(v: string | null): BadgeVariant {
  if (v === "Strong Hire") return "success";
  if (v === "Borderline") return "caution";
  if (v === "Below Bar") return "danger";
  return "neutral";
}

export default function HistoryList({
  analyses,
  showAll,
  totalAnalyses,
}: {
  analyses: HistoryAnalysis[];
  showAll: boolean;
  totalAnalyses: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: analyses.length,
      "Strong Hire": 0,
      Borderline: 0,
      "Below Bar": 0,
    };
    for (const a of analyses) {
      if (a.verdict === "Strong Hire") c["Strong Hire"]++;
      else if (a.verdict === "Borderline") c["Borderline"]++;
      else if (a.verdict === "Below Bar") c["Below Bar"]++;
    }
    return c;
  }, [analyses]);

  const visible =
    filter === "all"
      ? analyses
      : analyses.filter((a) => a.verdict === filter);

  const filters: Filter[] = ["all", "Strong Hire", "Borderline", "Below Bar"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition " +
                (active
                  ? "bg-[color:var(--color-accent-ink)] text-white border-[color:var(--color-accent-ink)]"
                  : "bg-[color:var(--color-surface)] text-[color:var(--color-text-secondary)] border-[color:var(--color-border-standard)] hover:border-[color:var(--color-text-primary)]")
              }
              aria-pressed={active}
            >
              <span>{FILTER_LABEL[f]}</span>
              <span
                className={
                  "text-[11px] " +
                  (active
                    ? "text-white/70"
                    : "text-[color:var(--color-text-muted)]")
                }
              >
                {counts[f]}
              </span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={
            filter === "all"
              ? "No analyses yet"
              : "No analyses match this filter"
          }
          description={
            filter === "all"
              ? "Every analysis you run lands here. Head to a target role under one of your career goals to run your first."
              : `No ${FILTER_LABEL[filter]} verdicts yet.`
          }
        />
      ) : (
        <div className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] divide-y divide-[color:var(--color-border-subtle)] overflow-hidden">
          {visible.map((a) => (
            <Link
              key={a.id}
              href={`/dashboard/${a.id}`}
              className="block px-4 py-3 hover:bg-[color:var(--color-surface-elevated)] transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] uppercase tracking-[0.03em] text-[color:var(--color-text-muted)] whitespace-nowrap">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                    {a.verdict && (
                      <Badge variant={verdictVariant(a.verdict)}>
                        {a.verdict}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[14px] text-[color:var(--color-text-primary)] line-clamp-2">
                    {a.summary || "No summary"}
                  </div>
                </div>
                <span
                  className="text-[color:var(--color-text-muted)] mt-1"
                  aria-hidden
                >
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!showAll && totalAnalyses > 5 && filter === "all" && (
        <div className="text-center">
          <Link
            href="?all=1"
            className="inline-block rounded-[6px] border border-[color:var(--color-border-standard)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
          >
            Show all analyses ({totalAnalyses})
          </Link>
        </div>
      )}
    </div>
  );
}
