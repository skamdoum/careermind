import * as React from "react";
import Badge, { type BadgeVariant } from "./Badge";

type SignalRowProps = {
  name: React.ReactNode;
  score?: number;
  rationale?: React.ReactNode;
  evidence?: string[];
  className?: string;
};

/**
 * Compact strength-signal row. Trailing score chip anchors the scan
 * pattern (score first, then read the name); rationale is body-tone;
 * evidence bullets sit muted below. No per-signal card border — the
 * consumer groups them inside a bordered list surface.
 */
export default function SignalRow({
  name,
  score,
  rationale,
  evidence,
  className = "",
}: SignalRowProps) {
  const scoreNum = typeof score === "number" ? score : 0;
  const variant: BadgeVariant =
    scoreNum >= 4 ? "success" : scoreNum === 3 ? "caution" : "neutral";

  return (
    <div className={"px-4 py-4 " + (className || "")}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[15px] font-semibold text-[color:var(--color-text-primary)] min-w-0">
          {name}
        </div>
        {typeof score === "number" && (
          <Badge variant={variant}>{scoreNum}/5</Badge>
        )}
      </div>
      {rationale && (
        <p className="text-[14px] leading-[1.6] text-[color:var(--color-text-secondary)] mt-2">
          {rationale}
        </p>
      )}
      {evidence && evidence.length > 0 && (
        <ul className="list-disc pl-5 mt-3 text-[13px] text-[color:var(--color-text-secondary)] space-y-1">
          {evidence.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
