"use client";

import { useEffect, useState } from "react";

type TaskStatus = "new" | "in_progress" | "done";
const STATUS_LABELS: Record<TaskStatus, string> = {
  new: "New",
  in_progress: "In progress",
  done: "Done",
};
const STATUS_ORDER: TaskStatus[] = ["new", "in_progress", "done"];

const PRIORITY_BADGE_CLASS: Record<string, string> = {
  P1: "bg-red-100 text-red-800",
  P2: "bg-yellow-100 text-yellow-800",
  P3: "bg-gray-100 text-gray-700",
};
const IMPACT_BADGE_CLASS: Record<string, string> = {
  High: "bg-green-100 text-green-800",
  Medium: "bg-yellow-100 text-yellow-800",
  Low: "bg-gray-100 text-gray-700",
};
const EFFORT_BADGE_CLASS: Record<string, string> = {
  Low: "bg-green-100 text-green-800",
  Medium: "bg-yellow-100 text-yellow-800",
  High: "bg-red-100 text-red-800",
};

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

type InsightsMode = "overview" | "strategy" | "all";

export default function Insights({
  className = "",
  mode = "all",
}: {
  className?: string;
  mode?: InsightsMode;
}) {
  const [insights, setInsights] = useState<any>(null);
  const [strategy, setStrategy] = useState<any>(null);
  const [progress, setProgress] = useState<any>(null);
  const [narrative, setNarrative] = useState<any>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(true);
  const [taskStatuses, setTaskStatuses] = useState<Record<string, TaskStatus>>({});

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

  function renderProgressTrend() {
    if (!progress?.current_verdict || !progress?.previous_verdict) return null;

    const { current_verdict, previous_verdict } = progress;
    const VERDICT_SCORE: Record<string, number> = {
      "Below Bar": 1,
      "Borderline": 2,
      "Strong Hire": 3,
    };
    const cur = VERDICT_SCORE[current_verdict] ?? 0;
    const prev = VERDICT_SCORE[previous_verdict] ?? 0;

    let interpretation = "Stable";
    let toneClass = "bg-gray-50";
    if (cur > prev) {
      interpretation = "You're improving";
      toneClass = "bg-green-50";
    } else if (cur < prev) {
      interpretation = "Mixed results (job difficulty may vary)";
      toneClass = "bg-yellow-50";
    }

    return (
      <section className={`border rounded p-5 shadow-sm mb-6 ${toneClass}`}>
        <h2 className="font-semibold text-lg mb-3">Recent Trend</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-600">Previous:</div>
            <div className="font-medium">{previous_verdict}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-600">Current:</div>
            <div className="font-medium">{current_verdict}</div>
          </div>
          <div className="font-semibold pt-2">{interpretation}</div>
          <div className="text-xs text-gray-700 pt-1">
            To improve your results, focus on reducing your top recurring gap.
          </div>
          <div className="text-xs text-gray-500 pt-1">
            Verdicts can vary based on job difficulty and fit, not just your progress.
          </div>
        </div>
      </section>
    );
  }

  function renderStrategyProgress() {
    let total = 0;
    const counts: Record<TaskStatus, number> = { new: 0, in_progress: 0, done: 0 };
    strategy?.actions?.forEach((a: any, i: number) => {
      a.tasks?.forEach((_: string, j: number) => {
        total++;
        const status = taskStatuses[`${i}:${j}`] || "new";
        counts[status]++;
      });
    });
    const percent = total > 0 ? Math.round((counts.done / total) * 100) : 0;
    return (
      <div className="border rounded p-4 bg-gray-50 mb-4 space-y-2">
        <h3 className="font-semibold">Progress</h3>
        <div className="text-sm text-gray-700">
          Total: {total} | New: {counts.new} | In progress: {counts.in_progress} | Done: {counts.done}
        </div>
        <div className="w-full bg-gray-200 rounded h-3 overflow-hidden">
          <div className="bg-black h-3" style={{ width: `${percent}%` }} />
        </div>
        <div className="text-sm font-medium">{percent}% complete</div>
      </div>
    );
  }

  useEffect(() => {
    async function load() {
      const [insightsRes, strategyRes, progressRes] = await Promise.all([
        fetch("/api/insights"),
        fetch("/api/strategy"),
        fetch("/api/progress"),
      ]);
      const insightsData = await insightsRes.json();
      const strategyData = await strategyRes.json();
      const progressData = await progressRes.json();
      setInsights(insightsData.success ? insightsData.data : null);
      setStrategy(strategyData.success ? strategyData.data : null);
      setProgress(progressData.success ? progressData.data : null);
    }

    load();

    fetch("/api/insights/narrative")
      .then((r) => r.json())
      .then((d) => { if (d.success) setNarrative(d.data); })
      .catch(() => {})
      .finally(() => setNarrativeLoading(false));
  }, []);

  function getCoachingMessage(insights: any) {
    if (!insights?.top_gap) return "";
    const why = lookupGapWhy(insights.top_gap.name);
    const closing = insights.top_signal
      ? "Your strongest signal area is real leverage — lead with it in your next interview narrative."
      : "";
    return `${why}\n\n${closing}`.trim();
  }

  if (!insights && mode !== "strategy") {
    return (
      <section className={`border rounded p-5 bg-white shadow-sm mb-6 ${className}`}>
        <h2 className="font-semibold text-lg mb-3">Career Pattern</h2>
        <div className="text-sm text-gray-500">Loading insights...</div>
      </section>
    );
  }

  const showOverview = mode === "all" || mode === "overview";
  const showStrategy = mode === "all" || mode === "strategy";

  return (
    <>
    {showOverview && insights?.top_signal && insights?.top_gap && (
      <section className="border rounded p-5 bg-white shadow-sm mb-6">
        <h2 className="font-semibold text-lg mb-3">Career Summary</h2>
        {narrativeLoading ? (
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
            <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
          </div>
        ) : (
          <p className="text-gray-800 leading-7">
            {narrative?.career_summary ||
              `You are currently positioned as ${withArticle(lookupArchetype(insights.top_signal.name))}, but you are not yet demonstrating ${lookupMissing(insights.top_gap.name)}.`}
          </p>
        )}
      </section>
    )}

    {showOverview && insights && (
    <section className="border rounded p-5 bg-white shadow-sm mb-6">
      <h2 className="font-semibold text-lg mb-4">Career Pattern</h2>

      <div className="space-y-6">
        <div className="p-4 border rounded bg-blue-50">
          <div className="font-semibold mb-2">🧠 Coaching Insight</div>
          {narrativeLoading ? (
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
              <div className="h-4 bg-gray-200 rounded animate-pulse w-5/6" />
              <div className="h-4 bg-gray-200 rounded animate-pulse w-2/3" />
            </div>
          ) : (
            <div className="text-sm whitespace-pre-line">
              {narrative?.coaching_insight || getCoachingMessage(insights)}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {insights.top_gap && (
            <div className="p-3 border rounded bg-red-50">
              <div className="text-xs text-gray-500 mb-1">Top recurring gap</div>
              <div className="font-medium">{insights.top_gap.name}</div>
              <div className="text-sm text-gray-600">
                Appeared in {insights.top_gap.count} analyses
              </div>
            </div>
          )}

          {insights.top_gaps?.length > 1 && (
            <div className="p-3 border rounded bg-white">
              <div className="text-xs text-gray-500 mb-2">Other recurring gaps</div>
              <ul className="text-sm space-y-1">
                {insights.top_gaps.slice(1).map((g: any, i: number) => (
                  <li key={i} className="flex justify-between">
                    <span>{g.name}</span>
                    <span className="text-gray-500">{g.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {insights.top_signal && (
            <div className="p-3 border rounded bg-green-50">
              <div className="text-xs text-gray-500 mb-1">Strongest recurring signal</div>
              <div className="font-medium">{insights.top_signal.name}</div>
              <div className="text-sm text-gray-600">
                Appeared in {insights.top_signal.count} analyses
              </div>
            </div>
          )}

          {insights.top_signals?.length > 1 && (
            <div className="p-3 border rounded bg-white">
              <div className="text-xs text-gray-500 mb-2">Other recurring signals</div>
              <ul className="text-sm space-y-1">
                {insights.top_signals.slice(1).map((s: any, i: number) => (
                  <li key={i} className="flex justify-between">
                    <span>{s.name}</span>
                    <span className="text-gray-500">{s.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(() => {
            const items = dedupeStrings(insights.recommended_focus).slice(0, 2);
            const ruleSentence =
              items.length === 0
                ? null
                : items.length === 1
                  ? `Prioritize ${items[0]}.`
                  : `Prioritize ${items[0]} first, then ${items[1]}.`;
            if (narrativeLoading) {
              return (
                <div className="p-4 border rounded bg-purple-50">
                  <div className="text-xs text-gray-500 mb-2">Recommended focus</div>
                  <div className="h-4 bg-gray-200 rounded animate-pulse w-2/3" />
                </div>
              );
            }
            const sentence = narrative?.recommended_focus || ruleSentence;
            if (!sentence) return null;
            return (
              <div className="p-4 border rounded bg-purple-50">
                <div className="text-xs text-gray-500 mb-2">Recommended focus</div>
                <p className="text-sm">{sentence}</p>
              </div>
            );
          })()}

          <div className="text-gray-500 text-sm">
            Based on {insights.total_analyses} total analyses
          </div>
        </div>
      </div>
    </section>
    )}

    {showOverview && renderProgressTrend()}

    {showStrategy && strategy?.actions?.length > 0 && (
      <section className="border rounded p-5 bg-white shadow-sm mb-6">
        <h2 className="font-semibold text-lg mb-1">Your Action Plan</h2>
        <p className="text-sm text-gray-600 mb-4">
          This is your prioritized execution plan across target roles. Start with P1 tasks and update each status as you make progress.
        </p>
        {renderStrategyProgress()}
        <div className="space-y-4">
          {strategy.actions.map((action: any, i: number) => (
            <div key={i} className="border rounded p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-black text-white text-sm font-semibold flex items-center justify-center">
                    {i + 1}
                  </div>
                  <h3 className="font-semibold">{action.title}</h3>
                </div>
                {action.impact && (
                  <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-800 font-medium capitalize">
                    {action.impact} impact
                  </span>
                )}
              </div>
              <ul className="text-sm space-y-2">
                {action.tasks.map((task: any, j: number) => {
                  const key = `${i}:${j}`;
                  const status = taskStatuses[key] || "new";
                  return (
                    <li key={j} className="space-y-2 border rounded p-3 bg-white">
                      <div className="flex items-start justify-between gap-2">
                        <span className={status === "done" ? "line-through text-gray-500" : ""}>
                          {task.text}
                        </span>
                        <span
                          className={`text-xs px-2 py-1 rounded font-medium whitespace-nowrap ${
                            status === "done"
                              ? "bg-green-100 text-green-800"
                              : status === "in_progress"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {task.priority && (
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${PRIORITY_BADGE_CLASS[task.priority] || "bg-gray-100 text-gray-700"}`}>
                            {task.priority}
                          </span>
                        )}
                        {task.impact && (
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${IMPACT_BADGE_CLASS[task.impact] || "bg-gray-100 text-gray-700"}`}>
                            {task.impact} impact
                          </span>
                        )}
                        {task.effort && (
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${EFFORT_BADGE_CLASS[task.effort] || "bg-gray-100 text-gray-700"}`}>
                            {task.effort} effort
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {STATUS_ORDER.map((s) => (
                          <button
                            key={s}
                            onClick={() =>
                              setTaskStatuses((prev) => ({ ...prev, [key]: s }))
                            }
                            className={`text-xs px-2 py-1 rounded border ${
                              status === s
                                ? "bg-black text-white border-black"
                                : "bg-white text-gray-700 border-gray-300"
                            }`}
                          >
                            {STATUS_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    )}
    </>
  );
}