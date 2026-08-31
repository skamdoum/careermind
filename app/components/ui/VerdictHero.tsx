import * as React from "react";
import Card, { type CardIntent } from "./Card";

export type Verdict = "Strong Hire" | "Borderline" | "Below Bar" | string;

type VerdictHeroProps = {
  verdict: Verdict | null | undefined;
  summary?: React.ReactNode;
  eyebrow?: string;
  className?: string;
};

/**
 * Map a verdict word to a Card intent. The verdict IS the badge — no
 * separate pill. Falls back to `default` if the verdict is missing or
 * unrecognized so we never render an unstyled hole.
 */
export function verdictIntent(verdict: Verdict | null | undefined): CardIntent {
  switch (verdict) {
    case "Strong Hire":
      return "success";
    case "Borderline":
      return "caution";
    case "Below Bar":
      return "danger";
    default:
      return "default";
  }
}

/**
 * Full-width intelligence surface. The verdict word is the visual
 * anchor. The optional summary reads as an italic lede beneath it.
 */
export default function VerdictHero({
  verdict,
  summary,
  eyebrow = "Verdict",
  className = "",
}: VerdictHeroProps) {
  const intent = verdictIntent(verdict);
  const label = verdict || "No verdict available";

  return (
    <Card intent={intent} padding="lg" className={className}>
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80">
          {eyebrow}
        </div>
        <div className="text-[32px] leading-none font-medium tracking-[-0.02em]">
          {label}
        </div>
        {summary && (
          <p className="text-[15px] italic leading-[1.6] text-[color:var(--color-text-primary)]">
            {summary}
          </p>
        )}
      </div>
    </Card>
  );
}
