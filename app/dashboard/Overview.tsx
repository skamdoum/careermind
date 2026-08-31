"use client";

import { useEffect, useState } from "react";
import Card from "@/app/components/ui/Card";
import SectionHeader from "@/app/components/ui/SectionHeader";

/**
 * Career Pattern / Overview surface.
 *
 * Split out of the old dual-mode insights.tsx so that Overview and
 * Action Plan can evolve independently. Consumes /api/insights (fast)
 * and /api/insights/narrative (slower, AI-generated). The
 * /api/progress fetch that used to power the Recent Trend banner is
 * gone — trend moved to the History page as of P0.
 */

const SIGNAL_ARCHETYPES: { keywords: string[]; archetype: string }[] = [
  { keywords: ["execution", "delivery", "ship"], archetype: "execution-focused PM" },
  { keywords: ["strategy", "vision", "roadmap"], archetype: "strategy-oriented PM" },
  { keywords: ["data", "analytics", "metrics"], archetype: "data-driven PM" },
  { keywords: ["growth", "experiment"], archetype: "growth-focused PM" },
  { keywords: ["discovery", "research", "customer", "user"], archetype: "discovery-led PM" },
  { keywords: ["leadership", "people", "team", "manage"], archetype: "people-oriented PM" },
  { keywords: ["ai", "ml", "machine learning"], archetype: "AI-savvy PM" },
];

const GAP_MISSING: { keywords: string[]; missing: string }[] = [
  { keywords: ["strategy", "vision", "roadmap"], missing: "senior-level strategy ownership" },
  { keywords: ["execution", "delivery", "ship"], missing: "consistent execution at scale" },
  { keywords: ["leadership", "stakeholder", "influence"], missing: "cross-functional leadership" },
  { keywords: ["data", "analytics", "metrics"], missing: "rigorous use of data" },
  { keywords: ["growth", "experiment"], missing: "growth experimentation depth" },
  { keywords: ["discovery", "research", "customer", "user"], missing: "customer discovery rigor" },
  { keywords: ["ai", "ml", "machine learning"], missing: "AI/ML product fluency" },
  { keywords: ["scope", "ambig"], missing: "ownership in ambiguous scope" },
];

const GAP_WHY: { keywords: string[]; why: string }[] = [
  { keywords: ["strategy", "vision", "roadmap"], why: "Senior PM panels look for evidence you can shape direction, not just execute against it. Without that signal, you'll read as a strong IC rather than a future leader." },
  { keywords: ["execution", "delivery", "ship"], why: "Hiring panels need to see consistent shipping at scale; without it, your ability to drive outcomes is the first thing questioned." },
  { keywords: ["leadership", "stakeholder", "influence"], why: "Senior PM roles depend on influencing without authority — one of the most common 'no-hire' signals when it isn't visible in your stories." },
  { keywords: ["data", "analytics", "metrics"], why: "Senior panels want to see you making and defending decisions with data; vague metrics read as a junior framing." },
  { keywords: ["growth", "experiment"], why: "Without experimentation depth, your impact stories can read as anecdotal — a frequent flag in growth-oriented loops." },
  { keywords: ["discovery", "research", "customer", "user"], why: "Without discovery rigor, decisions can read as opinion rather than evidence — a common flag in senior product loops." },
  { keywords: ["ai", "ml", "machine learning"], why: "Most senior PM roles now expect AI/ML fluency at the strategy level; without it, you narrow the set of orgs that will hire you." },
];

function lookupArchetype(name: string): string {
  const lower = name.toLowerCase();
  for (const entry of SIGNAL_ARCHETYPES) {
    if (entry.keywords.some((k) => lower.includes(k))) return entry.archetype;
  }
  return "well-rounded PM";
}

function lookupMissing(name: string): string {
  const lower = name.toLowerCase();
  for (const entry of GAP_MISSING) {
    if (entry.keywords.some((k) => lower.includes(k))) return entry.missing;
  }
  return "depth in your weakest recurring area";
}

function lookupGapWhy(name: string): string {
  const lower = name.toLowerCase();
  for (const entry of GAP_WHY) {
    if (entry.keywords.some((k) => lower.includes(k))) return entry.why;
  }
  return "This kind of gap typically blocks candidates from clearing the senior-PM bar — panels weight depth here heavily during loop debriefs.";
}

