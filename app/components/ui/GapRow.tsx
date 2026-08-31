import * as React from "react";

export type Severity = "High" | "Medium" | "Low" | string;

type GapRowProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  severity?: Severity | null;
  recommendedFix?: React.ReactNode;
  className?: string;
};

function severityDotClass(sev: Severity | null | undefined): string {
  const key = String(sev || "").toLowerCase();
  if (key === "high") return "bg-[color:var(--color-danger-text)]";
  if (key === "medium") return "bg-[color:var(--color-caution-text)]";
  return "bg-[color:var(--color-text-muted)]";
}

/**
 * Compact gap row. Severity is a leading colored dot — quieter than
 * a full trailing pill but still visible at a glance. Description is
 * body-tone; suggested fix is muted below. No per-gap card border —
 * consumer groups them inside a divided surface.
 */
export default function GapRow({
  title,
  description,
  severity,
  recommendedFix,
  className = "",
}: GapRowProps) {
  return (
    <div className={"px-4 py-4 " + (className || "")}>
      <div className="flex items-start gap-3">
        <span
          className={
            "mt-1.5 h-2 w-2 shrink-0 rounded-full " +
            severityDotClass(severity)
          }
          aria-label={`Severity ${severity || "unspecified"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-[color:var(--color-text-primary)]">
            {title}
          </div>
          {description && (
            <p className="text-[14px] leading-[1.6] text-[color:var(--color-text-secondary)] mt-1">
              {description}
            </p>
          )}
          {recommendedFix && (
            <p className="text-[13px] text-[color:var(--color-text-muted)] mt-2">
              <span className="font-semibold text-[color:var(--color-text-secondary)]">
                Suggested fix ·{" "}
              </span>
              {recommendedFix}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
