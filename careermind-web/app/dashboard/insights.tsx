"use client";

import { useEffect, useState } from "react";

export default function Insights() {
  const [insights, setInsights] = useState<any>(null);

  useEffect(() => {
    async function loadInsights() {
      const res = await fetch("/api/insights");
      const data = await res.json();
      setInsights(data.insights);
    }

    loadInsights();
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
      <section className="border rounded p-5 bg-white shadow-sm mb-6">
        <h2 className="font-semibold text-lg mb-3">Career Pattern</h2>
        <div className="text-sm text-gray-500">Loading insights...</div>
      </section>
    );
  }

  return (
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

          {insights.top_signal && (
            <div className="p-3 border rounded bg-green-50">
              <div className="text-xs text-gray-500 mb-1">Strongest recurring signal</div>
              <div className="font-medium">{insights.top_signal.name}</div>
              <div className="text-sm text-gray-600">
                Appeared in {insights.top_signal.count} analyses
              </div>
            </div>
          )}

          <div className="text-gray-500 text-sm">
            Based on {insights.total_analyses} total analyses
          </div>
        </div>
      </div>
    </section>
  );
}