function withArticle(s: string): string {
  return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`;
}

function dedupeStrings(items: string[] | undefined): string[] {
  if (!items) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of items) {
    const trimmed = String(raw).trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

type RecurringItem = { name: string; count: number };

type Insights = {
  top_signal?: RecurringItem;
  top_gap?: RecurringItem;
  top_signals?: RecurringItem[];
  top_gaps?: RecurringItem[];
  recommended_focus?: string[];
  total_analyses?: number;
};

type Narrative = {
  career_summary?: string;
  coaching_insight?: string;
  recommended_focus?: string;
};

function CoachingBody({
  narrative,
  insights,
  showSkeleton,
  narrativeResolved,
}: {
  narrative: Narrative | null;
  insights: Insights;
  showSkeleton: boolean;
  narrativeResolved: boolean;
}) {
  if (showSkeleton) {
    return (
      <div className="space-y-2">
        <div className="h-4 bg-[color:var(--color-surface-elevated)] rounded animate-pulse w-full" />
        <div className="h-4 bg-[color:var(--color-surface-elevated)] rounded animate-pulse w-5/6" />
        <div className="h-4 bg-[color:var(--color-surface-elevated)] rounded animate-pulse w-2/3" />
      </div>
    );
  }

  if (!narrativeResolved) {
    return <div className="min-h-[4rem]" />;
  }

  const fallback =
    insights.top_gap
      ? `${lookupGapWhy(insights.top_gap.name)}${
          insights.top_signal
            ? "\n\nYour strongest signal area is real leverage — lead with it in your next interview narrative."
            : ""
        }`
      : "";

  return (
    <div className="text-[15px] leading-[1.6] whitespace-pre-line text-[color:var(--color-text-primary)]">
      {narrative?.coaching_insight || fallback}
    </div>
  );
}

function RecurringList({
  eyebrow,
  top,
  topLabel,
  rest,
}: {
  eyebrow: string;
  top: RecurringItem | undefined;
  topLabel: string;
  rest: RecurringItem[] | undefined;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
        {eyebrow}
      </div>
      {top ? (
        <ul className="divide-y divide-[color:var(--color-border-subtle)] rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)]">
          <li className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-[color:var(--color-text-primary)] truncate">
                {top.name}
              </div>
              <div className="text-[11px] uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
                {topLabel}
              </div>
            </div>
            <span className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
              {top.count}
            </span>
          </li>
          {rest?.slice(1).map((item, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <span className="text-[14px] text-[color:var(--color-text-secondary)] truncate">
                {item.name}
              </span>
              <span className="text-[13px] text-[color:var(--color-text-muted)]">
                {item.count}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-[13px] text-[color:var(--color-text-muted)]">
          None yet.
        </div>
      )}
    </div>
  );
}

export default function Overview() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [narrativeResolved, setNarrativeResolved] = useState(false);

  useEffect(() => {
    fetch("/api/insights")
      .then((r) => r.json())
      .then((d) => {
        setInsights(d?.success ? (d.data as Insights) : null);
      })
      .catch(() => {});

    const skeletonTimer = setTimeout(() => setShowSkeleton(true), 300);

    fetch("/api/insights/narrative")
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) setNarrative(d.data as Narrative);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(skeletonTimer);
        setShowSkeleton(false);
        setNarrativeResolved(true);
      });

    return () => clearTimeout(skeletonTimer);
  }, []);

  if (!insights) {
    return (
      <section className="space-y-3">
        <SectionHeader title="Career pattern" />
        <div className="text-[13px] text-[color:var(--color-text-muted)]">
          Loading insights…
        </div>
      </section>
    );
  }

  const focusItems = dedupeStrings(insights.recommended_focus).slice(0, 2);
  const focusSentence = narrative?.recommended_focus
    ? narrative.recommended_focus
    : focusItems.length === 0
    ? null
    : focusItems.length === 1
    ? `Prioritize ${focusItems[0]}.`
    : `Prioritize ${focusItems[0]} first, then ${focusItems[1]}.`;

  const totalCopy = insights.total_analyses
    ? `Based on ${insights.total_analyses} analyses`
    : undefined;

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      {/* Left column (2/3) — intelligence surfaces */}
      <div className="lg:col-span-2 space-y-8">
        {insights.top_signal && insights.top_gap && (
          <section className="space-y-3">
            <SectionHeader eyebrow="Career summary" title="Where you stand" />
            {showSkeleton ? (
              <div className="space-y-2">
                <div className="h-4 bg-[color:var(--color-surface-elevated)] rounded animate-pulse w-full" />
                <div className="h-4 bg-[color:var(--color-surface-elevated)] rounded animate-pulse w-3/4" />
              </div>
            ) : !narrativeResolved ? (
              <div className="min-h-[3rem]" />
            ) : (
              <p className="text-[15px] leading-[1.7] text-[color:var(--color-text-primary)]">
                {narrative?.career_summary ||
                  `You are currently positioned as ${withArticle(
                    lookupArchetype(insights.top_signal.name)
                  )}, but you are not yet demonstrating ${lookupMissing(
                    insights.top_gap.name
                  )}.`}
              </p>
            )}
          </section>
        )}

        <Card intent="info" padding="lg">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80">
              Coaching insight
            </div>
            <CoachingBody
              narrative={narrative}
              insights={insights}
              showSkeleton={showSkeleton}
              narrativeResolved={narrativeResolved}
            />
          </div>
        </Card>

        {focusSentence && (
          <Card intent="info" padding="lg">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80 mb-2">
              Recommended focus
            </div>
            <p className="text-[16px] font-medium leading-[1.5] text-[color:var(--color-text-primary)]">
              {focusSentence}
            </p>
          </Card>
        )}
      </div>

      {/* Right column (1/3) — patterns + footer */}
      <aside className="space-y-6">
        <SectionHeader title="Career pattern" meta={totalCopy} />
        <RecurringList
          eyebrow="Recurring gaps"
          top={insights.top_gap}
          topLabel="Top recurring gap"
          rest={insights.top_gaps}
        />
        <RecurringList
          eyebrow="Recurring signals"
          top={insights.top_signal}
          topLabel="Strongest recurring signal"
          rest={insights.top_signals}
        />
      </aside>
    </div>
  );
}
