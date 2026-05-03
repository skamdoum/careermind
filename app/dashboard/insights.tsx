"use client";

import { useEffect, useState } from "react";

export default function Insights({ className = "" }: { className?: string }) {
  const [insights, setInsights] = useState<any>(null);
  const [strategy, setStrategy] = useState<any>(null);
  const [progress, setProgress] = useState<any>(null);
  const [checkedTasks, setCheckedTasks] = useState<Record<string, boolean>>({});

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
          <div className="text-xs text-gray-500 pt-1">
            Verdicts can vary based on job difficulty and fit, not just your progress.
          </div>
        </div>
      </section>
    );
  }

  function renderStrategyProgress() {
    let total = 0;
    let completed = 0;
    strategy?.actions?.forEach((a: any, i: number) => {
      a.tasks?.forEach((_: string, j: number) => {
        total++;
        if (checkedTasks[`${i}:${j}`]) completed++;
      });
    });
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return (
      <div className="border rounded p-4 bg-gray-50 mb-4 space-y-2">
        <h3 className="font-semibold">Progress</h3>
        <div className="text-sm text-gray-700">
          {completed} / {total} tasks complete
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
  }, []);

  function getCoachingMessage(insights: any) {
    if (!insights) return "";

    let message = "";

    if (insights.top_gap) {
      message += `Across your analyses, your most consistent gap is "${insights.top_gap.name}". `;
      message += `This is likely the primary blocker for stronger roles.\n\n`;
    }

    if (insights.top_signal) {
      message += `Your strongest repeated signal is "${insights.top_signal.name}", which is a clear strength you should lean into.\n\n`;
    }

    message +=
      "Focus your effort on addressing your top gap while continuing to emphasize your strongest signal in your positioning.";

    return message;
  }

  if (!insights) {
    return (
      <section className={`border rounded p-5 bg-white shadow-sm mb-6 ${className}`}>
        <h2 className="font-semibold text-lg mb-3">Career Pattern</h2>
        <div className="text-sm text-gray-500">Loading insights...</div>
      </section>
    );
  }

  return (
    <>
    <section className="border rounded p-5 bg-white shadow-sm mb-6">
      <h2 className="font-semibold text-lg mb-4">Career Pattern</h2>

      <div className="space-y-6">
        <div className="p-4 border rounded bg-blue-50">
          <div className="font-semibold mb-2">🧠 Coaching Insight</div>
          <div className="text-sm whitespace-pre-line">
            {getCoachingMessage(insights)}
          </div>
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

          {dedupeStrings(insights.recommended_focus).length > 0 && (
            <div className="p-4 border rounded bg-purple-50">
              <div className="text-xs text-gray-500 mb-2">Recommended focus</div>
              <ul className="text-sm space-y-1 list-disc list-inside">
                {dedupeStrings(insights.recommended_focus).map((focus: string, i: number) => (
                  <li key={i}>{focus}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="text-gray-500 text-sm">
            Based on {insights.total_analyses} total analyses
          </div>
        </div>
      </div>
    </section>

    {renderProgressTrend()}

    {strategy?.actions?.length > 0 && (
      <section className="border rounded p-5 bg-white shadow-sm mb-6">
        <h2 className="font-semibold text-lg mb-1">Your Career Strategy</h2>
        <p className="text-sm text-gray-700 mb-1">
          This is your core improvement plan across roles. Focus here first.
        </p>
        <p className="text-sm text-gray-600 mb-4">
          Your top focus areas with concrete next steps. Check off tasks as you complete them.
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
                {action.tasks.map((task: string, j: number) => {
                  const key = `${i}:${j}`;
                  const checked = !!checkedTasks[key];
                  return (
                    <li key={j} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setCheckedTasks((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                        className="mt-1"
                      />
                      <span className={checked ? "line-through text-gray-500" : ""}>
                        {task}
                      </span>
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