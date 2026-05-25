"use client";

import { useEffect, useState } from "react";

type Fallback = {
  positioning: string;
  whereToFocus: string[];
  whereToAvoid: string[];
  tradeoffs: string[];
  narrative: string;
  risks: string[];
};

type AiNarrative = {
  target_positioning: string;
  strategic_direction: string;
  where_to_focus: string[];
  where_to_avoid: string[];
  positioning_tradeoffs: string[];
  narrative_to_tell: string;
  risks: string[];
};

export default function StrategyNarrativeClient({ fallback }: { fallback: Fallback }) {
  const [ai, setAi] = useState<AiNarrative | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [narrativeResolved, setNarrativeResolved] = useState(false);

  useEffect(() => {
    const skeletonTimer = setTimeout(() => setShowSkeleton(true), 300);

    fetch("/api/strategy/narrative")
      .then((r) => r.json())
      .then((d) => { if (d.success && d.data) setAi(d.data); })
      .catch(() => {})
      .finally(() => {
        clearTimeout(skeletonTimer);
        setShowSkeleton(false);
        setNarrativeResolved(true);
      });

    return () => clearTimeout(skeletonTimer);
  }, []);

  const positioning  = ai?.target_positioning          || fallback.positioning;
  const direction    = ai?.strategic_direction         || null;
  const whereToFocus = ai?.where_to_focus?.length      ? ai.where_to_focus          : fallback.whereToFocus;
  const whereToAvoid = ai?.where_to_avoid?.length      ? ai.where_to_avoid          : fallback.whereToAvoid;
  const tradeoffs    = ai?.positioning_tradeoffs?.length ? ai.positioning_tradeoffs : fallback.tradeoffs;
  const narrative    = ai?.narrative_to_tell           || fallback.narrative;
  const risks        = ai?.risks?.length               ? ai.risks                   : fallback.risks;

  return (
    <>
      <h1 className="text-2xl font-bold">Strategy</h1>

      <section className="border rounded p-5 bg-white shadow-sm">
        <h2 className="font-semibold text-lg mb-3">Target Positioning</h2>
        {showSkeleton ? (
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
            <div className="h-4 bg-gray-200 rounded animate-pulse w-5/6" />
          </div>
        ) : !narrativeResolved ? (
          <div className="min-h-[3rem]" />
        ) : (
          <>
            <p className="text-gray-800 leading-7">{positioning}</p>
            {direction && <p className="text-gray-700 leading-7 mt-3">{direction}</p>}
          </>
        )}
      </section>

      <section className="border rounded p-5 bg-white shadow-sm">
        <h2 className="font-semibold text-lg mb-3">Role Targeting Guidance</h2>
        {showSkeleton ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="h-3 bg-gray-200 rounded animate-pulse w-1/4" />
              <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
              <div className="h-4 bg-gray-200 rounded animate-pulse w-5/6" />
              <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
            </div>
            <div className="space-y-2">
              <div className="h-3 bg-gray-200 rounded animate-pulse w-1/4" />
              <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
              <div className="h-4 bg-gray-200 rounded animate-pulse w-5/6" />
              <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
            </div>
          </div>
        ) : !narrativeResolved ? (
          <div className="min-h-[8rem]" />
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-sm text-gray-700 mb-2">Where to focus</h3>
              <ul className="text-sm space-y-1 list-disc list-inside">
                {whereToFocus.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-sm text-gray-700 mb-2">Where to avoid</h3>
              <ul className="text-sm space-y-1 list-disc list-inside">
                {whereToAvoid.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          </div>
        )}
      </section>

      <section className="border rounded p-5 bg-white shadow-sm">
        <h2 className="font-semibold text-lg mb-3">Positioning Tradeoffs</h2>
        {showSkeleton ? (
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
            <div className="h-4 bg-gray-200 rounded animate-pulse w-5/6" />
            <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
          </div>
        ) : !narrativeResolved ? (
          <div className="min-h-[4rem]" />
        ) : (
          <ul className="text-sm space-y-1 list-disc list-inside">
            {tradeoffs.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}
      </section>

      <section className="border rounded p-5 bg-blue-50 shadow-sm">
        <h2 className="font-semibold text-lg mb-3">Narrative to Tell</h2>
        {showSkeleton ? (
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
            <div className="h-4 bg-gray-200 rounded animate-pulse w-5/6" />
            <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
          </div>
        ) : !narrativeResolved ? (
          <div className="min-h-[4rem]" />
        ) : (
          <p className="text-gray-800 leading-7 italic">{narrative}</p>
        )}
      </section>

      <section className="border rounded p-5 bg-white shadow-sm">
        <h2 className="font-semibold text-lg mb-3">Risks</h2>
        {showSkeleton ? (
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
            <div className="h-4 bg-gray-200 rounded animate-pulse w-5/6" />
          </div>
        ) : !narrativeResolved ? (
          <div className="min-h-[3rem]" />
        ) : (
          <ul className="text-sm space-y-1 list-disc list-inside">
            {risks.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}
      </section>
    </>
  );
}
