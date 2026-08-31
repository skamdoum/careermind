"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/app/components/ui/PageHeader";
import SectionHeader from "@/app/components/ui/SectionHeader";
import Card from "@/app/components/ui/Card";

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

function Skeleton({ lines = 3, widths = ["w-full", "w-5/6", "w-2/3"] }: { lines?: number; widths?: string[] }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`h-4 bg-[color:var(--color-surface-elevated)] rounded animate-pulse ${
            widths[i % widths.length]
          }`}
        />
      ))}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="text-[14px] leading-[1.6] text-[color:var(--color-text-primary)] space-y-2 list-disc pl-5">
      {items.map((b, i) => (
        <li key={i}>{b}</li>
      ))}
    </ul>
  );
}

export default function StrategyNarrativeClient({
  fallback,
}: {
  fallback: Fallback;
}) {
  const [ai, setAi] = useState<AiNarrative | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [narrativeResolved, setNarrativeResolved] = useState(false);

  useEffect(() => {
    const skeletonTimer = setTimeout(() => setShowSkeleton(true), 300);

    fetch("/api/strategy/narrative")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) setAi(d.data);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(skeletonTimer);
        setShowSkeleton(false);
        setNarrativeResolved(true);
      });

    return () => clearTimeout(skeletonTimer);
  }, []);

  const positioning = ai?.target_positioning || fallback.positioning;
  const direction = ai?.strategic_direction || null;
  const whereToFocus = ai?.where_to_focus?.length
    ? ai.where_to_focus
    : fallback.whereToFocus;
  const whereToAvoid = ai?.where_to_avoid?.length
    ? ai.where_to_avoid
    : fallback.whereToAvoid;
  const tradeoffs = ai?.positioning_tradeoffs?.length
    ? ai.positioning_tradeoffs
    : fallback.tradeoffs;
  const narrative = ai?.narrative_to_tell || fallback.narrative;
  const risks = ai?.risks?.length ? ai.risks : fallback.risks;

  const loading = showSkeleton;
  const pending = !narrativeResolved && !showSkeleton;

  return (
    <div className="mx-auto max-w-[48rem] space-y-10">
      <PageHeader
        title="Strategy"
        description="Where you're positioned, where to focus, what to say — and the tradeoffs you're accepting when you commit."
      />

      <section className="space-y-3">
        <SectionHeader eyebrow="Target positioning" title="Where you sit today" />
        {loading ? (
          <Skeleton />
        ) : pending ? (
          <div className="min-h-[3rem]" />
        ) : (
          <div className="space-y-4">
            <p className="text-[15px] leading-[1.7] text-[color:var(--color-text-primary)]">
              {positioning}
            </p>
            {direction && (
              <p className="text-[15px] leading-[1.7] text-[color:var(--color-text-secondary)]">
                {direction}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4 border-t border-[color:var(--color-border-subtle)] pt-8">
        <SectionHeader title="Role targeting guidance" />
        {loading ? (
          <Skeleton lines={5} />
        ) : pending ? (
          <div className="min-h-[6rem]" />
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
                Where to focus
              </div>
              <Bullets items={whereToFocus} />
            </div>
            <div className="space-y-2 border-t border-[color:var(--color-border-subtle)] pt-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
                Where to avoid
              </div>
              <Bullets items={whereToAvoid} />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4 border-t border-[color:var(--color-border-subtle)] pt-8">
        <SectionHeader title="Positioning tradeoffs" />
        {loading ? (
          <Skeleton lines={3} />
        ) : pending ? (
          <div className="min-h-[4rem]" />
        ) : (
          <Bullets items={tradeoffs} />
        )}
      </section>

      <Card intent="info" padding="lg">
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80">
            Narrative to tell
          </div>
          {loading ? (
            <Skeleton lines={4} />
          ) : pending ? (
            <div className="min-h-[5rem]" />
          ) : (
            <p className="text-[16px] italic leading-[1.7] text-[color:var(--color-text-primary)]">
              {narrative}
            </p>
          )}
        </div>
      </Card>

      <section className="space-y-4 border-t border-[color:var(--color-border-subtle)] pt-8">
        <SectionHeader title="Risks" />
        {loading ? (
          <Skeleton lines={2} />
        ) : pending ? (
          <div className="min-h-[3rem]" />
        ) : (
          <Bullets items={risks} />
        )}
      </section>
    </div>
  );
}
